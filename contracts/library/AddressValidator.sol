// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

library AddressValidator {
    function isValidEthAddress(string memory targetEthAddress) internal pure returns (bool) {
        bytes memory addressBytes = bytes(targetEthAddress);
        if (addressBytes.length != 42) return false;
        if (addressBytes[0] != '0' || addressBytes[1] != 'x') return false;
        for (uint i = 2; i < 42; i++) {
            bytes1 char = addressBytes[i];
            if (!(char >= '0' && char <= '9') &&
                !(char >= 'a' && char <= 'f') &&
                !(char >= 'A' && char <= 'F')) {
                return false;
            }
        }
        return true;
    }
}
