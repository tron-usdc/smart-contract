// scripts/deploy_upgradeable_contracts.js
const {ethers, upgrades} = require('hardhat');
const {generateCalldata} = require('./utils');

let USDCController, controller, USDC, usdc;
let owner, user1, user2, systemOperator, mintRatifier1, mintRatifier2, mintRatifier3, whitelistManager, treasury;
const SYSTEM_OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("SYSTEM_OPERATOR_ROLE"));
const MINT_RATIFIER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINT_RATIFIER_ROLE"));
const ACCESS_MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ACCESS_MANAGER_ROLE"));
const PAUSER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PAUSER_ROLE"));
const minBurnAmount = ethers.parseUnits("10", 6);
const ethDepositTx = "0x1234567890123456789012345678901234567890123456789012345678901234";

async function main() {
  [owner, user1, user2, systemOperator, mintRatifier1, mintRatifier2, mintRatifier3, whitelistManager, treasury] = await ethers.getSigners();
  try {

    // Deploy USDC
    USDC = await ethers.getContractFactory("USDC");
    usdc = await upgrades.deployProxy(USDC, [owner.address, minBurnAmount]);
    await usdc.waitForDeployment();
    console.log('USDC deployed at:', await usdc.getAddress());

    // Deploy USDCController
    USDCController = await ethers.getContractFactory('USDCController');
    controller = await upgrades.deployProxy(USDCController, [
      await usdc.getAddress(),
      owner.address,
      ethers.parseUnits("1000", 6), // instantMintThreshold
      ethers.parseUnits("10000", 6), // ratifiedMintThreshold
      ethers.parseUnits("100000", 6), // multiSigMintThreshold
      ethers.parseUnits("10000", 6), // instantMintLimit
      ethers.parseUnits("100000", 6), // ratifiedMintLimit
      ethers.parseUnits("1000000", 6), // multiSigMintLimit
      1000, // feeRate (0.1%)
      treasury.address
    ]);
    await controller.waitForDeployment();
    console.log('USDCController deployed at:', await controller.getAddress());

    // Setup roles
    await controller.grantRole(SYSTEM_OPERATOR_ROLE, systemOperator.address);
    await controller.grantRole(MINT_RATIFIER_ROLE, mintRatifier1.address);
    await controller.grantRole(MINT_RATIFIER_ROLE, mintRatifier2.address);
    await controller.grantRole(MINT_RATIFIER_ROLE, mintRatifier3.address);
    await controller.grantRole(ACCESS_MANAGER_ROLE, whitelistManager.address);
    await controller.grantRole(PAUSER_ROLE, owner.address);

    // transfer ownership of USDC to controller
    await usdc.connect(owner).transferOwnership(await controller.getAddress());
    await controller.claimTokenOwnership();

    // set user1 in whitelist
    await controller.connect(whitelistManager).updateWhitelist(user1.address, true);

    // // generate initialize calldata
    // functionSignature = 'initialize(address,address,uint256,uint256,uint256,uint256,address)';
    // calldata = await generateCalldata(functionSignature, await mockERC20.getAddress(), ownerAddress, instantThreshold, ratifiedThreshold, multiSigThreshold, 1000, treasurer.address);
    // console.log('Initializing TronUSDCBridgeController: ', calldata);
    console.log('All contracts deployed successfully');
  } catch (error) {
    console.error('Error deploying contracts:', error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
