// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {AddressValidator} from "./library/AddressValidator.sol";

/**
 * @title USD Coin (USDC)
 * @dev Implementation of the USDC with custom storage slot
 */
contract USDC is Initializable, ContextUpgradeable, ERC20Upgradeable, PausableUpgradeable, Ownable2StepUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;
    using AddressValidator for string;
    uint256 public constant INITIAL_SUPPLY = 0;
    uint8 private constant DECIMALS = 6;

    struct USDCStorage {
        mapping(address => bool) blacklisted;
        mapping(address => bool) whitelist;
        uint248 minBurnAmount;
        bool whitelistEnabled;
    }

    // keccak256(abi.encode(uint256(keccak256("TronUSDC.storage.USDC")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant USDCStorageLocation = 0x8d1a8256f6446413ff37a18c456706183f07c6c0523543f91f2a9dbf5d227e00;

    function _getUSDCStorage() private pure returns (USDCStorage storage $) {
        assembly {
            $.slot := USDCStorageLocation
        }
    }

    event WhitelistUpdated(address indexed user, bool status);
    event MinBurnAmountUpdated(uint256 oldAmount, uint256 newAmount);
    event BlacklistUpdated(address indexed user, bool status);
    event Burned(address indexed user, string targetEthAddress, uint256 amount);
    event DestroyedBlackFunds(address indexed user, uint256 amount);
    event WhitelistStatusChanged(bool enabled);

    function initialize(address owner, uint248 minBurnAmount) initializer public {
        require(owner != address(0), "Invalid owner address");
        require(minBurnAmount != 0, "Minimum burn amount must be greater than 0");

        __Ownable_init(owner);
        __ERC20_init("USD Coin", "USDC");
        __Pausable_init();

        USDCStorage storage $ = _getUSDCStorage();
        $.minBurnAmount = minBurnAmount;
        $.whitelistEnabled = true;

        _mint(_msgSender(), INITIAL_SUPPLY);
    }

    modifier notBlacklisted(address _account) {
        require(
            !isBlacklisted(_account),
            "Blacklistable: account is blacklisted"
        );
        _;
    }

    modifier onlyWhitelisted(address _account) {
        USDCStorage storage $ = _getUSDCStorage();
        require(
            !$.whitelistEnabled || isWhitelisted(_account),
            "Whitelistable: account is not whitelisted"
        );
        _;
    }

    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }

    function mint(address to, uint256 amount)
    public
    onlyOwner
    whenNotPaused
    notBlacklisted(to)
    {
        _mint(to, amount);
    }

    function burn(uint256 amount, string calldata targetEthAddress)
    public
    whenNotPaused
    notBlacklisted(_msgSender())
    onlyWhitelisted(_msgSender())
    {
        USDCStorage storage $ = _getUSDCStorage();
        require(amount >= $.minBurnAmount, "Amount less than min burn amount");
        require(targetEthAddress.isValidEthAddress(), "Invalid target eth address");

        _burn(_msgSender(), amount);
        emit Burned(_msgSender(), targetEthAddress, amount);
    }

    function blacklist(address account) public onlyOwner {
        USDCStorage storage $ = _getUSDCStorage();
        $.blacklisted[account] = true;
        emit BlacklistUpdated(account, true);
    }

    function unblacklist(address account) public onlyOwner {
        USDCStorage storage $ = _getUSDCStorage();
        $.blacklisted[account] = false;
        emit BlacklistUpdated(account, false);
    }

    function isBlacklisted(address account) public view returns (bool) {
        USDCStorage storage $ = _getUSDCStorage();
        return $.blacklisted[account];
    }

    function approve(address spender, uint256 amount)
    public
    override
    notBlacklisted(_msgSender())
    notBlacklisted(spender)
    returns (bool)
    {
        return super.approve(spender, amount);
    }

    function transfer(address to, uint256 value)
    public
    override
    notBlacklisted(_msgSender())
    notBlacklisted(to)
    returns (bool)
    {
        return super.transfer(to, value);
    }

    function transferFrom(address from, address to, uint256 value)
    public
    override
    notBlacklisted(_msgSender())
    notBlacklisted(from)
    notBlacklisted(to)
    returns (bool)
    {
        return super.transferFrom(from, to, value);
    }

    function destroyBlackFunds(address _blackListedUser) external onlyOwner {
        require(isBlacklisted(_blackListedUser), "USDC: account is not blacklisted");
        uint256 amount = balanceOf(_blackListedUser);
        _burn(_blackListedUser, amount);

        emit DestroyedBlackFunds(_blackListedUser, amount);
    }

    function updateBurnMinAmount(uint248 amount) external onlyOwner {
        require(amount != 0, "Amount must be greater than 0");
        USDCStorage storage $ = _getUSDCStorage();
        uint256 oldAmount = $.minBurnAmount;
        $.minBurnAmount = amount;
        emit MinBurnAmountUpdated(oldAmount, amount);
    }

    function setWhitelistEnabled(bool enabled) external onlyOwner {
        USDCStorage storage $ = _getUSDCStorage();
        $.whitelistEnabled = enabled;
        emit WhitelistStatusChanged(enabled);
    }

    function updateWhitelist(address user, bool status) external onlyOwner {
        USDCStorage storage $ = _getUSDCStorage();
        $.whitelist[user] = status;
        emit WhitelistUpdated(user, status);
    }

    function isWhitelistEnabled() public view returns (bool) {
        USDCStorage storage $ = _getUSDCStorage();
        return $.whitelistEnabled;
    }

    function isWhitelisted(address user) public view returns (bool) {
        USDCStorage storage $ = _getUSDCStorage();
        return $.whitelist[user];
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function getMinBurnAmount() public view returns (uint256) {
        USDCStorage storage $ = _getUSDCStorage();
        return $.minBurnAmount;
    }

    function reclaimToken(IERC20 token, address _to) external onlyOwner nonReentrant {
        require(_to != address(0), "Invalid recipient address");
        uint256 balance = token.balanceOf(address(this));
        token.safeTransfer(_to, balance);
    }

    function reclaimTRX(address payable _to) external onlyOwner nonReentrant {
        require(_to != address(0), "Invalid address");
        uint256 balance = address(this).balance;
        require(balance != 0, "No TRX balance to reclaim");

        _to.transfer(balance);
    }
}