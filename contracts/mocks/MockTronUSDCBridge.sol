// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";

contract MockTronUSDCBridge {
    event Withdrawn(address indexed user, uint256 amount, string tronAddress);
    event WhitelistUpdated(address indexed user, bool status);
    event Paused();
    event Unpaused();
    event USDCTransferred(address indexed to, uint256 amount);
    event MinDepositAmountSet(uint256 newAmount);
    event MinWithdrawAmountSet(uint256 newAmount);
    event EtherReclaimed(address indexed to, uint256 amount);
    event TokenReclaimed(address indexed token, address indexed to, uint256 amount);

    mapping(address => uint256) public withdrawnAmounts;
    mapping(address => bool) public whitelist;
    bool public isPaused;
    uint256 public minDepositAmount;
    uint256 public minWithdrawAmount;

    function withdraw(address user, uint256 amount, string calldata tronAddress) external {
        require(!isPaused, "Contract is paused");
        require(whitelist[user], "User not whitelisted");
        require(amount >= minWithdrawAmount, "Amount below minimum");
        withdrawnAmounts[user] += amount;
        emit Withdrawn(user, amount, tronAddress);
    }

    function updateWhitelist(address user, bool status) external {
        whitelist[user] = status;
        emit WhitelistUpdated(user, status);
    }

    function pause() external {
        isPaused = true;
        emit Paused();
    }

    function unpause() external {
        isPaused = false;
        emit Unpaused();
    }

    function transferUSDC(address to, uint256 amount) external {
        require(!isPaused, "Contract is paused");
        // In a real contract, this would transfer USDC. Here we just emit an event.
        emit USDCTransferred(to, amount);
    }

    function setMinDepositAmount(uint256 _newAmount) external {
        minDepositAmount = _newAmount;
        emit MinDepositAmountSet(_newAmount);
    }

    function setMinWithdrawAmount(uint256 _newAmount) external {
        minWithdrawAmount = _newAmount;
        emit MinWithdrawAmountSet(_newAmount);
    }

    function reclaimEther(address payable _to) external {
        uint256 balance = address(this).balance;
        (bool sent, ) = _to.call{value: balance}("");
        require(sent, "Failed to send Ether");
        emit EtherReclaimed(_to, balance);
    }

    function reclaimToken(IERC20 token, address _to) external {
        uint256 balance = token.balanceOf(address(this));
        require(token.transfer(_to, balance), "Token transfer failed");
        emit TokenReclaimed(address(token), _to, balance);
    }

    // Additional helper functions for testing
    function getWithdrawnAmount(address user) external view returns (uint256) {
        return withdrawnAmounts[user];
    }

    function resetWithdrawnAmount(address user) external {
        withdrawnAmounts[user] = 0;
    }

    // Function to receive Ether
    receive() external payable {}
}