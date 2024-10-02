// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";

interface IUSDC {
    function mint(address to, uint256 amount) external;

    function blacklist(address account) external;

    function unblacklist(address account) external;

    function setWhitelistEnabled(bool enabled) external;

    function updateBurnMinAmount(uint248 amount) external;

    function updateWhitelist(address user, bool status) external;

    function destroyBlackFunds(address _blackListedUser) external;

    function pause() external;

    function unpause() external;

    function acceptOwnership() external;

    function transferOwnership(address newOwner) external;

    function reclaimToken(IERC20 token, address _to) external;

    function reclaimTRX(address payable _to) external;
}
