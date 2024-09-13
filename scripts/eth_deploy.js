// scripts/deploy_upgradeable_contracts.js
const {ethers, upgrades} = require('hardhat');
const {generateCalldata} = require('./utils');

let TronUSDCBridgeController, controller, TronUSDCBridge, tronUsdcBridge, MockUSDC, mockUSDC;
let owner, user1;
let tx;
const USDC_DECIMALS = 6;

async function main() {
  [owner, user1] = await ethers.getSigners();
  try {
    // Deploy mock USDC
    MockUSDC = await ethers.getContractFactory("MockERC20");
    mockUSDC = await MockUSDC.deploy("Mock USDC", "USDC", ethers.parseUnits("1000000000", USDC_DECIMALS), owner.address);
    await mockUSDC.waitForDeployment();
    console.log('Mock USDC deployed at:', await mockUSDC.getAddress());

    // generate constructor calldata
    let functionSignature = 'initialize(string,string,uint256,address)';
    let calldata = await generateCalldata(functionSignature, "Mock USDC", "USDC", ethers.parseUnits("1000000000", USDC_DECIMALS), owner.address);
    console.log('Mock USDC constructor calldata: ', calldata);

    // Deploy TronUSDCBridge
    TronUSDCBridge = await ethers.getContractFactory("TronUSDCBridge");
    tronUsdcBridge = await upgrades.deployProxy(TronUSDCBridge, [
      await mockUSDC.getAddress(),
      owner.address,
      ethers.parseUnits("100", USDC_DECIMALS) // minDepositAmount
    ]);
    await tronUsdcBridge.waitForDeployment();
    console.log('TronUSDCBridge deployed at:', await tronUsdcBridge.getAddress());

    // // generate initialize calldata
    // functionSignature = 'initialize(address,address,uint256)';
    // calldata = await generateCalldata(functionSignature, await mockUSDC.getAddress(), owner.address, ethers.parseUnits("100", USDC_DECIMALS));
    // console.log('TronUSDCBridge initialize calldata: ', calldata);

    // Deploy TronUSDCBridgeController
    TronUSDCBridgeController = await ethers.getContractFactory('TronUSDCBridgeController');
    controller = await upgrades.deployProxy(TronUSDCBridgeController, [
      await tronUsdcBridge.getAddress(),
      owner.address,
      ethers.parseUnits("1000", 6), // instantWithdrawThreshold
      ethers.parseUnits("10000", 6), // ratifiedWithdrawThreshold
      ethers.parseUnits("100000", 6), // multiSigWithdrawThreshold
      1000, // feeRate (0.1%)
      owner.address
    ]);
    await controller.waitForDeployment();
    console.log('TronUSDCBridgeController deployed at:', await controller.getAddress());

    // transfer ownership of USDC to controller
    tx = await tronUsdcBridge.connect(owner).transferOwnership(await controller.getAddress());
    await tx.wait();
    tx = await controller.claimBridgeOwnership();
    await tx.wait();

    // Set user1 in whitelist
    tx = await controller.connect(owner).updateWhitelist(user1.address, true);
    await tx.wait();

    // mint some USDC to user1 and bridge
    tx = await mockUSDC.mint(user1.address, ethers.parseUnits("1000000", 6));
    await tx.wait();
    tx = await mockUSDC.mint(await tronUsdcBridge.getAddress(), ethers.parseUnits("1000000", 6));
    await tx.wait();

    // Approve USDC spending
    tx = await mockUSDC.connect(user1).approve(await tronUsdcBridge.getAddress(), ethers.MaxUint256);
    await tx.wait();

    // // generate initialize calldata
    // functionSignature = 'initialize(address,address,uint256,uint256,uint256,uint256,address)';
    // calldata = await generateCalldata(functionSignature, await mockUSDC.getAddress(), owner.address,
    //   ethers.parseUnits("1000", 6), ethers.parseUnits("10000", 6), ethers.parseUnits("100000", 6), 1000, owner.address);
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
