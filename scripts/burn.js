// scripts/deploy_upgradeable_contracts.js
const {ethers} = require('hardhat');

let USDCController, controller, USDC, usdc;
let owner, user1, user2, systemOperator, mintRatifier1, mintRatifier2, mintRatifier3, whitelistManager, treasury;
const SYSTEM_OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("SYSTEM_OPERATOR_ROLE"));
const MINT_RATIFIER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINT_RATIFIER_ROLE"));
const ACCESS_MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ACCESS_MANAGER_ROLE"));
const PAUSER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PAUSER_ROLE"));
const minBurnAmount = ethers.parseUnits("10", 6);
const ethDepositTx = "0x1234567890123456789012345678901234567890123456789012345678901234";
const targetEthAddress = "0x1234567890123456789012345678901234567890";

const usdcAddress = '0x9A9f2CCfdE556A7E9Ff0848998Aa4a0CFD8863AE';
const usdcControllerAddress = '0x3Aa5ebB10DC797CAC828524e59A333d0A371443c';

async function main() {
  [owner, user1, user2, systemOperator, mintRatifier1, mintRatifier2, mintRatifier3, whitelistManager, treasury] = await ethers.getSigners();
  const USDC = await ethers.getContractFactory("USDC");
  const USDCController = await ethers.getContractFactory('USDCController');

  try {
    usdc = await USDC.attach(usdcAddress);
    controller = await USDCController.attach(usdcControllerAddress);
    // mint to user1
    let tx = await controller.connect(systemOperator).instantMint(user1.address, ethers.parseUnits('1000', 6), ethDepositTx);
    await tx.wait();
    console.log('Mint transaction hash:', tx.hash);

    // user1 burns
    const burnAmount = ethers.parseUnits('100', 6);
    tx = await usdc.connect(user1).burn(burnAmount, targetEthAddress);
    await tx.wait();
    console.log('Burn transaction hash:', tx.hash);
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
