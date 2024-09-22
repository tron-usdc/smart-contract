const {expect} = require("chai");
const {ethers, upgrades} = require("hardhat");

describe('TronUSDCBridgeTest', function () {
  let TronUSDCBridge, tronUSDCBridge, MockUSDC, mockUSDC, mockUSDC2;
  let owner, user1, user2, user3;
  const USDC_DECIMALS = 6;
  const targetTronAddress = "TE7nS8MkeR2p7quxUvjaGQLd5YtkXBTCfc";
  const invalidTargetTronTddress = "InvalidAddress";

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();

    MockUSDC = await ethers.getContractFactory("MockERC20");
    mockUSDC = await MockUSDC.deploy("Mock USDC", "USDC", ethers.parseUnits("1000000", USDC_DECIMALS), owner.address);
    await mockUSDC.waitForDeployment();

    mockUSDC2 = await MockUSDC.deploy("Mock USDC 2", "USDC2", ethers.parseUnits("1000000", USDC_DECIMALS), owner.address);
    await mockUSDC2.waitForDeployment();

    TronUSDCBridge = await ethers.getContractFactory('TronUSDCBridge');
    tronUSDCBridge = await upgrades.deployProxy(TronUSDCBridge, [
      await mockUSDC.getAddress(),
      owner.address,
      ethers.parseUnits("100", USDC_DECIMALS) // minDepositAmount
    ]);
    await tronUSDCBridge.waitForDeployment();

    await mockUSDC.mint(user1.address, ethers.parseUnits("10000", USDC_DECIMALS));
    await mockUSDC.mint(user2.address, ethers.parseUnits("10000", USDC_DECIMALS));

    await mockUSDC.connect(user1).approve(await tronUSDCBridge.getAddress(), ethers.MaxUint256);
    await mockUSDC.connect(user2).approve(await tronUSDCBridge.getAddress(), ethers.MaxUint256);
  });

  describe("Initialization", function () {
    it("should set the correct owner", async function () {
      expect(await tronUSDCBridge.owner()).to.equal(owner.address);
    });

    it("should set the correct token address", async function () {
      expect(await tronUSDCBridge.token()).to.equal(await mockUSDC.getAddress());
    });

    it("should set the correct minimum deposit and withdraw amounts", async function () {
      expect(await tronUSDCBridge.getMinDepositAmount()).to.equal(ethers.parseUnits("100", USDC_DECIMALS));
    });

    it("should have whitelist enabled by default", async function () {
      expect(await tronUSDCBridge.isWhitelistEnabled()).to.be.true;
    });
  });

  describe("Deposit", function () {
    beforeEach(async function () {
      await tronUSDCBridge.updateWhitelist(user1.address, true);
    });

    it("should allow whitelisted users to deposit and update balances correctly", async function () {
      const depositAmount = ethers.parseUnits("1000", USDC_DECIMALS);
      const initialUserBalance = await mockUSDC.balanceOf(user1.address);
      const initialContractBalance = await mockUSDC.balanceOf(await tronUSDCBridge.getAddress());

      await expect(tronUSDCBridge.connect(user1).deposit(depositAmount, targetTronAddress))
        .to.emit(tronUSDCBridge, "Deposited")
        .withArgs(user1.address, depositAmount, targetTronAddress);

      const finalUserBalance = await mockUSDC.balanceOf(user1.address);
      const finalContractBalance = await mockUSDC.balanceOf(await tronUSDCBridge.getAddress());

      expect(finalUserBalance).to.equal(initialUserBalance - depositAmount);
      expect(finalContractBalance).to.equal(initialContractBalance + depositAmount);
    });

    it("should not allow non-whitelisted users to deposit", async function () {
      const depositAmount = ethers.parseUnits("1000", USDC_DECIMALS);
      await expect(tronUSDCBridge.connect(user2).deposit(depositAmount, targetTronAddress))
        .to.be.revertedWith("Whitelistable: account is not whitelisted");
    });

    it("should not allow deposits below minimum amount", async function () {
      const depositAmount = ethers.parseUnits("50", USDC_DECIMALS);
      await expect(tronUSDCBridge.connect(user1).deposit(depositAmount, targetTronAddress))
        .to.be.revertedWith("Amount below minimum transfer amount");
    });

    it("should reject invalid Tron address length", async function () {
      const depositAmount = ethers.parseUnits("1000", USDC_DECIMALS);
      await expect(tronUSDCBridge.connect(user1).deposit(depositAmount, invalidTargetTronTddress))
        .to.be.revertedWith("Invalid Tron address length");
    });

    it("should update total deposited amount correctly", async function () {
      const depositAmount = ethers.parseUnits("1000", USDC_DECIMALS);
      const initialTotalDeposited = await tronUSDCBridge.getTotalDeposited();

      await tronUSDCBridge.connect(user1).deposit(depositAmount, targetTronAddress);

      const finalTotalDeposited = await tronUSDCBridge.getTotalDeposited();
      expect(finalTotalDeposited).to.equal(initialTotalDeposited + depositAmount);
    });

    it("should allow non-whitelisted users to deposit when whitelist is disabled", async function () {
      await tronUSDCBridge.setWhitelistEnabled(false);
      const depositAmount = ethers.parseUnits("1000", USDC_DECIMALS);

      await expect(tronUSDCBridge.connect(user2).deposit(depositAmount, targetTronAddress))
        .to.not.be.reverted;
    });

  });

  describe("Withdraw", function () {
    beforeEach(async function () {
      await tronUSDCBridge.updateWhitelist(user1.address, true);
      await tronUSDCBridge.connect(user1).deposit(ethers.parseUnits("1000", USDC_DECIMALS), targetTronAddress);
    });

    it("should allow owner to withdraw and update balances correctly", async function () {
      const withdrawAmount = ethers.parseUnits("500", USDC_DECIMALS);
      const initialUserBalance = await mockUSDC.balanceOf(user2.address);
      const initialContractBalance = await mockUSDC.balanceOf(await tronUSDCBridge.getAddress());

      await expect(tronUSDCBridge.withdraw(user2.address, withdrawAmount))
        .to.emit(tronUSDCBridge, "Withdrawn")
        .withArgs(user2.address, withdrawAmount);

      const finalUserBalance = await mockUSDC.balanceOf(user2.address);
      const finalContractBalance = await mockUSDC.balanceOf(await tronUSDCBridge.getAddress());

      expect(finalUserBalance).to.equal(initialUserBalance + withdrawAmount);
      expect(finalContractBalance).to.equal(initialContractBalance - withdrawAmount);
    });

    it("should not allow non-owners to withdraw", async function () {
      const withdrawAmount = ethers.parseUnits("500", USDC_DECIMALS);
      await expect(tronUSDCBridge.connect(user1).withdraw(user2.address, withdrawAmount))
        .to.be.revertedWithCustomError(tronUSDCBridge, 'OwnableUnauthorizedAccount');
    });

    it("should not allow withdrawals to zero address", async function () {
      const withdrawAmount = ethers.parseUnits("500", USDC_DECIMALS);
      await expect(tronUSDCBridge.withdraw(ethers.ZeroAddress, withdrawAmount))
        .to.be.revertedWith("Invalid recipient address");
    });

    it("should not allow withdrawals greater than contract balance", async function () {
      const excessiveAmount = ethers.parseUnits("2000", USDC_DECIMALS);
      await expect(tronUSDCBridge.withdraw(user2.address, excessiveAmount))
        .to.be.revertedWith("Insufficient USDC balance");
    });

    it("should update total deposited amount correctly after withdrawal", async function () {
      const depositAmount = ethers.parseUnits("1000", USDC_DECIMALS);
      await tronUSDCBridge.connect(user1).deposit(depositAmount, targetTronAddress);

      const withdrawAmount = ethers.parseUnits("500", USDC_DECIMALS);
      const initialTotalDeposited = await tronUSDCBridge.getTotalDeposited();

      await tronUSDCBridge.withdraw(user2.address, withdrawAmount);

      const finalTotalDeposited = await tronUSDCBridge.getTotalDeposited();
      expect(finalTotalDeposited).to.equal(initialTotalDeposited - withdrawAmount);
    });

  });

  describe("Whitelist management", function () {
    it("should allow owner to update whitelist", async function () {
      await expect(tronUSDCBridge.updateWhitelist(user1.address, true))
        .to.emit(tronUSDCBridge, "WhitelistUpdated")
        .withArgs(user1.address, true);
      expect(await tronUSDCBridge.isWhitelisted(user1.address)).to.be.true;
    });

    it("should not allow non-owners to update whitelist", async function () {
      await expect(tronUSDCBridge.connect(user1).updateWhitelist(user2.address, true))
        .to.be.revertedWithCustomError(tronUSDCBridge, 'OwnableUnauthorizedAccount');
    });

    it("should prevent deposits from non-whitelisted users when whitelist is re-enabled", async function () {
      await tronUSDCBridge.setWhitelistEnabled(false);
      await tronUSDCBridge.setWhitelistEnabled(true);

      const depositAmount = ethers.parseUnits("1000", USDC_DECIMALS);
      await expect(tronUSDCBridge.connect(user2).deposit(depositAmount, targetTronAddress))
        .to.be.revertedWith("Whitelistable: account is not whitelisted");
    });
  });

  describe("USDC Transfer", function () {
    beforeEach(async function () {
      await tronUSDCBridge.updateWhitelist(user1.address, true);
      await tronUSDCBridge.connect(user1).deposit(ethers.parseUnits("1000", USDC_DECIMALS), targetTronAddress);
    });

    it("should allow owner to transfer USDC", async function () {
      const transferAmount = ethers.parseUnits("500", USDC_DECIMALS);
      await expect(tronUSDCBridge.transferUSDC(user3.address, transferAmount))
        .to.emit(tronUSDCBridge, "USDCTransferred")
        .withArgs(user3.address, transferAmount);
    });

    it("should not allow non-owners to transfer USDC", async function () {
      const transferAmount = ethers.parseUnits("500", USDC_DECIMALS);
      await expect(tronUSDCBridge.connect(user1).transferUSDC(user3.address, transferAmount))
        .to.be.revertedWithCustomError(tronUSDCBridge, 'OwnableUnauthorizedAccount');
    });

    it("should not allow transfer of zero amount", async function () {
      await expect(tronUSDCBridge.transferUSDC(user3.address, 0))
        .to.be.revertedWith("Amount must be greater than 0");
    });

    it("should not allow transfer to zero address", async function () {
      const transferAmount = ethers.parseUnits("500", USDC_DECIMALS);
      await expect(tronUSDCBridge.transferUSDC(ethers.ZeroAddress, transferAmount))
        .to.be.revertedWith("Invalid recipient address");
    });
  });

  describe("Pause functionality", function () {
    it("should allow owner to pause and unpause", async function () {
      await tronUSDCBridge.pause();
      expect(await tronUSDCBridge.paused()).to.be.true;

      await tronUSDCBridge.unpause();
      expect(await tronUSDCBridge.paused()).to.be.false;
    });

    it("should not allow non-owners to pause or unpause", async function () {
      await expect(tronUSDCBridge.connect(user1).pause())
        .to.be.revertedWithCustomError(tronUSDCBridge, 'OwnableUnauthorizedAccount');
      await expect(tronUSDCBridge.connect(user1).unpause())
        .to.be.revertedWithCustomError(tronUSDCBridge, 'OwnableUnauthorizedAccount');
    });

    it("should prevent deposits when paused", async function () {
      await tronUSDCBridge.updateWhitelist(user1.address, true);
      await tronUSDCBridge.pause();

      const depositAmount = ethers.parseUnits("1000", USDC_DECIMALS);
      await expect(tronUSDCBridge.connect(user1).deposit(depositAmount, targetTronAddress))
        .to.be.revertedWithCustomError(tronUSDCBridge, 'EnforcedPause');
    });

    it("should prevent withdrawals when paused", async function () {
      await tronUSDCBridge.pause();

      const withdrawAmount = ethers.parseUnits("500", USDC_DECIMALS);
      await expect(tronUSDCBridge.withdraw(user2.address, withdrawAmount))
        .to.be.revertedWithCustomError(tronUSDCBridge, 'EnforcedPause');
    });
  });

  describe("Minimum amount settings", function () {
    it("should allow owner to set minimum deposit amount", async function () {
      const newMinDeposit = ethers.parseUnits("200", USDC_DECIMALS);
      await expect(tronUSDCBridge.setMinDepositAmount(newMinDeposit))
        .to.emit(tronUSDCBridge, "MinDepositAmountUpdated")
        .withArgs(ethers.parseUnits("100", USDC_DECIMALS), newMinDeposit);

      expect(await tronUSDCBridge.getMinDepositAmount()).to.equal(newMinDeposit);
    });

    it("should not allow non-owners to set deposit minimum amounts", async function () {
      await expect(tronUSDCBridge.connect(user1).setMinDepositAmount(ethers.parseUnits("200", USDC_DECIMALS)))
        .to.be.revertedWithCustomError(tronUSDCBridge, 'OwnableUnauthorizedAccount');
    });
  });

  describe("Ownership", function () {
    it("should transfer ownership correctly", async function () {
      await tronUSDCBridge.transferOwnership(user1.address);
      expect(await tronUSDCBridge.owner()).to.equal(owner.address);
      expect(await tronUSDCBridge.pendingOwner()).to.equal(user1.address);

      await tronUSDCBridge.connect(user1).acceptOwnership();
      expect(await tronUSDCBridge.owner()).to.equal(user1.address);
      expect(await tronUSDCBridge.pendingOwner()).to.equal(ethers.ZeroAddress);
    });
  });

  describe("Reclaim functions", function () {
    it("should allow owner to reclaim tokens", async function () {
      const reclaimAmount = ethers.parseUnits("1000", USDC_DECIMALS);
      await mockUSDC2.transfer(await tronUSDCBridge.getAddress(), reclaimAmount);

      const initialOwnerBalance = await mockUSDC2.balanceOf(owner.address);
      const initialContractBalance = await mockUSDC2.balanceOf(await tronUSDCBridge.getAddress());

      await tronUSDCBridge.reclaimToken(await mockUSDC2.getAddress(), owner.address);

      const finalOwnerBalance = await mockUSDC2.balanceOf(owner.address);
      const finalContractBalance = await mockUSDC2.balanceOf(await tronUSDCBridge.getAddress());

      expect(finalOwnerBalance).to.equal(initialOwnerBalance + reclaimAmount);
      expect(finalContractBalance).to.equal(0);
    });

    it("should not allow reclaiming of USDC token", async function () {
      await expect(tronUSDCBridge.reclaimToken(await mockUSDC.getAddress(), owner.address))
        .to.be.revertedWith("Cannot reclaim USDC");
    });

    it("should not allow non-owners to reclaim tokens", async function () {
      await expect(tronUSDCBridge.connect(user1).reclaimToken(await mockUSDC2.getAddress(), user1.address))
        .to.be.revertedWithCustomError(tronUSDCBridge, 'OwnableUnauthorizedAccount');
    });
  });

  describe("Getter functions", function () {
    beforeEach(async function () {
      await tronUSDCBridge.updateWhitelist(user1.address, true);
      await tronUSDCBridge.connect(user1).deposit(ethers.parseUnits("1000", USDC_DECIMALS), targetTronAddress);
    });

    it("should return correct USDC balance", async function () {
      expect(await tronUSDCBridge.USDCBalance()).to.equal(ethers.parseUnits("1000", USDC_DECIMALS));
    });

    it("should return correct total deposited amount", async function () {
      expect(await tronUSDCBridge.getTotalDeposited()).to.equal(ethers.parseUnits("1000", USDC_DECIMALS));
    });

    it("should return correct whitelist status", async function () {
      expect(await tronUSDCBridge.isWhitelisted(user1.address)).to.be.true;
      expect(await tronUSDCBridge.isWhitelisted(user2.address)).to.be.false;
    });
  });

  describe("setToken", function () {
    it("should allow owner to set token", async function () {
      await tronUSDCBridge.setToken(await mockUSDC2.getAddress());
      expect(await tronUSDCBridge.token()).to.equal(await mockUSDC2.getAddress());
    });

    it("should not allow non-owners to set token", async function () {
      await expect(tronUSDCBridge.connect(user1).setToken(await mockUSDC2.getAddress()))
        .to.be.revertedWithCustomError(tronUSDCBridge, 'OwnableUnauthorizedAccount');
    });

    it("should not allow setting token to zero address", async function () {
      await expect(tronUSDCBridge.setToken(ethers.ZeroAddress))
        .to.be.revertedWith("Invalid token address");
    });
  });
});