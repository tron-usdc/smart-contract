// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

contract TronUSDCBridge is Initializable, ContextUpgradeable, Ownable2StepUpgradeable, ReentrancyGuardUpgradeable, PausableUpgradeable {
    using SafeERC20 for IERC20;
    uint256 public constant USDC_DECIMALS = 6;

    /// @custom:storage-location erc7201:openzeppelin.storage.USDCStakingBridge
    struct BridgeStorage {
        IERC20 usdcToken;
        mapping(address => bool) whitelist;
        uint256 totalDeposited;
        uint256 minDepositAmount;
        bool whitelistEnabled;
    }

    // keccak256(abi.encode(uint256(keccak256("TronUSDC.storage.TronUSDCBridge")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant USDCStakingBridgeStorageLocation = 0x315abe1f1ea471b2b43acfdbc458e55454fd425d614c5ff1b6114d9670f90800;

    function _getBridgeStorage() private pure returns (BridgeStorage storage $) {
        assembly {
            $.slot := USDCStakingBridgeStorageLocation
        }
    }

    event Deposited(address indexed user, uint256 amount, string targetTronAddress);
    event Withdrawn(address indexed user, uint256 amount);
    event WhitelistUpdated(address indexed user, bool status);
    event USDCTransferred(address indexed to, uint256 amount);
    event MinDepositAmountUpdated(uint256 oldAmount, uint256 newAmount);
    event WhitelistStatusChanged(bool enabled);

    function initialize(
        address _usdcToken,
        address owner,
        uint256 _minDepositAmount
    ) public initializer {
        require(_usdcToken != address(0), "Invalid USDC token address");
        require(owner != address(0), "Invalid owner address");
        require(_minDepositAmount > 0, "Minimum deposit amount must be greater than 0");

        __ReentrancyGuard_init();
        __Pausable_init();
        __Ownable_init(owner);

        BridgeStorage storage $ = _getBridgeStorage();
        $.usdcToken = IERC20(_usdcToken);
        $.minDepositAmount = _minDepositAmount;
        $.whitelistEnabled = true;
    }

    modifier onlyWhitelisted(address _account) {
        BridgeStorage storage $ = _getBridgeStorage();
        require(
            !$.whitelistEnabled || isWhitelisted(_account),
            "Whitelistable: account is not whitelisted"
        );
        _;
    }

    function usdcToken() public view returns (IERC20) {
        BridgeStorage storage $ = _getBridgeStorage();
        return $.usdcToken;
    }

    function deposit(uint256 amount, string calldata targetTronAddress) external
    nonReentrant
    whenNotPaused
    onlyWhitelisted(_msgSender())
    {
        BridgeStorage storage $ = _getBridgeStorage();
        require(amount >= $.minDepositAmount, "Amount below minimum transfer amount");
        require(bytes(targetTronAddress).length == 34, "Invalid Tron address length");

        $.usdcToken.safeTransferFrom(_msgSender(), address(this), amount);
        $.totalDeposited += amount;
        emit Deposited(_msgSender(), amount, targetTronAddress);
    }

    function withdraw(address user, uint256 amount) external nonReentrant whenNotPaused onlyOwner {
        BridgeStorage storage $ = _getBridgeStorage();
        require(user != address(0), "Invalid recipient address");
        require(amount <= USDCBalance(), "Insufficient USDC balance");

        $.totalDeposited -= amount;
        $.usdcToken.safeTransfer(user, amount);
        emit Withdrawn(user, amount);
    }

    function setMinDepositAmount(uint256 amount) external onlyOwner {
        BridgeStorage storage $ = _getBridgeStorage();
        uint256 oldAmount = $.minDepositAmount;
        $.minDepositAmount = amount;
        emit MinDepositAmountUpdated(oldAmount, amount);
    }

    function setWhitelistEnabled(bool enabled) external onlyOwner {
        BridgeStorage storage $ = _getBridgeStorage();
        $.whitelistEnabled = enabled;
        emit WhitelistStatusChanged(enabled);
    }

    function updateWhitelist(address user, bool status) external onlyOwner {
        BridgeStorage storage $ = _getBridgeStorage();
        $.whitelist[user] = status;
        emit WhitelistUpdated(user, status);
    }

    function transferUSDC(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid recipient address");
        require(amount > 0, "Amount must be greater than 0");
        require(amount <= USDCBalance(), "Insufficient USDC balance");

        usdcToken().safeTransfer(to, amount);
        emit USDCTransferred(to, amount);
    }

    function USDCBalance() public view returns (uint256) {
        return usdcToken().balanceOf(address(this));
    }

    function isWhitelistEnabled() public view returns (bool) {
        BridgeStorage storage $ = _getBridgeStorage();
        return $.whitelistEnabled;
    }

    function isWhitelisted(address user) public view returns (bool) {
        BridgeStorage storage $ = _getBridgeStorage();
        return $.whitelist[user];
    }

    function getTotalDeposited() public view returns (uint256) {
        BridgeStorage storage $ = _getBridgeStorage();
        return $.totalDeposited;
    }

    function getMinDepositAmount() public view returns (uint256) {
        BridgeStorage storage $ = _getBridgeStorage();
        return $.minDepositAmount;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /**
    * @dev send all eth balance in the contract to another address
     * @param _to address to send eth balance to
     */
    function reclaimEther(address payable _to) external onlyOwner {
        require(_to != address(0), "Invalid address");
        uint256 balance = address(this).balance;
        (bool success,) = _to.call{value: balance}("");
        require(success, "Transfer failed");
    }

    /**
     * @dev send all token balance of an arbitrary erc20 token
     * in the contract to another address
     * @param token token to reclaim
     * @param _to address to send eth balance to
     */
    function reclaimToken(IERC20 token, address _to) external onlyOwner {
        require(_to != address(0), "Invalid address");
        require(address(token) != address(usdcToken()), "Cannot reclaim USDC");
        uint256 balance = token.balanceOf(address(this));
        token.safeTransfer(_to, balance);
    }
}