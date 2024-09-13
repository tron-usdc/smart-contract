// scripts/deploy_upgradeable_contracts.js
const {ethers} = require('hardhat');

let TronUSDCBridgeController, controller, TronUSDCBridge, tronUsdcBridge, MockUSDC, mockUSDC;
let owner, user1, user2, systemOperator, withdrawRatifier1, withdrawRatifier2, withdrawRatifier3, whitelistManager,
  treasurer, fundManager;
const SYSTEM_OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("SYSTEM_OPERATOR_ROLE"));
const WITHDRAW_RATIFIER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("WITHDRAW_RATIFIER_ROLE"));
const WHITELIST_MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("WHITELIST_MANAGER_ROLE"));
const PAUSER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PAUSER_ROLE"));
const FUND_MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FUND_MANAGER_ROLE"));
const targetTronAddress = "TE7nS8MkeR2p7quxUvjaGQLd5YtkXBTCfc";
const tronBurnTx = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const USDC_DECIMALS = 6;

const mockErc20Address = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const tronUsdcBridgeAddress = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';
const tronUsdcBridgeControllerAddress = '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9';


async function main() {
  [owner, user1, user2, systemOperator, withdrawRatifier1, withdrawRatifier2, withdrawRatifier3, whitelistManager, treasurer, fundManager] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory('MockERC20');
  const TronUSDCBridge = await ethers.getContractFactory('TronUSDCBridge');
  try {
    // Get balance of owner from mock ERC20
    const mockERC20 = await MockERC20.attach(mockErc20Address);
    const balance = await mockERC20.balanceOf(owner.address);
    console.log('Balance of deployer:', balance.toString());

    // deposit to TronUSDCBridge
    const tronUSDCBridge = await TronUSDCBridge.attach(tronUsdcBridgeAddress);
    const depositAmount = ethers.parseUnits('100', USDC_DECIMALS);
    const tx = await tronUSDCBridge.connect(user1).deposit(depositAmount, targetTronAddress);
    await tx.wait();
    console.log('Deposit transaction hash:', tx.hash);
  } catch (error) {
    console.error('Error:', error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
