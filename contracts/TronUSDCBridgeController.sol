// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlDefaultAdminRulesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ITronUSDCBridge} from "./interface/ITronUSDCBridge.sol";

contract TronUSDCBridgeController is Initializable, ContextUpgradeable, AccessControlDefaultAdminRulesUpgradeable, ReentrancyGuardUpgradeable, PausableUpgradeable {
    bytes32 public constant SYSTEM_OPERATOR_ROLE = keccak256("SYSTEM_OPERATOR_ROLE");
    bytes32 public constant WITHDRAW_RATIFIER_ROLE = keccak256("WITHDRAW_RATIFIER_ROLE");
    bytes32 public constant ACCESS_MANAGER_ROLE = keccak256("ACCESS_MANAGER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant FUND_MANAGER_ROLE = keccak256("FUND_MANAGER_ROLE");

    uint8 public constant RATIFY_WITHDRAW_SIGS = 1;
    uint8 public constant MULTISIG_WITHDRAW_SIGS = 3;

    uint256 private constant FEE_DENOMINATOR = 1_000_000;

    struct WithdrawOperation {
        address to;
        uint256 value;
        string tronBurnTx;
        uint256 requestedBlock;
        uint256 numberOfApproval;
        bool paused;
        mapping(address => bool) approved;
    }

    struct WithdrawOperationView {
        address to;
        uint256 value;
        string tronBurnTx;
        uint256 requestedBlock;
        uint256 numberOfApproval;
        bool paused;
    }

    /// @custom:storage-location erc7201:openzeppelin.storage.USDCStakingController
    struct TronUSDCBridgeControllerStorage {
        ITronUSDCBridge bridge;
        WithdrawOperation[] withdrawOperations;
        uint256 instantWithdrawThreshold;
        uint256 ratifiedWithdrawThreshold;
        uint256 multiSigWithdrawThreshold;
        uint256 withdrawReqInvalidBeforeThisBlock;
        address vaultAddress;
        address investmentAddress;
        address treasury;
        uint256 feeRate; // Expressed in basis points, for example, 10000 means 1%.
    }

    // keccak256(abi.encode(uint256(keccak256("TronUSDC.storage.TronUSDCBridgeController")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant TronUSDCBridgeControllerStorageLocation = 0x9b95268000b3914abdf3fa3f178c50ac3bc68cc650daa9813bbd20df18c0be00;

    function _getTronUSDCBridgeControllerStorage() private pure returns (TronUSDCBridgeControllerStorage storage $) {
        assembly {
            $.slot := TronUSDCBridgeControllerStorageLocation
        }
    }

    event InstantWithdraw(address indexed to, uint256 indexed value, string tronBurnTx);
    event WithdrawRequested(address indexed to, uint256 indexed value, string tronBurnTx, uint256 opIndex);
    event WithdrawFinalized(address indexed to, uint256 indexed value, string tronBurnTx, uint256 opIndex);
    event WithdrawRatified(uint256 indexed opIndex, address indexed ratifier);
    event WithdrawRevoked(uint256 opIndex);
    event WithdrawPaused(uint256 opIndex, bool status);
    event InvestmentAddressSet(address indexed oldAddress, address indexed newAddress);
    event FundsTransferredToInvestment(uint256 amount);
    event FeePaid(address indexed to, uint256 amount);
    event TreasurySet(address indexed oldTreasury, address indexed newTreasury);
    event FeeRateSet(uint256 oldFeeRate, uint256 newFeeRate);

    error InvalidOperation();

    function initialize(
        address _bridge,
        address _admin,
        uint256 _instantWithdrawThreshold,
        uint256 _ratifiedWithdrawThreshold,
        uint256 _multiSigWithdrawThreshold,
        uint256 _feeRate,
        address _treasury
    ) public initializer {
        require(_bridge != address(0), "Bridge address cannot be zero");
        require(_admin != address(0), "Admin address cannot be zero");
        require(_instantWithdrawThreshold > 0, "Instant withdraw threshold must be positive");
        require(_ratifiedWithdrawThreshold > _instantWithdrawThreshold, "Ratified threshold must be greater than instant threshold");
        require(_multiSigWithdrawThreshold > _ratifiedWithdrawThreshold, "MultiSig threshold must be greater than ratified threshold");
        require(_feeRate <= FEE_DENOMINATOR, "Invalid fee rate");
        require(_treasury != address(0), "Treasury cannot be zero address");

        __ReentrancyGuard_init();
        __Pausable_init();

        __AccessControlDefaultAdminRules_init(1 seconds, _admin);
        _grantRole(SYSTEM_OPERATOR_ROLE, _admin);
        _grantRole(WITHDRAW_RATIFIER_ROLE, _admin);
        _grantRole(ACCESS_MANAGER_ROLE, _admin);
        _grantRole(PAUSER_ROLE, _admin);
        _grantRole(FUND_MANAGER_ROLE, _admin);

        TronUSDCBridgeControllerStorage storage $ = _getTronUSDCBridgeControllerStorage();
        $.bridge = ITronUSDCBridge(_bridge);

        $.instantWithdrawThreshold = _instantWithdrawThreshold;
        $.ratifiedWithdrawThreshold = _ratifiedWithdrawThreshold;
        $.multiSigWithdrawThreshold = _multiSigWithdrawThreshold;

        $.feeRate = _feeRate;
        $.treasury = _treasury;

        emit FeeRateSet(0, _feeRate);
        emit TreasurySet(address(0), _treasury);
    }

    function pauseBridge() external onlyRole(PAUSER_ROLE) {
        bridge().pause();
    }

    function unpauseBridge() external onlyRole(PAUSER_ROLE) {
        bridge().unpause();
    }

    function setWhitelistEnabled(bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        bridge().setWhitelistEnabled(enabled);
    }

    function updateWhitelist(address user, bool status) external onlyRole(ACCESS_MANAGER_ROLE) {
        bridge().updateWhitelist(user, status);
    }

    function setMinDepositAmount(uint256 _newAmount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        bridge().setMinDepositAmount(_newAmount);
    }

    function setInvestmentAddress(address _investmentAddress) external onlyRole(DEFAULT_ADMIN_ROLE) {
        TronUSDCBridgeControllerStorage storage $ = _getTronUSDCBridgeControllerStorage();
        require(_investmentAddress != address(0), "Invalid investment address");
        address oldAddress = $.investmentAddress;
        $.investmentAddress = _investmentAddress;
        emit InvestmentAddressSet(oldAddress, _investmentAddress);
    }

    function transferToInvestment(uint256 amount) external onlyRole(FUND_MANAGER_ROLE) {
        TronUSDCBridgeControllerStorage storage $ = _getTronUSDCBridgeControllerStorage();
        require(amount > 0, "Amount must be greater than 0");
        require($.investmentAddress != address(0), "Investment address not set");

        $.bridge.transferUSDC($.investmentAddress, amount);
        emit FundsTransferredToInvestment(amount);
    }

    function reclaimEtherFromBridge() external onlyRole(DEFAULT_ADMIN_ROLE) {
        bridge().reclaimEther(payable(_msgSender()));
    }

    function reclaimTokenFromBridge(IERC20 _token) external onlyRole(DEFAULT_ADMIN_ROLE) {
        bridge().reclaimToken(_token, _msgSender());
    }

    function reclaimEther(address payable _to) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_to != address(0), "Invalid address");
        uint256 balance = address(this).balance;
        (bool success,) = _to.call{value: balance}("");
        require(success, "Transfer failed");
    }

    function reclaimToken(IERC20 _token, address _to) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_to != address(0), "Invalid address");
        uint256 balance = _token.balanceOf(address(this));
        _token.transfer(_to, balance);
    }

    function setTreasury(address _treasurer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_treasurer != address(0), "Invalid treasury address");
        TronUSDCBridgeControllerStorage storage $ = _getTronUSDCBridgeControllerStorage();
        address oldTreasury = $.treasury;
        $.treasury = _treasurer;
        emit TreasurySet(oldTreasury, _treasurer);
    }

    function setFeeRate(uint256 _feeRate) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_feeRate <= FEE_DENOMINATOR, "Invalid fee rate");
        TronUSDCBridgeControllerStorage storage $ = _getTronUSDCBridgeControllerStorage();
        uint256 oldFeeRate = $.feeRate;
        $.feeRate = _feeRate;
        emit FeeRateSet(oldFeeRate, _feeRate);
    }

    function ownerWithdraw(address _to, uint256 _value, string calldata _tronBurnTx) external onlyRole(DEFAULT_ADMIN_ROLE) {
        TronUSDCBridgeControllerStorage storage $ = _getTronUSDCBridgeControllerStorage();
        _requestWithdraw(_to, _value, _tronBurnTx);
        finalizeWithdraw($.withdrawOperations.length - 1);
    }

    function requestWithdraw(address _to, uint256 _value, string calldata _tronBurnTx)
    external
    whenNotPaused
    onlyRole(SYSTEM_OPERATOR_ROLE)
    {
        _requestWithdraw(_to, _value, _tronBurnTx);
    }

    function _requestWithdraw(address _to, uint256 _value, string calldata _tronBurnTx) internal {
        require(_to != address(0), "Invalid address");
        require(bytes(_tronBurnTx).length == 64, "Invalid Tron burn tx");
        TronUSDCBridgeControllerStorage storage $ = _getTronUSDCBridgeControllerStorage();
        WithdrawOperation storage op = $.withdrawOperations.push();
        op.to = _to;
        op.value = _value;
        op.tronBurnTx = _tronBurnTx;
        op.requestedBlock = block.number;
        op.numberOfApproval = 0;
        op.paused = false;
        emit WithdrawRequested(_to, _value, _tronBurnTx, $.withdrawOperations.length - 1);
    }

    function instantWithdraw(address _to, uint256 _value, string calldata _tronBurnTx)
    external
    whenNotPaused
    onlyRole(SYSTEM_OPERATOR_ROLE)
    {
        TronUSDCBridgeControllerStorage storage $ = _getTronUSDCBridgeControllerStorage();
        require(_to != address(0), "Invalid address");
        require(bytes(_tronBurnTx).length == 64, "Invalid Tron burn tx");
        require(_value <= $.instantWithdrawThreshold, "Over the instant withdraw threshold");

        uint256 fee = (_value * $.feeRate) / FEE_DENOMINATOR;
        uint256 withdrawAmount = _value - fee;

        $.bridge.withdraw(_to, withdrawAmount);
        emit InstantWithdraw(_to, _value, _tronBurnTx);

        if (fee > 0 && $.treasury != address(0)) {
            $.bridge.withdraw($.treasury, fee);
            emit FeePaid($.treasury, fee);
        }
    }

    function ratifyWithdraw(uint256 _index, address _to, uint256 _value, string calldata _tronBurnTx)
    external
    whenNotPaused
    onlyRole(WITHDRAW_RATIFIER_ROLE)
    {
        TronUSDCBridgeControllerStorage storage $ = _getTronUSDCBridgeControllerStorage();
        WithdrawOperation storage op = $.withdrawOperations[_index];
        require(op.to == _to, "To address does not match");
        require(op.value == _value, "Amount does not match");
        require(keccak256(bytes(op.tronBurnTx)) == keccak256(bytes(_tronBurnTx)), "Tron burn tx does not match");
        require(!op.approved[_msgSender()], "Already approved");
        op.approved[_msgSender()] = true;
        op.numberOfApproval += 1;
        emit WithdrawRatified(_index, _msgSender());
        if (hasEnoughApproval(op.numberOfApproval, _value)) {
            finalizeWithdraw(_index);
        }
    }

    function finalizeWithdraw(uint256 _index) public whenNotPaused {
        TronUSDCBridgeControllerStorage storage $ = _getTronUSDCBridgeControllerStorage();
        WithdrawOperation storage op = $.withdrawOperations[_index];

        address to = op.to;
        uint256 value = op.value;
        string memory tronBurnTx = op.tronBurnTx;
        if (!hasRole(DEFAULT_ADMIN_ROLE, _msgSender())) {
            _canFinalize(_index);
        }

        uint256 fee = (value * $.feeRate) / FEE_DENOMINATOR;
        uint256 withdrawAmount = value - fee;

        delete $.withdrawOperations[_index];
        $.bridge.withdraw(to, withdrawAmount);
        emit WithdrawFinalized(to, value, tronBurnTx, _index);

        if (fee > 0 && $.treasury != address(0)) {
            $.bridge.withdraw($.treasury, fee);
            emit FeePaid($.treasury, fee);
        }
    }

    function hasEnoughApproval(uint256 _numberOfApproval, uint256 _value) public view returns (bool) {
        TronUSDCBridgeControllerStorage storage $ = _getTronUSDCBridgeControllerStorage();
        if (_value <= $.ratifiedWithdrawThreshold) {
            if (_numberOfApproval >= RATIFY_WITHDRAW_SIGS) {
                return true;
            }
        }
        if (_value <= $.multiSigWithdrawThreshold) {
            if (_numberOfApproval >= MULTISIG_WITHDRAW_SIGS) {
                return true;
            }
        }
        if (hasRole(DEFAULT_ADMIN_ROLE, _msgSender())) {
            return true;
        }
        return false;
    }

    function _canFinalize(uint256 _index) internal view returns (bool) {
        TronUSDCBridgeControllerStorage storage $ = _getTronUSDCBridgeControllerStorage();
        WithdrawOperation storage op = $.withdrawOperations[_index];

        if (op.requestedBlock <= $.withdrawReqInvalidBeforeThisBlock) {
            revert("This withdraw is invalid");
        }
        if (op.paused) {
            revert("This withdraw is paused");
        }
        if (!hasEnoughApproval(op.numberOfApproval, op.value)) {
            revert("Not enough approvals");
        }

        return true;
    }

    function canFinalize(uint256 _index) public view returns (bool) {
        return _canFinalize(_index);
    }

    function revokeWithdraw(uint256 _index) external onlyRole(SYSTEM_OPERATOR_ROLE) {
        TronUSDCBridgeControllerStorage storage $ = _getTronUSDCBridgeControllerStorage();
        delete $.withdrawOperations[_index];
        emit WithdrawRevoked(_index);
    }

    function pauseWithdraw(uint256 _opIndex) external onlyRole(SYSTEM_OPERATOR_ROLE) {
        TronUSDCBridgeControllerStorage storage $ = _getTronUSDCBridgeControllerStorage();
        $.withdrawOperations[_opIndex].paused = true;
        emit WithdrawPaused(_opIndex, true);
    }

    function unpauseWithdraw(uint256 _opIndex) external onlyRole(SYSTEM_OPERATOR_ROLE) {
        TronUSDCBridgeControllerStorage storage $ = _getTronUSDCBridgeControllerStorage();
        $.withdrawOperations[_opIndex].paused = false;
        emit WithdrawPaused(_opIndex, false);
    }

    function withdrawOperationCount() public view returns (uint256) {
        TronUSDCBridgeControllerStorage storage $ = _getTronUSDCBridgeControllerStorage();
        return $.withdrawOperations.length;
    }

    function setWithdrawThresholds(uint256 _instant, uint256 _ratified, uint256 _multiSig) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_instant <= _ratified && _ratified <= _multiSig, "Invalid thresholds");
        TronUSDCBridgeControllerStorage storage $ = _getTronUSDCBridgeControllerStorage();
        $.instantWithdrawThreshold = _instant;
        $.ratifiedWithdrawThreshold = _ratified;
        $.multiSigWithdrawThreshold = _multiSig;
    }

    function invalidateAllPendingWithdraws() external onlyRole(DEFAULT_ADMIN_ROLE) {
        TronUSDCBridgeControllerStorage storage $ = _getTronUSDCBridgeControllerStorage();
        $.withdrawReqInvalidBeforeThisBlock = block.number;
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function transferBridgeOwnership(address newOwner) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newOwner != address(0), "New owner is the zero address");
        bridge().transferOwnership(newOwner);
    }

    function claimBridgeOwnership() external onlyRole(DEFAULT_ADMIN_ROLE) {
        bridge().acceptOwnership();
    }

    function bridge() public view returns (ITronUSDCBridge) {
        TronUSDCBridgeControllerStorage storage $ = _getTronUSDCBridgeControllerStorage();
        return $.bridge;
    }

    function setBridge(address _newBridge) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_newBridge != address(0), "Invalid address");
        TronUSDCBridgeControllerStorage storage $ = _getTronUSDCBridgeControllerStorage();
        $.bridge = ITronUSDCBridge(_newBridge);
    }

    function getFeeRate() public view returns (uint256) {
        return _getTronUSDCBridgeControllerStorage().feeRate;
    }

    function getTreasury() public view returns (address) {
        return _getTronUSDCBridgeControllerStorage().treasury;
    }

    function getWithdrawOperation(uint256 index) public view returns (WithdrawOperationView memory) {
        TronUSDCBridgeControllerStorage storage $ = _getTronUSDCBridgeControllerStorage();
        if (index >= $.withdrawOperations.length) revert InvalidOperation();
        WithdrawOperation storage op = $.withdrawOperations[index];
        return WithdrawOperationView({
            to: op.to,
            value: op.value,
            tronBurnTx: op.tronBurnTx,
            requestedBlock: op.requestedBlock,
            numberOfApproval: op.numberOfApproval,
            paused: op.paused
        });
    }

    function getInstantWithdrawThreshold() public view returns (uint256) {
        return _getTronUSDCBridgeControllerStorage().instantWithdrawThreshold;
    }

    function getRatifiedWithdrawThreshold() public view returns (uint256) {
        return _getTronUSDCBridgeControllerStorage().ratifiedWithdrawThreshold;
    }

    function getMultiSigWithdrawThreshold() public view returns (uint256) {
        return _getTronUSDCBridgeControllerStorage().multiSigWithdrawThreshold;
    }

    function getWithdrawReqInvalidBeforeThisBlock() public view returns (uint256) {
        return _getTronUSDCBridgeControllerStorage().withdrawReqInvalidBeforeThisBlock;
    }
}