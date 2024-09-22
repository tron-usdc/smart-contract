// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";

interface ITronUSDCBridge {
    function withdraw(address user, uint256 amount) external;

    function setWhitelistEnabled(bool enabled) external;

    function updateWhitelist(address user, bool status) external;

    function pause() external;

    function unpause() external;

    function transferUSDC(address to, uint256 amount) external;

    function setMinDepositAmount(uint256 _newAmount) external;

    function reclaimEther(address payable _to) external;

    function reclaimToken(IERC20 token, address _to) external;

    function acceptOwnership() external;

    function transferOwnership(address newOwner) external;

    function setToken(address _newToken) external;
}
