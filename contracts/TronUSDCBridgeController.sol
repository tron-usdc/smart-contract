// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlDefaultAdminRulesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ITronUSDCBridge} from "./interface/ITronUSDCBridge.sol";
import {TransactionValidator} from "./library/TransactionValidator.sol";

contract TronUSDCBridgeController is Initializable, ContextUpgradeable, AccessControlDefaultAdminRulesUpgradeable, ReentrancyGuardUpgradeable, PausableUpgradeable {
    using SafeERC20 for IERC20;
    using TransactionValidator for string;
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
        bool paused;
        uint256 value;
        string tronBurnTx;
        uint256 requestedBlock;
        uint256 numberOfApproval;
        mapping(address => bool) approved;
    }

    struct WithdrawOperationView {
        address to;
        bool paused;
        uint256 value;
        string tronBurnTx;
        uint256 requestedBlock;
        uint256 numberOfApproval;
    }

    /// @custom:storage-location erc7201:openzeppelin.storage.USDCStakingController
    struct TronUSDCBridgeControllerStorage {
        ITronUSDCBridge bridge;
        WithdrawOperation[] withdrawOperations;
        uint256 instantWithdrawThreshold;
        uint256 ratifiedWithdrawThreshold;
        uint256 multiSigWithdrawThreshold;
        uint256 withdrawReqInvalidBeforeThisBlock;
        address investmentAddress;
        address treasury;
        uint256 feeRate;
        uint256 instantWithdrawPool;
        uint256 ratifiedWithdrawPool;
        uint256 multiSigWithdrawPool;
        uint256 multiSigWithdrawLimit;
        uint256 instantWithdrawLimit;
        uint256 ratifiedWithdrawLimit;
        address[2] ratifiedPoolRefillApprovals;
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
    event WithdrawThresholdChanged(uint256 instant, uint256 ratified, uint256 multiSig);
    event WithdrawLimitsChanged(uint256 instant, uint256 ratified, uint256 multiSig);
    event PoolRefilled(string poolType, uint256 amount);

    error InvalidOperation();

    function initialize(
        address _bridge,
        address _admin,
        uint256 _instantWithdrawThreshold,
        uint256 _ratifiedWithdrawThreshold,
        uint256 _multiSigWithdrawThreshold,
        uint256 _instantWithdrawLimit,
        uint256 _ratifiedWithdrawLimit,
        uint256 _multiSigWithdrawLimit
    ) public initializer {
        require(_bridge != address(0), "Bridge address cannot be zero");
        require(_admin != address(0), "Admin address cannot be zero");
        require(_instantWithdrawThreshold != 0, "Invalid instant threshold");
        require(_ratifiedWithdrawThreshold > _instantWithdrawThreshold, "Ratified threshold must be greater than instant threshold");
        require(_multiSigWithdrawThreshold > _ratifiedWithdrawThreshold, "MultiSig threshold must be greater than ratified threshold");

        require(_instantWithdrawLimit >= _instantWithdrawThreshold, "Instant withdraw limit must be greater than or equal to instant withdraw threshold");
        require(_ratifiedWithdrawLimit >= _ratifiedWithdrawThreshold, "Ratified withdraw limit must be greater than or equal to ratified withdraw threshold");
        require(_multiSigWithdrawLimit >= _multiSigWithdrawThreshold, "Multi-sig withdraw limit must be greater than or equal to multi-sig withdraw threshold");

        require(_ratifiedWithdrawLimit > _instantWithdrawLimit, "Ratified withdraw limit must be greater than instant withdraw limit");
        require(_multiSigWithdrawLimit > _ratifiedWithdrawLimit, "Multi-sig withdraw limit must be greater than ratified withdraw limit");

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

        $.instantWithdrawLimit = _instantWithdrawLimit;
        $.ratifiedWithdrawLimit = _ratifiedWithdrawLimit;
        $.multiSigWithdrawLimit = _multiSigWithdrawLimit;

        $.instantWithdrawPool = _instantWithdrawLimit;
        $.ratifiedWithdrawPool = _ratifiedWithdrawLimit;
        $.multiSigWithdrawPool = _multiSigWithdrawLimit;
    }

    function acceptDefaultAdminTransfer() override public {
        (address newDefaultAdmin,) = pendingDefaultAdmin();
        if (_msgSender() != newDefaultAdmin) {
            // Enforce newDefaultAdmin explicit acceptance.
            revert AccessControlInvalidDefaultAdmin(_msgSender());
        }

        // revoke all roles from old admin
        _revokeRole(SYSTEM_OPERATOR_ROLE, defaultAdmin());
        _revokeRole(WITHDRAW_RATIFIER_ROLE, defaultAdmin());
        _revokeRole(ACCESS_MANAGER_ROLE, defaultAdmin());
        _revokeRole(PAUSER_ROLE, defaultAdmin());
        _revokeRole(FUND_MANAGER_ROLE, defaultAdmin());

        _acceptDefaultAdminTransfer();
        // grant all roles to new admin
        _grantRole(SYSTEM_OPERATOR_ROLE, newDefaultAdmin);
        _grantRole(WITHDRAW_RATIFIER_ROLE, newDefaultAdmin);
        _grantRole(ACCESS_MANAGER_ROLE, newDefaultAdmin);
        _grantRole(PAUSER_ROLE, newDefaultAdmin);
        _grantRole(FUND_MANAGER_ROLE, newDefaultAdmin);
    }

    function pauseBridge() external onlyRole(PAUSER_ROLE) {
        bridge().pause();
    }

    function unpauseBridge() external onlyRole(DEFAULT_ADMIN_ROLE) {
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
        require(amount != 0, "Amount must be greater than 0");
        require($.investmentAddress != address(0), "Investment address not set");

        $.bridge.transferUSDC($.investmentAddress, amount);
        emit FundsTransferredToInvestment(amount);
    }

    function reclaimEtherFromBridge(address payable _to) external onlyRole(DEFAULT_ADMIN_ROLE) {
        bridge().reclaimEther(_to);
    }

    function reclaimTokenFromBridge(IERC20 _token) external onlyRole(DEFAULT_ADMIN_ROLE) {
        bridge().reclaimToken(_token, _msgSender());
    }

    function reclaimEther(address payable _to) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        require(_to != address(0), "Invalid address");
        uint256 balance = address(this).balance;
        (bool success,) = _to.call{value: balance}("");
        require(success, "Transfer failed");
    }

    function reclaimToken(IERC20 _token, address _to) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        require(_to != address(0), "Invalid address");
        uint256 balance = _token.balanceOf(address(this));
        _token.safeTransfer(_to, balance);
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
        if (_feeRate != 0) {
            require($.treasury != address(0), "Treasury address not set");
        }
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
        require(_value != 0, "Invalid amount");
        require(_tronBurnTx.isValidTronTxHash(), "Invalid Tron burn tx");

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
        require(_to != address(0), "Invalid address");
        require(_value != 0, "Invalid amount");
        require(_tronBurnTx.isValidTronTxHash(), "Invalid Tron burn tx");

        TronUSDCBridgeControllerStorage storage $ = _getTronUSDCBridgeControllerStorage();
        require(_value <= $.instantWithdrawThreshold, "Over the instant withdraw threshold");
        require(_value <= $.instantWithdrawPool, "Instant withdraw pool is dry");

        uint256 fee = (_value * $.feeRate) / FEE_DENOMINATOR;
        uint256 withdrawAmount = _value - fee;

        $.instantWithdrawPool -= _value;
        $.bridge.withdraw(_to, withdrawAmount);
        emit InstantWithdraw(_to, withdrawAmount, _tronBurnTx);

        if (fee != 0) {
            $.bridge.withdraw($.treasury, fee);
            emit FeePaid($.treasury, fee);
        }
    }

    function ratifyWithdraw(uint256 _index, address _to, uint256 _value, string calldata _tronBurnTx)
    external
    whenNotPaused
    onlyRole(WITHDRAW_RATIFIER_ROLE)
    {
        require(_to != address(0), "Invalid address");
        require(_value != 0, "Invalid amount");
        require(_tronBurnTx.isValidTronTxHash(), "Invalid Tron burn tx");

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
        require(to != address(0), "Invalid address");
        uint256 value = op.value;
        string memory tronBurnTx = op.tronBurnTx;
        if (!hasRole(DEFAULT_ADMIN_ROLE, _msgSender())) {
            _canFinalize(_index);
            _subtractFromWithdrawPool(value);
        }

        uint256 fee = (value * $.feeRate) / FEE_DENOMINATOR;
        uint256 withdrawAmount = value - fee;

        delete $.withdrawOperations[_index];
        $.bridge.withdraw(to, withdrawAmount);
        emit WithdrawFinalized(to, withdrawAmount, tronBurnTx, _index);

        if (fee != 0) {
            $.bridge.withdraw($.treasury, fee);
            emit FeePaid($.treasury, fee);
        }
    }

    function _subtractFromWithdrawPool(uint256 _value) internal {
        TronUSDCBridgeControllerStorage storage $ = _getTronUSDCBridgeControllerStorage();
        if (_value <= $.ratifiedWithdrawPool && _value <= $.ratifiedWithdrawThreshold) {
            $.ratifiedWithdrawPool -= _value;
        } else {
            $.multiSigWithdrawPool -= _value;
        }
    }

    function hasEnoughApproval(uint256 _numberOfApproval, uint256 _value) public view returns (bool) {
        TronUSDCBridgeControllerStorage storage $ = _getTronUSDCBridgeControllerStorage();
        if (_value <= $.ratifiedWithdrawPool && _value <= $.ratifiedWithdrawThreshold) {
            if (_numberOfApproval >= RATIFY_WITHDRAW_SIGS) {
                return true;
            }
        }
        if (_value <= $.multiSigWithdrawPool && _value <= $.multiSigWithdrawThreshold) {
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

    function pauseWithdraw(uint256 _opIndex) external onlyRole(PAUSER_ROLE) {
        TronUSDCBridgeControllerStorage storage $ = _getTronUSDCBridgeControllerStorage();
        $.withdrawOperations[_opIndex].paused = true;
        emit WithdrawPaused(_opIndex, true);
    }

    function unpauseWithdraw(uint256 _opIndex) external onlyRole(DEFAULT_ADMIN_ROLE) {
        TronUSDCBridgeControllerStorage storage $ = _getTronUSDCBridgeControllerStorage();
        $.withdrawOperations[_opIndex].paused = false;
        emit WithdrawPaused(_opIndex, false);
    }

    function withdrawOperationCount() public view returns (uint256) {
        TronUSDCBridgeControllerStorage storage $ = _getTronUSDCBridgeControllerStorage();
        return $.withdrawOperations.length;
    }

    function setWithdrawThresholds(uint256 _instant, uint256 _ratified, uint256 _multiSig) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_instant != 0, "Invalid instant threshold");
        require(_instant <= _ratified && _ratified <= _multiSig, "Invalid thresholds");
        TronUSDCBridgeControllerStorage storage $ = _getTronUSDCBridgeControllerStorage();

        // check if the new thresholds are less than or equal to the limits
        require(_instant <= $.instantWithdrawLimit, "Instant threshold must be less than or equal to instant limit");
        require(_ratified <= $.ratifiedWithdrawLimit, "Ratified threshold must be less than or equal to ratified limit");
        require(_multiSig <= $.multiSigWithdrawLimit, "Multi-sig threshold must be less than or equal to multi-sig limit");

        $.instantWithdrawThreshold = _instant;
        $.ratifiedWithdrawThreshold = _ratified;
        $.multiSigWithdrawThreshold = _multiSig;

        emit WithdrawThresholdChanged(_instant, _ratified, _multiSig);
    }

    function setWithdrawLimits(uint256 _instant, uint256 _ratified, uint256 _multiSig) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_instant != 0, "Invalid limits");
        require(_instant <= _ratified && _ratified <= _multiSig, "Invalid limits");
        TronUSDCBridgeControllerStorage storage $ = _getTronUSDCBridgeControllerStorage();

        // check if the new limits are greater than or equal to the thresholds
        require(_instant >= $.instantWithdrawThreshold, "Instant limit must be greater than or equal to instant threshold");
        require(_ratified >= $.ratifiedWithdrawThreshold, "Ratified limit must be greater than or equal to ratified threshold");
        require(_multiSig >= $.multiSigWithdrawThreshold, "Multi-sig limit must be greater than or equal to multi-sig threshold");

        $.instantWithdrawLimit = _instant;
        if ($.instantWithdrawPool > _instant) {
            $.instantWithdrawPool = _instant;
        }

        $.ratifiedWithdrawLimit = _ratified;
        if ($.ratifiedWithdrawPool > _ratified) {
            $.ratifiedWithdrawPool = _ratified;
        }

        $.multiSigWithdrawLimit = _multiSig;
        if ($.multiSigWithdrawPool > _multiSig) {
            $.multiSigWithdrawPool = _multiSig;
        }

        emit WithdrawLimitsChanged(_instant, _ratified, _multiSig);
    }

    function refillInstantWithdrawPool() external onlyRole(WITHDRAW_RATIFIER_ROLE) {
        TronUSDCBridgeControllerStorage storage $ = _getTronUSDCBridgeControllerStorage();
        uint256 refillAmount = $.instantWithdrawLimit - $.instantWithdrawPool;
        $.ratifiedWithdrawPool -= refillAmount;
        $.instantWithdrawPool = $.instantWithdrawLimit;
        emit PoolRefilled("Instant", refillAmount);
    }

    function refillRatifiedWithdrawPool() external onlyRole(WITHDRAW_RATIFIER_ROLE) {
        TronUSDCBridgeControllerStorage storage $ = _getTronUSDCBridgeControllerStorage();
        if (!hasRole(DEFAULT_ADMIN_ROLE, _msgSender())) {
            address[2] memory refillApprovals = $.ratifiedPoolRefillApprovals;
            require(_msgSender() != refillApprovals[0] && _msgSender() != refillApprovals[1], "Already approved");
            if (refillApprovals[0] == address(0)) {
                $.ratifiedPoolRefillApprovals[0] = _msgSender();
                return;
            }
            if (refillApprovals[1] == address(0)) {
                $.ratifiedPoolRefillApprovals[1] = _msgSender();
                return;
            }
        }

        delete $.ratifiedPoolRefillApprovals;
        uint256 refillAmount = $.ratifiedWithdrawLimit - $.ratifiedWithdrawPool;
        $.multiSigWithdrawPool -= refillAmount;
        $.ratifiedWithdrawPool = $.ratifiedWithdrawLimit;
        emit PoolRefilled("Ratified", refillAmount);
    }

    function refillMultiSigWithdrawPool() external onlyRole(DEFAULT_ADMIN_ROLE) {
        TronUSDCBridgeControllerStorage storage $ = _getTronUSDCBridgeControllerStorage();
        uint256 refillAmount = $.multiSigWithdrawLimit - $.multiSigWithdrawPool;
        $.multiSigWithdrawPool = $.multiSigWithdrawLimit;
        emit PoolRefilled("MultiSig", refillAmount);
    }

    function invalidateAllPendingWithdraws() external onlyRole(DEFAULT_ADMIN_ROLE) {
        TronUSDCBridgeControllerStorage storage $ = _getTronUSDCBridgeControllerStorage();
        $.withdrawReqInvalidBeforeThisBlock = block.number;
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
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

    function getInvestmentAddress() public view returns (address) {
        return _getTronUSDCBridgeControllerStorage().investmentAddress;
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

    function getInstantWithdrawLimit() public view returns (uint256) {
        return _getTronUSDCBridgeControllerStorage().instantWithdrawLimit;
    }

    function getRatifiedWithdrawLimit() public view returns (uint256) {
        return _getTronUSDCBridgeControllerStorage().ratifiedWithdrawLimit;
    }

    function getMultiSigWithdrawLimit() public view returns (uint256) {
        return _getTronUSDCBridgeControllerStorage().multiSigWithdrawLimit;
    }

    function getInstantWithdrawPool() public view returns (uint256) {
        return _getTronUSDCBridgeControllerStorage().instantWithdrawPool;
    }

    function getRatifiedWithdrawPool() public view returns (uint256) {
        return _getTronUSDCBridgeControllerStorage().ratifiedWithdrawPool;
    }

    function getMultiSigWithdrawPool() public view returns (uint256) {
        return _getTronUSDCBridgeControllerStorage().multiSigWithdrawPool;
    }

    function getRatifiedPoolRefillApprovals() public view returns (address[2] memory) {
        return _getTronUSDCBridgeControllerStorage().ratifiedPoolRefillApprovals;
    }
}
