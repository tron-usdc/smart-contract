// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

library AddressValidator {
    function isValidEthAddress(string calldata targetEthAddress) internal pure returns (bool) {
        bytes calldata addressBytes = bytes(targetEthAddress);
        if (addressBytes.length != 42) return false;
        if (addressBytes[0] != '0' || addressBytes[1] != 'x') return false;

        bool allZero = true;
        for (uint i = 2; i < 42; i++) {
            bytes1 char = addressBytes[i];
            if (!(char >= '0' && char <= '9') &&
                !(char >= 'a' && char <= 'f') &&
                !(char >= 'A' && char <= 'F')) {
                return false;
            }
            if (char != '0') {
                allZero = false;
            }
        }
        return !allZero;
    }

    bytes constant TRON_ZERO_ADDRESS_BYTES = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";

    function isValidTronAddress(string calldata targetTronAddress) internal pure returns (bool) {
        bytes calldata addr = bytes(targetTronAddress);

        if (addr.length != 34 || addr[0] != 'T') return false;
        if (keccak256(addr) == keccak256(TRON_ZERO_ADDRESS_BYTES)) {
            return false;
        }

        for (uint i = 1; i < 34; i++) {
            if (!isValidBase58Char(addr[i])) {
                return false;
            }
        }
        return true;
    }

    function isValidBase58Char(bytes1 c) private pure returns (bool) {
        return (
            (c >= '1' && c <= '9') ||
            (c >= 'A' && c <= 'H') ||
            (c >= 'J' && c <= 'N') ||
            (c >= 'P' && c <= 'Z') ||
            (c >= 'a' && c <= 'k') ||
            (c >= 'm' && c <= 'z')
        );
    }
}