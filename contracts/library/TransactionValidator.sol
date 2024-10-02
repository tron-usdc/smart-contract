// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

library TransactionValidator {
    function isValidEthTxHash(string calldata ethTxHash) internal pure returns (bool) {
        bytes calldata txBytes = bytes(ethTxHash);
        if (txBytes.length != 66) return false;
        if (txBytes[0] != '0' || txBytes[1] != 'x') return false;
        return isValidHashContent(txBytes, 2);
    }

    function isValidTronTxHash(string calldata tronTxHash) internal pure returns (bool) {
        bytes calldata txBytes = bytes(tronTxHash);
        if (txBytes.length != 64) return false;
        return isValidHashContent(txBytes, 0);
    }

    function isValidHashContent(bytes calldata txBytes, uint startIndex) private pure returns (bool) {
        for (uint i = startIndex; i < txBytes.length; i++) {
            bytes1 char = txBytes[i];
            if (!(char >= '0' && char <= '9') &&
                !(char >= 'a' && char <= 'f') &&
                !(char >= 'A' && char <= 'F')) {
                return false;
            }
        }
        return true;
    }
}