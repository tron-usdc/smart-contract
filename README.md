# TRON-USDC Bridge

## Table of Contents

- [Project Overview](#project-overview)
- [Key Features](#key-features)
- [System Architecture](#system-architecture)
- [Quick Start](#quick-start)
- [Deployment](#deployment)
- [Usage Guide](#usage-guide)
- [Contract Functions](#contract-functions)
- [Security](#security)
- [Contribution Guidelines](#contribution-guidelines)
- [License](#license)
- [Contact Us](#contact-us)

## Project Overview

TRON-USDC Bridge is a cross-chain bridging solution that allows users to transfer USDC between the Ethereum and TRON networks. The project aims to maintain the stablecoin ecosystem on the TRON network, providing users with a secure and efficient way to operate USDC cross-chain.

## Key Features

- Supports USDC cross-chain from Ethereum to TRON
- Supports USDC cross-chain from TRON to Ethereum
- Multisignature and hierarchical approval mechanisms
- Flexible fee settings
- Blacklist and whitelist management
- Emergency pause function
- Fund management features

## System Architecture

The system mainly consists of four smart contracts:

1. **USDC**: The USDC token contract on the TRON network
2. **USDCController**: The controller contract managing USDC token on the TRON network
3. **TronUSDCBridge**: The USDC staking contract on the Ethereum network
4. **TronUSDCBridgeController**: The controller contract managing TronUSDCBridge on the Ethereum network

## Quick Start

### Prerequisites

- Node.js (v14+)
- Yarn or npm
- Hardhat

### Installation

1. Clone the repository:

   ```
   git clone https://github.com/tron-usdc/smart-contract.git
   ```

2. Install dependencies:

   ```
   cd smart-contract
   npm install
   ```

3. Compile contracts:

   ```
   npx hardhat compile
   ```

4. Run tests:

   ```
   npx hardhat test
   ```

## Deployment

1. Set environment variables (create a `.env` file):

   ```
   ETHEREUM_RPC_URL=<Your Ethereum RPC URL>
   TRON_RPC_URL=<Your TRON RPC URL>
   PRIVATE_KEY=<Your deployment wallet private key>
   ```

2. Deploy contracts:

   ```
   npx hardhat run scripts/eth_deploy.js --network <network-name>
   ```

## Usage Guide

### Cross-Chain from Ethereum to TRON

1. The user calls `TronUSDCBridge.deposit()` on Ethereum to stake USDC.
2. The system operator calls `USDCController.instantMint()` or `USDCController.requestMint()` on the TRON network.
3. Depending on the amount, one or more approvers may need to call `USDCController.ratifyMint()`.
4. After reaching a sufficient number of approvals, `USDCController.finalizeMint()` is automatically called to complete the minting.

### Cross-Chain from TRON to Ethereum

1. The user calls `USDC.burn()` on the TRON network to burn USDC.
2. The system operator calls `TronUSDCBridgeController.instantWithdraw()` or `TronUSDCBridgeController.requestWithdraw()` on the Ethereum network.
3. Depending on the amount, one or more approvers may need to call `TronUSDCBridgeController.ratifyWithdraw()`.
4. After reaching a sufficient number of approvals, `TronUSDCBridgeController.finalizeWithdraw()` is automatically called to complete the withdrawal.

## Contract Functions

### USDC Contract

- Standard ERC20 functions
- `mint`, `burn` and `pause` functions
- Blacklist and whitelist management

### USDCController Contract

- Manages the minting process, implementing multisignature and hierarchical approval mechanisms
- Blacklist and whitelist management
- Configures minting fee rates and fee recipients
- Sets minimum burn amount

### TronUSDCBridge Contract

- Users deposit USDC
- Administrators withdraw USDC for investment purpose

### TronUSDCBridgeController Contract

- Manages withdrawal operations, implementing multisignature and hierarchical approval mechanisms
- Sets investment addresses and manages idle funds
- User access management
- Sets withdrawal fee rates and fee recipients
- Defines minimum deposit amount

## Security

- Multisignature mechanism ensures the security of large transactions
- Hierarchical approval process requires different levels of approval based on the amount
- whitelist mechanism effectively control user access
- Emergency pause function to address potential security threats
- Regular security audits and updates

## License

This project is licensed under the [MIT License](LICENSE).