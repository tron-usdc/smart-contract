// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlDefaultAdminRulesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {IUSDC} from "./interface/IUSDC.sol";
import {TransactionValidator} from "./library/TransactionValidator.sol";

contract USDCController is Initializable, ContextUpgradeable, AccessControlDefaultAdminRulesUpgradeable, ReentrancyGuardUpgradeable, PausableUpgradeable {
    using SafeERC20 for IERC20;
    using TransactionValidator for string;
    bytes32 public constant SYSTEM_OPERATOR_ROLE = keccak256("SYSTEM_OPERATOR_ROLE");
    bytes32 public constant MINT_RATIFIER_ROLE = keccak256("MINT_RATIFIER_ROLE");
    bytes32 public constant ACCESS_MANAGER_ROLE = keccak256("ACCESS_MANAGER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint8 public constant RATIFY_MINT_SIGS = 1;
    uint8 public constant MULTISIG_MINT_SIGS = 3;

    uint256 private constant FEE_DENOMINATOR = 1_000_000;

    struct MintOperation {
        address to;
        bool paused;
        uint256 value;
        uint256 requestedBlock;
        uint256 numberOfApproval;
        string ethDepositTx;
        mapping(address => bool) approved;
    }

    struct MintOperationView {
        address to;
        bool paused;
        uint256 value;
        uint256 requestedBlock;
        uint256 numberOfApproval;
        string ethDepositTx;
    }

    /// @custom:storage-location erc7201:openzeppelin.storage.TronUSDCController
    struct USDCControllerStorage {
        IUSDC token;
        MintOperation[] mintOperations;
        uint256 instantMintThreshold;
        uint256 ratifiedMintThreshold;
        uint256 multiSigMintThreshold;
        uint256 instantMintLimit;
        uint256 ratifiedMintLimit;
        uint256 multiSigMintLimit;
        uint256 instantMintPool;
        uint256 ratifiedMintPool;
        uint256 multiSigMintPool;
        uint256 mintReqInvalidBeforeThisBlock;
        address[2] ratifiedPoolRefillApprovals;
        address treasury;
        uint256 feeRate; // Expressed in basis points, for example, 10000 means 1%.
    }

    // keccak256(abi.encode(uint256(keccak256("TronUSDC.storage.USDCController")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant USDCControllerStorageLocation = 0x8ed9a36c8a05ca33953042c2e596e65286939ef4610cd498fc8e695fa9437c00;

    function _getUSDCControllerStorage() private pure returns (USDCControllerStorage storage $) {
        assembly {
            $.slot := USDCControllerStorageLocation
        }
    }

    event InstantMint(address indexed to, uint256 indexed value, string ethDepositTx);
    event MintRequested(address indexed to, uint256 indexed value, string ethDepositTx, uint256 opIndex);
    event MintRatified(uint256 indexed opIndex, address indexed ratifier);
    event MintFinalized(address indexed to, uint256 indexed value, string ethDepositTx, uint256 opIndex);
    event MintRevoked(uint256 opIndex);
    event MintPaused(uint256 opIndex, bool status);
    event PoolRefilled(string poolType, uint256 amount);
    event FeePaid(address indexed to, uint256 amount);
    event TreasurySet(address indexed oldTreasury, address indexed newTreasury);
    event FeeRateSet(uint256 oldFeeRate, uint256 newFeeRate);
    event MintThresholdChanged(uint256 instant, uint256 ratified, uint256 multiSig);
    event MintLimitsChanged(uint256 instant, uint256 ratified, uint256 multiSig);

    error InvalidOperation();

    function initialize(
        address _token,
        address _admin,
        uint256 _instantMintThreshold,
        uint256 _ratifiedMintThreshold,
        uint256 _multiSigMintThreshold,
        uint256 _instantMintLimit,
        uint256 _ratifiedMintLimit,
        uint256 _multiSigMintLimit
    ) public initializer {
        require(_token != address(0), "Invalid token address");
        require(_admin != address(0), "Invalid admin address");
        require(_instantMintThreshold != 0, "Instant mint threshold must be greater than 0");
        require(_ratifiedMintThreshold > _instantMintThreshold, "Ratified mint threshold must be greater than instant mint threshold");
        require(_multiSigMintThreshold > _ratifiedMintThreshold, "Multi-sig mint threshold must be greater than ratified mint threshold");

        require(_instantMintLimit >= _instantMintThreshold, "Instant mint limit must be greater than or equal to instant mint threshold");
        require(_ratifiedMintLimit >= _ratifiedMintThreshold, "Ratified mint limit must be greater than or equal to ratified mint threshold");
        require(_multiSigMintLimit >= _multiSigMintThreshold, "Multi-sig mint limit must be greater than or equal to multi-sig mint threshold");

        require(_instantMintLimit != 0, "Instant mint limit must be greater than 0");
        require(_ratifiedMintLimit > _instantMintLimit, "Ratified mint limit must be greater than instant mint limit");
        require(_multiSigMintLimit > _ratifiedMintLimit, "Multi-sig mint limit must be greater than ratified mint limit");

        __ReentrancyGuard_init();
        __Pausable_init();

        __AccessControlDefaultAdminRules_init(1 seconds, _admin);
        _grantRole(SYSTEM_OPERATOR_ROLE, _admin);
        _grantRole(MINT_RATIFIER_ROLE, _admin);
        _grantRole(ACCESS_MANAGER_ROLE, _admin);
        _grantRole(PAUSER_ROLE, _admin);

        USDCControllerStorage storage $ = _getUSDCControllerStorage();
        $.token = IUSDC(_token);

        $.instantMintThreshold = _instantMintThreshold;
        $.ratifiedMintThreshold = _ratifiedMintThreshold;
        $.multiSigMintThreshold = _multiSigMintThreshold;

        $.instantMintLimit = _instantMintLimit;
        $.ratifiedMintLimit = _ratifiedMintLimit;
        $.multiSigMintLimit = _multiSigMintLimit;

        $.instantMintPool = _instantMintLimit;
        $.ratifiedMintPool = _ratifiedMintLimit;
        $.multiSigMintPool = _multiSigMintLimit;
    }

    function acceptDefaultAdminTransfer() override public {
        (address newDefaultAdmin,) = pendingDefaultAdmin();
        if (_msgSender() != newDefaultAdmin) {
            // Enforce newDefaultAdmin explicit acceptance.
            revert AccessControlInvalidDefaultAdmin(_msgSender());
        }

        // revoke all roles from old admin
        _revokeRole(SYSTEM_OPERATOR_ROLE, defaultAdmin());
        _revokeRole(MINT_RATIFIER_ROLE, defaultAdmin());
        _revokeRole(ACCESS_MANAGER_ROLE, defaultAdmin());
        _revokeRole(PAUSER_ROLE, defaultAdmin());

        _acceptDefaultAdminTransfer();
        // grant all roles to new admin
        _grantRole(SYSTEM_OPERATOR_ROLE, newDefaultAdmin);
        _grantRole(MINT_RATIFIER_ROLE, newDefaultAdmin);
        _grantRole(ACCESS_MANAGER_ROLE, newDefaultAdmin);
        _grantRole(PAUSER_ROLE, newDefaultAdmin);
    }

    function pauseToken() external onlyRole(PAUSER_ROLE) {
        token().pause();
    }

    function unpauseToken() external onlyRole(DEFAULT_ADMIN_ROLE) {
        token().unpause();
    }

    function addBlacklist(address account) external onlyRole(ACCESS_MANAGER_ROLE) {
        token().blacklist(account);
    }

    function removeBlacklist(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        token().unblacklist(account);
    }

    function updateBurnMinAmount(uint248 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        token().updateBurnMinAmount(amount);
    }

    function destroyBlackFunds(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        token().destroyBlackFunds(account);
    }

    function setWhitelistEnabled(bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        token().setWhitelistEnabled(enabled);
    }

    function updateWhitelist(address user, bool status) external onlyRole(ACCESS_MANAGER_ROLE) {
        token().updateWhitelist(user, status);
    }

    function reclaimTokenFromUSDC(IERC20 _token) external onlyRole(DEFAULT_ADMIN_ROLE) {
        token().reclaimToken(_token, _msgSender());
    }

    function reclaimTRXFromUSDC(address payable _to) external onlyRole(DEFAULT_ADMIN_ROLE) {
        token().reclaimTRX(_to);
    }

    function reclaimToken(IERC20 _token, address _to) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        require(_to != address(0), "Invalid recipient address");
        uint256 balance = _token.balanceOf(address(this));
        _token.safeTransfer(_to, balance);
    }

    function reclaimTRX(address payable _to) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        require(_to != address(0), "Invalid address");
        uint256 balance = address(this).balance;
        require(balance != 0, "No TRX balance to reclaim");

        _to.transfer(balance);
    }

    function setTreasury(address _treasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_treasury != address(0), "Invalid treasury address");
        USDCControllerStorage storage $ = _getUSDCControllerStorage();
        address oldTreasury = $.treasury;
        $.treasury = _treasury;
        emit TreasurySet(oldTreasury, _treasury);
    }

    function setFeeRate(uint256 _feeRate) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_feeRate <= FEE_DENOMINATOR, "Invalid fee rate");
        USDCControllerStorage storage $ = _getUSDCControllerStorage();
        if (_feeRate != 0) {
            require($.treasury != address(0), "Treasury address is not set");
        }
        uint256 oldFeeRate = $.feeRate;
        $.feeRate = _feeRate;
        emit FeeRateSet(oldFeeRate, _feeRate);
    }

    function requestMint(address _to, uint256 _value, string calldata ethDepositTx)
    external
    whenNotPaused
    onlyRole(SYSTEM_OPERATOR_ROLE)
    {
        _requestMint(_to, _value, ethDepositTx);
    }

    function _requestMint(address _to, uint256 _value, string calldata ethDepositTx) internal {
        require(_to != address(0), "Invalid address");
        require(_value != 0, "Invalid value");
        require(ethDepositTx.isValidEthTxHash(), "Invalid eth deposit tx");

        USDCControllerStorage storage $ = _getUSDCControllerStorage();
        MintOperation storage op = $.mintOperations.push();
        op.to = _to;
        op.value = _value;
        op.requestedBlock = block.number;
        op.numberOfApproval = 0;
        op.paused = false;
        op.ethDepositTx = ethDepositTx;
        emit MintRequested(_to, _value, ethDepositTx, $.mintOperations.length - 1);
    }

    function ownerMint(address _to, uint256 _value, string calldata ethDepositTx) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_to != address(0), "Invalid address");
        require(_value != 0, "Invalid value");
        require(ethDepositTx.isValidEthTxHash(), "Invalid eth deposit tx");

        USDCControllerStorage storage $ = _getUSDCControllerStorage();
        _requestMint(_to, _value, ethDepositTx);
        finalizeMint($.mintOperations.length - 1);
    }

    function instantMint(address _to, uint256 _value, string calldata ethDepositTx)
    external
    whenNotPaused
    onlyRole(SYSTEM_OPERATOR_ROLE)
    {
        require(_to != address(0), "Invalid address");
        require(_value != 0, "Invalid value");
        require(ethDepositTx.isValidEthTxHash(), "Invalid eth deposit tx");

        USDCControllerStorage storage $ = _getUSDCControllerStorage();
        require(_value <= $.instantMintThreshold, "Over the instant mint threshold");
        require(_value <= $.instantMintPool, "Instant mint pool is dry");

        uint256 fee = (_value * $.feeRate) / FEE_DENOMINATOR;
        uint256 mintAmount = _value - fee;

        $.instantMintPool = $.instantMintPool - _value;
        emit InstantMint(_to, mintAmount, ethDepositTx);
        $.token.mint(_to, mintAmount);

        if (fee != 0) {
            $.token.mint($.treasury, fee);
            emit FeePaid($.treasury, fee);
        }
    }

    function ratifyMint(uint256 _index, address _to, uint256 _value, string calldata ethDepositTx)
    external
    whenNotPaused
    onlyRole(MINT_RATIFIER_ROLE)
    {
        require(_to != address(0), "Invalid address");
        require(_value != 0, "Invalid value");
        require(ethDepositTx.isValidEthTxHash(), "Invalid eth deposit tx");

        USDCControllerStorage storage $ = _getUSDCControllerStorage();
        MintOperation storage op = $.mintOperations[_index];
        require(op.to == _to, "To address does not match");
        require(op.value == _value, "Amount does not match");
        require(keccak256(bytes(op.ethDepositTx)) == keccak256(bytes(ethDepositTx)), "Eth deposit tx does not match");
        require(!op.approved[_msgSender()], "Already approved");

        op.approved[_msgSender()] = true;
        op.numberOfApproval += 1;
        emit MintRatified(_index, _msgSender());
        if (hasEnoughApproval(op.numberOfApproval, _value)) {
            finalizeMint(_index);
        }
    }

    function finalizeMint(uint256 _index) public whenNotPaused {
        USDCControllerStorage storage $ = _getUSDCControllerStorage();
        MintOperation storage op = $.mintOperations[_index];

        address to = op.to;
        require(to != address(0), "Invalid address");
        uint256 value = op.value;
        string memory ethDepositTx = op.ethDepositTx;
        if (!hasRole(DEFAULT_ADMIN_ROLE, _msgSender())) {
            _canFinalize(_index);
            _subtractFromMintPool(value);
        }

        uint256 fee = (value * $.feeRate) / FEE_DENOMINATOR;
        uint256 mintAmount = value - fee;

        delete $.mintOperations[_index];
        $.token.mint(to, mintAmount);
        emit MintFinalized(to, mintAmount, ethDepositTx, _index);

        if (fee != 0) {
            $.token.mint($.treasury, fee);
            emit FeePaid($.treasury, fee);
        }
    }

    function _subtractFromMintPool(uint256 _value) internal {
        USDCControllerStorage storage $ = _getUSDCControllerStorage();
        if (_value <= $.ratifiedMintPool && _value <= $.ratifiedMintThreshold) {
            $.ratifiedMintPool = $.ratifiedMintPool - _value;
        } else {
            $.multiSigMintPool = $.multiSigMintPool - _value;
        }
    }

    function hasEnoughApproval(uint256 _numberOfApproval, uint256 _value) public view returns (bool) {
        USDCControllerStorage storage $ = _getUSDCControllerStorage();
        if (_value <= $.ratifiedMintPool && _value <= $.ratifiedMintThreshold) {
            if (_numberOfApproval >= RATIFY_MINT_SIGS) {
                return true;
            }
        }
        if (_value <= $.multiSigMintPool && _value <= $.multiSigMintThreshold) {
            if (_numberOfApproval >= MULTISIG_MINT_SIGS) {
                return true;
            }
        }
        if (hasRole(DEFAULT_ADMIN_ROLE, _msgSender())) {
            return true;
        }
        return false;
    }

    function _canFinalize(uint256 _index) internal view returns (bool) {
        USDCControllerStorage storage $ = _getUSDCControllerStorage();
        MintOperation storage op = $.mintOperations[_index];

        if (op.requestedBlock <= $.mintReqInvalidBeforeThisBlock) {
            revert("This mint is invalid");
        }
        if (op.paused) {
            revert("This mint is paused");
        }
        if (!hasEnoughApproval(op.numberOfApproval, op.value)) {
            revert("Not enough approvals");
        }

        return true;
    }

    function canFinalize(uint256 _index) public view returns (bool) {
        return _canFinalize(_index);
    }

    function revokeMint(uint256 _index) external onlyRole(SYSTEM_OPERATOR_ROLE) {
        USDCControllerStorage storage $ = _getUSDCControllerStorage();
        delete $.mintOperations[_index];
        emit MintRevoked(_index);
    }

    function pauseMint(uint256 _opIndex) external onlyRole(PAUSER_ROLE) {
        USDCControllerStorage storage $ = _getUSDCControllerStorage();
        $.mintOperations[_opIndex].paused = true;
        emit MintPaused(_opIndex, true);
    }

    function unpauseMint(uint256 _opIndex) external onlyRole(DEFAULT_ADMIN_ROLE) {
        USDCControllerStorage storage $ = _getUSDCControllerStorage();
        $.mintOperations[_opIndex].paused = false;
        emit MintPaused(_opIndex, false);
    }

    function mintOperationCount() public view returns (uint256) {
        USDCControllerStorage storage $ = _getUSDCControllerStorage();
        return $.mintOperations.length;
    }

    function setMintThresholds(uint256 _instant, uint256 _ratified, uint256 _multiSig) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_instant != 0, "Invalid thresholds");
        require(_instant <= _ratified && _ratified <= _multiSig, "Invalid thresholds");
        USDCControllerStorage storage $ = _getUSDCControllerStorage();

        // check if the new thresholds are less than or equal to the limits
        require(_instant <= $.instantMintLimit, "Instant mint threshold must be less than or equal to instant mint limit");
        require(_ratified <= $.ratifiedMintLimit, "Ratified mint threshold must be less than or equal to ratified mint limit");
        require(_multiSig <= $.multiSigMintLimit, "Multi-sig mint threshold must be less than or equal to multi-sig mint limit");

        $.instantMintThreshold = _instant;
        $.ratifiedMintThreshold = _ratified;
        $.multiSigMintThreshold = _multiSig;
        emit MintThresholdChanged(_instant, _ratified, _multiSig);
    }

    function setMintLimits(uint256 _instant, uint256 _ratified, uint256 _multiSig) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_instant != 0, "Invalid limits");
        require(_instant <= _ratified && _ratified <= _multiSig, "Invalid limits");
        USDCControllerStorage storage $ = _getUSDCControllerStorage();

        // check if the new limits are greater than or equal to the thresholds
        require(_instant >= $.instantMintThreshold, "Instant mint limit must be greater than or equal to instant mint threshold");
        require(_ratified >= $.ratifiedMintThreshold, "Ratified mint limit must be greater than or equal to ratified mint threshold");
        require(_multiSig >= $.multiSigMintThreshold, "Multi-sig mint limit must be greater than or equal to multi-sig mint threshold");

        $.instantMintLimit = _instant;
        if ($.instantMintPool > _instant) {
            $.instantMintPool = _instant;
        }
        $.ratifiedMintLimit = _ratified;
        if ($.ratifiedMintPool > _ratified) {
            $.ratifiedMintPool = _ratified;
        }
        $.multiSigMintLimit = _multiSig;
        if ($.multiSigMintPool > _multiSig) {
            $.multiSigMintPool = _multiSig;
        }
        emit MintLimitsChanged(_instant, _ratified, _multiSig);
    }

    function refillInstantMintPool() external onlyRole(MINT_RATIFIER_ROLE) {
        USDCControllerStorage storage $ = _getUSDCControllerStorage();
        uint256 refillAmount = $.instantMintLimit - $.instantMintPool;
        $.ratifiedMintPool -= refillAmount;
        $.instantMintPool = $.instantMintLimit;
        emit PoolRefilled("Instant", refillAmount);
    }

    function refillRatifiedMintPool() external onlyRole(MINT_RATIFIER_ROLE) {
        USDCControllerStorage storage $ = _getUSDCControllerStorage();
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
        uint256 refillAmount = $.ratifiedMintLimit - $.ratifiedMintPool;
        $.multiSigMintPool -= refillAmount;
        $.ratifiedMintPool = $.ratifiedMintLimit;
        emit PoolRefilled("Ratified", refillAmount);
    }

    function refillMultiSigMintPool() external onlyRole(DEFAULT_ADMIN_ROLE) {
        USDCControllerStorage storage $ = _getUSDCControllerStorage();
        uint256 refillAmount = $.multiSigMintLimit - $.multiSigMintPool;
        $.multiSigMintPool = $.multiSigMintLimit;
        emit PoolRefilled("MultiSig", refillAmount);
    }

    function invalidateAllPendingMints() external onlyRole(DEFAULT_ADMIN_ROLE) {
        USDCControllerStorage storage $ = _getUSDCControllerStorage();
        $.mintReqInvalidBeforeThisBlock = block.number;
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function transferTokenOwnership(address newOwner) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newOwner != address(0), "New owner is the zero address");
        token().transferOwnership(newOwner);
    }

    function claimTokenOwnership() external onlyRole(DEFAULT_ADMIN_ROLE) {
        token().acceptOwnership();
    }

    function token() public view returns (IUSDC) {
        USDCControllerStorage storage $ = _getUSDCControllerStorage();
        return $.token;
    }

    function setToken(address _newToken) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_newToken != address(0), "Invalid address");
        USDCControllerStorage storage $ = _getUSDCControllerStorage();
        $.token = IUSDC(_newToken);
    }

    function getFeeRate() public view returns (uint256) {
        return _getUSDCControllerStorage().feeRate;
    }

    function getTreasury() public view returns (address) {
        return _getUSDCControllerStorage().treasury;
    }

    function getMintOperation(uint256 index) public view returns (MintOperationView memory) {
        USDCControllerStorage storage $ = _getUSDCControllerStorage();
        if (index >= $.mintOperations.length) revert InvalidOperation();
        MintOperation storage op = $.mintOperations[index];
        return MintOperationView({
            to: op.to,
            value: op.value,
            requestedBlock: op.requestedBlock,
            numberOfApproval: op.numberOfApproval,
            paused: op.paused,
            ethDepositTx: op.ethDepositTx
        });
    }

    function getInstantMintThreshold() public view returns (uint256) {
        return _getUSDCControllerStorage().instantMintThreshold;
    }

    function getRatifiedMintThreshold() public view returns (uint256) {
        return _getUSDCControllerStorage().ratifiedMintThreshold;
    }

    function getMultiSigMintThreshold() public view returns (uint256) {
        return _getUSDCControllerStorage().multiSigMintThreshold;
    }

    function getInstantMintLimit() public view returns (uint256) {
        return _getUSDCControllerStorage().instantMintLimit;
    }

    function getRatifiedMintLimit() public view returns (uint256) {
        return _getUSDCControllerStorage().ratifiedMintLimit;
    }

    function getMultiSigMintLimit() public view returns (uint256) {
        return _getUSDCControllerStorage().multiSigMintLimit;
    }

    function getInstantMintPool() public view returns (uint256) {
        return _getUSDCControllerStorage().instantMintPool;
    }

    function getRatifiedMintPool() public view returns (uint256) {
        return _getUSDCControllerStorage().ratifiedMintPool;
    }

    function getMultiSigMintPool() public view returns (uint256) {
        return _getUSDCControllerStorage().multiSigMintPool;
    }

    function getMintReqInvalidBeforeThisBlock() public view returns (uint256) {
        return _getUSDCControllerStorage().mintReqInvalidBeforeThisBlock;
    }

    function getRatifiedPoolRefillApprovals() public view returns (address[2] memory) {
        return _getUSDCControllerStorage().ratifiedPoolRefillApprovals;
    }
}