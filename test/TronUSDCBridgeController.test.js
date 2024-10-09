const {expect} = require("chai");
const {ethers, upgrades} = require("hardhat");

describe('TronUSDCBridgeControllerTest', function () {
  let TronUSDCBridgeController, controller, TronUSDCBridge, tronUsdcBridge, MockUSDC, mockUSDC;
  let owner, user1, user2, systemOperator, withdrawRatifier1, withdrawRatifier2, withdrawRatifier3, whitelistManager,
    treasurer, fundManager;
  const SYSTEM_OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("SYSTEM_OPERATOR_ROLE"));
  const WITHDRAW_RATIFIER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("WITHDRAW_RATIFIER_ROLE"));
  const ACCESS_MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ACCESS_MANAGER_ROLE"));
  const PAUSER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PAUSER_ROLE"));
  const FUND_MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FUND_MANAGER_ROLE"));
  const targetTronAddress = "TE7nS8MkeR2p7quxUvjaGQLd5YtkXBTCfc";
  const tronBurnTx = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const USDC_DECIMALS = 6;
  const FEE_RATE = 1000n;

  beforeEach(async function () {
    [owner, user1, user2, systemOperator, withdrawRatifier1, withdrawRatifier2, withdrawRatifier3, whitelistManager, treasurer, fundManager] = await ethers.getSigners();

    // Deploy mock USDC
    MockUSDC = await ethers.getContractFactory("MockERC20");
    mockUSDC = await MockUSDC.deploy("Mock USDC", "USDC", ethers.parseUnits("1000000000", USDC_DECIMALS), owner.address);
    await mockUSDC.waitForDeployment();

    // Deploy mock TronUSDCBridge
    TronUSDCBridge = await ethers.getContractFactory("TronUSDCBridge");
    tronUsdcBridge = await upgrades.deployProxy(TronUSDCBridge, [
      await mockUSDC.getAddress(),
      owner.address,
      ethers.parseUnits("100", USDC_DECIMALS)  // minDepositAmount
    ]);
    await tronUsdcBridge.waitForDeployment();

    // Deploy TronUSDCBridgeController
    TronUSDCBridgeController = await ethers.getContractFactory('TronUSDCBridgeController');
    controller = await upgrades.deployProxy(TronUSDCBridgeController, [
      await tronUsdcBridge.getAddress(),
      owner.address,
      ethers.parseUnits("1000", 6), // instantWithdrawThreshold
      ethers.parseUnits("10000", 6), // ratifiedWithdrawThreshold
      ethers.parseUnits("100000", 6), // multiSigWithdrawThreshold
      ethers.parseUnits("10000", 6), // instantWithdrawLimit
      ethers.parseUnits("100000", 6), // ratifiedWithdrawLimit
      ethers.parseUnits("1000000", 6), // multiSigWithdrawLimit
    ]);
    await controller.waitForDeployment();

    // Set fee rate and treasurer
    await controller.connect(owner).setTreasury(treasurer.address);
    await controller.connect(owner).setFeeRate(FEE_RATE);

    // Setup roles
    await controller.grantRole(SYSTEM_OPERATOR_ROLE, systemOperator.address);
    await controller.grantRole(WITHDRAW_RATIFIER_ROLE, withdrawRatifier1.address);
    await controller.grantRole(WITHDRAW_RATIFIER_ROLE, withdrawRatifier2.address);
    await controller.grantRole(WITHDRAW_RATIFIER_ROLE, withdrawRatifier3.address);
    await controller.grantRole(ACCESS_MANAGER_ROLE, whitelistManager.address);
    await controller.grantRole(PAUSER_ROLE, owner.address);
    await controller.grantRole(FUND_MANAGER_ROLE, fundManager.address);

    // transfer ownership of USDC to controller
    await tronUsdcBridge.connect(owner).transferOwnership(await controller.getAddress());
    await controller.claimBridgeOwnership();

    // Set user1 in whitelist
    await controller.connect(whitelistManager).updateWhitelist(user1.address, true);

    // mint some USDC to user1 and bridge
    await mockUSDC.mint(user1.address, ethers.parseUnits("1000000", 6));
    await mockUSDC.mint(await tronUsdcBridge.getAddress(), ethers.parseUnits("1000000", 6));

    // Approve USDC spending
    await mockUSDC.connect(user1).approve(await tronUsdcBridge.getAddress(), ethers.MaxUint256);
  });

  describe("Initialization", function () {
    it("should set the right owner", async function () {
      expect(await controller.hasRole(await controller.DEFAULT_ADMIN_ROLE(), owner.address)).to.equal(true);
    });

    it("should set the correct TronUSDCBridge address", async function () {
      expect(await controller.bridge()).to.equal(await tronUsdcBridge.getAddress());
    });

    it("should set the correct fee rate and treasurer", async function () {
      expect(await controller.getFeeRate()).to.equal(1000);
      expect(await controller.getTreasury()).to.equal(treasurer.address);
    });

    it("should set the correct withdraw limits and pools", async function () {
      expect(await controller.getInstantWithdrawLimit()).to.equal(ethers.parseUnits("10000", 6));
      expect(await controller.getRatifiedWithdrawLimit()).to.equal(ethers.parseUnits("100000", 6));
      expect(await controller.getMultiSigWithdrawLimit()).to.equal(ethers.parseUnits("1000000", 6));
      expect(await controller.getInstantWithdrawPool()).to.equal(ethers.parseUnits("10000", 6));
      expect(await controller.getRatifiedWithdrawPool()).to.equal(ethers.parseUnits("100000", 6));
      expect(await controller.getMultiSigWithdrawPool()).to.equal(ethers.parseUnits("1000000", 6));
    });
  });

  describe("Withdraw Limits", function () {
    it("should allow admin to set new withdraw limits", async function () {
      await controller.connect(owner).setWithdrawLimits(
        ethers.parseUnits("20000", 6),
        ethers.parseUnits("200000", 6),
        ethers.parseUnits("2000000", 6)
      );
      expect(await controller.getInstantWithdrawLimit()).to.equal(ethers.parseUnits("20000", 6));
      expect(await controller.getRatifiedWithdrawLimit()).to.equal(ethers.parseUnits("200000", 6));
      expect(await controller.getMultiSigWithdrawLimit()).to.equal(ethers.parseUnits("2000000", 6));
    });

    it("should not allow non-admin to set withdraw limits", async function () {
      await expect(controller.connect(user1).setWithdrawLimits(
        ethers.parseUnits("20000", 6),
        ethers.parseUnits("200000", 6),
        ethers.parseUnits("2000000", 6)
      )).to.be.reverted;
    });
  });

  describe("Refill Withdraw Pools", function () {
    const depositAmount = ethers.parseUnits("1000000", 6); // A sufficiently large deposit amount to cover all tests.

    beforeEach(async function () {
      // Simulate user deposit
      await mockUSDC.mint(user1.address, depositAmount);
      await mockUSDC.connect(user1).approve(tronUsdcBridge.getAddress(), depositAmount);
      await tronUsdcBridge.connect(user1).deposit(depositAmount, targetTronAddress);
    });

    it("should allow withdraw ratifier to refill instant withdraw pool", async function () {
      const withdrawAmount = ethers.parseUnits("1000", 6);
      await controller.connect(systemOperator).instantWithdraw(user1.address, withdrawAmount, tronBurnTx);

      const beforeRefill = await controller.getInstantWithdrawPool();

      await expect(controller.connect(withdrawRatifier1).refillInstantWithdrawPool())
        .to.emit(controller, "PoolRefilled")
        .withArgs("Instant", ethers.parseUnits("10000", 6) - beforeRefill);

      expect(await controller.getInstantWithdrawPool()).to.equal(ethers.parseUnits("10000", 6));
    });

    it("should allow withdraw ratifier to refill ratified withdraw pool", async function () {
      const withdrawAmount = ethers.parseUnits("10000", 6);
      await controller.connect(systemOperator).requestWithdraw(user1.address, withdrawAmount, tronBurnTx);
      await controller.connect(withdrawRatifier1).ratifyWithdraw(0, user1.address, withdrawAmount, tronBurnTx);

      const beforeRefill = await controller.getRatifiedWithdrawPool();

      await controller.connect(withdrawRatifier1).refillRatifiedWithdrawPool();
      await controller.connect(withdrawRatifier2).refillRatifiedWithdrawPool();
      await expect(controller.connect(withdrawRatifier3).refillRatifiedWithdrawPool())
        .to.emit(controller, "PoolRefilled")
        .withArgs("Ratified", ethers.parseUnits("100000", 6) - beforeRefill);

      expect(await controller.getRatifiedWithdrawPool()).to.equal(ethers.parseUnits("100000", 6));
    });

    it("should allow admin to refill multi-sig withdraw pool", async function () {
      const withdrawAmount = ethers.parseUnits("500000", 6);
      await controller.connect(systemOperator).requestWithdraw(user1.address, withdrawAmount, tronBurnTx);
      await controller.connect(withdrawRatifier1).ratifyWithdraw(0, user1.address, withdrawAmount, tronBurnTx);
      await controller.connect(withdrawRatifier2).ratifyWithdraw(0, user1.address, withdrawAmount, tronBurnTx);
      await controller.connect(withdrawRatifier3).ratifyWithdraw(0, user1.address, withdrawAmount, tronBurnTx);

      const beforeRefill = await controller.getMultiSigWithdrawPool();

      await expect(controller.connect(owner).refillMultiSigWithdrawPool())
        .to.emit(controller, "PoolRefilled")
        .withArgs("MultiSig", ethers.parseUnits("1000000", 6) - beforeRefill);

      expect(await controller.getMultiSigWithdrawPool()).to.equal(ethers.parseUnits("1000000", 6));
    });
  });

  describe("Instant Withdraw", function () {
    const depositAmount = ethers.parseUnits("1000", 6);
    const invalidTronTxHash = "0xinvalidTx";
    beforeEach(async function () {
      // Simulate user deposit
      await mockUSDC.connect(user1).approve(tronUsdcBridge.getAddress(), depositAmount);
      await tronUsdcBridge.connect(user1).deposit(depositAmount, targetTronAddress);
    });

    it("should reject instant withdraw with invalid Tron transaction hash", async function () {
      const withdrawAmount = ethers.parseUnits("1000", USDC_DECIMALS);
      await expect(controller.connect(systemOperator).instantWithdraw(user1.address, withdrawAmount, invalidTronTxHash))
        .to.be.revertedWith("Invalid Tron burn tx");
    });

    it("should allow system operator to perform instant withdraw", async function () {
      const withdrawAmount = ethers.parseUnits("100", 6);
      const fee = withdrawAmount * FEE_RATE / 1000000n;
      const netWithdrawAmount = withdrawAmount - fee;

      await expect(controller.connect(systemOperator).instantWithdraw(user1.address, withdrawAmount, tronBurnTx))
        .to.emit(controller, "InstantWithdraw")
        .withArgs(user1.address, netWithdrawAmount, tronBurnTx);

      expect(await mockUSDC.balanceOf(user1.address)).to.equal(ethers.parseUnits("1000000", 6) - depositAmount + netWithdrawAmount);
      expect(await mockUSDC.balanceOf(treasurer.address)).to.equal(fee);
      expect(await controller.getInstantWithdrawPool()).to.equal(ethers.parseUnits("9900", 6));
    });

    it("should not allow instant withdraw above threshold", async function () {
      await expect(controller.connect(systemOperator).instantWithdraw(user1.address, ethers.parseUnits("2000", 6), tronBurnTx))
        .to.be.revertedWith("Over the instant withdraw threshold");
    });
  });

  describe("Ratify Withdraw", function () {
    beforeEach(async function () {
      const depositAmount = ethers.parseUnits("10000", 6); // 增加存款金额以覆盖提现金额
      // 模拟存款
      await mockUSDC.connect(user1).approve(tronUsdcBridge.getAddress(), depositAmount);
      await tronUsdcBridge.connect(user1).deposit(depositAmount, targetTronAddress);

      await controller.connect(systemOperator).requestWithdraw(user1.address, ethers.parseUnits("5000", 6), tronBurnTx);
    });

    it("should allow withdraw ratifier to ratify withdraw", async function () {
      await expect(controller.connect(withdrawRatifier1).ratifyWithdraw(0, user1.address, ethers.parseUnits("5000", 6), tronBurnTx))
        .to.emit(controller, "WithdrawRatified")
        .withArgs(0, withdrawRatifier1.address);
    });

    it("should not allow non-ratifier to ratify withdraw", async function () {
      await expect(controller.connect(user1).ratifyWithdraw(0, user1.address, ethers.parseUnits("5000", 6), tronBurnTx))
        .to.be.reverted;
    });
  });

  describe("Finalize Withdraw", function () {
    beforeEach(async function () {
      const depositAmount = ethers.parseUnits("10000", 6); // 增加存款金额以覆盖提现金额
      // 模拟存款
      await mockUSDC.connect(user1).approve(tronUsdcBridge.getAddress(), depositAmount);
      await tronUsdcBridge.connect(user1).deposit(depositAmount, targetTronAddress);

      await controller.connect(systemOperator).requestWithdraw(user1.address, ethers.parseUnits("5000", 6), tronBurnTx);
    });

    it("should allow admin to finalize withdraw without ratification", async function () {
      let withdrawAmount = ethers.parseUnits("5000", 6);
      let fee = withdrawAmount * FEE_RATE / 1000000n;
      let netWithdrawAmount = withdrawAmount - fee;

      await expect(controller.connect(owner).finalizeWithdraw(0))
        .to.emit(controller, "WithdrawFinalized")
        .withArgs(user1.address, netWithdrawAmount, tronBurnTx, 0);
    });

    it("should require ratification for non-admin to finalize withdraw", async function () {
      await expect(controller.connect(systemOperator).finalizeWithdraw(0))
        .to.be.revertedWith("Not enough approvals");

      let withdrawAmount = ethers.parseUnits("5000", 6);
      let fee = withdrawAmount * FEE_RATE / 1000000n;
      let netWithdrawAmount = withdrawAmount - fee;

      await expect(controller.connect(withdrawRatifier1).ratifyWithdraw(0, user1.address, ethers.parseUnits("5000", 6), tronBurnTx))
        .to.emit(controller, "WithdrawFinalized")
        .withArgs(user1.address, netWithdrawAmount, tronBurnTx, 0);
    });
  });

  describe("Revoke Withdraw", function () {
    beforeEach(async function () {
      await controller.connect(systemOperator).requestWithdraw(user1.address, ethers.parseUnits("5000", 6), tronBurnTx);
    });

    it("should allow system operator to revoke withdraw", async function () {
      await expect(controller.connect(systemOperator).revokeWithdraw(0))
        .to.emit(controller, "WithdrawRevoked")
        .withArgs(0);
    });

    it("should not allow non-system operator to revoke withdraw", async function () {
      await expect(controller.connect(user1).revokeWithdraw(0))
        .to.be.reverted;
    });
  });

  describe("Withdraw Thresholds", function () {
    it("should allow admin to set new withdraw thresholds", async function () {
      await controller.connect(owner).setWithdrawThresholds(
        ethers.parseUnits("2000", 6),
        ethers.parseUnits("20000", 6),
        ethers.parseUnits("200000", 6)
      );
      expect(await controller.getInstantWithdrawThreshold()).to.equal(ethers.parseUnits("2000", 6));
      expect(await controller.getRatifiedWithdrawThreshold()).to.equal(ethers.parseUnits("20000", 6));
      expect(await controller.getMultiSigWithdrawThreshold()).to.equal(ethers.parseUnits("200000", 6));
    });
  });

  describe("Pause functionality", function () {
    it("should allow pauser to pause the contract", async function () {
      await controller.connect(owner).pause();
      expect(await controller.paused()).to.equal(true);
    });

    it("should not allow withdraw requests when paused", async function () {
      await controller.connect(owner).pause();
      await expect(controller.connect(systemOperator).requestWithdraw(user1.address, ethers.parseUnits("100", 6), tronBurnTx))
        .to.be.revertedWithCustomError(controller, "EnforcedPause");
    });

    it("should allow pauser to unpause the contract", async function () {
      await controller.connect(owner).pause();
      await controller.connect(owner).unpause();
      expect(await controller.paused()).to.equal(false);
    });
  });

  describe("Update TronUSDCBridge", function () {
    it("should allow admin to set TronUSDCBridge address", async function () {
      const newMockBridge = await TronUSDCBridge.deploy();
      await newMockBridge.waitForDeployment();

      await controller.connect(owner).setBridge(await newMockBridge.getAddress());

      expect(await controller.bridge()).to.equal(await newMockBridge.getAddress());
    });

    it("should not allow non-admin to set TronUSDCBridge address", async function () {
      const newMockBridge = await TronUSDCBridge.deploy();
      await newMockBridge.waitForDeployment();

      await expect(controller.connect(user1).setBridge(await newMockBridge.getAddress()))
        .to.be.reverted;
    });
  });

  describe("Multi-signature process and withdraw pool limits", function () {
    const instantWithdrawAmount = ethers.parseUnits("1000", 6);
    const ratifiedWithdrawAmount = ethers.parseUnits("10000", 6);
    const largeWithdrawAmount = ethers.parseUnits("100000", 6);
    const depositAmount = ethers.parseUnits("1060000", 6); // Deposit enough funds to cover large withdrawals.

    beforeEach(async function () {
      // Simulate large deposits
      await mockUSDC.mint(user1.address, depositAmount);
      await mockUSDC.connect(user1).approve(tronUsdcBridge.getAddress(), depositAmount);
      await tronUsdcBridge.connect(user1).deposit(depositAmount, targetTronAddress);
    });

    async function requestWithdraw(amount) {
      const withdrawIndex = await controller.withdrawOperationCount();
      await controller.connect(systemOperator).requestWithdraw(user1.address, amount, tronBurnTx);
      return withdrawIndex;
    }

    it("should handle instant withdraws correctly", async function () {
      for (let i = 0; i < 10; i++) {
        await expect(controller.connect(systemOperator).instantWithdraw(user1.address, instantWithdrawAmount, tronBurnTx))
          .to.not.be.reverted;
      }
      await expect(controller.connect(systemOperator).instantWithdraw(user1.address, instantWithdrawAmount, tronBurnTx))
        .to.be.revertedWith("Instant withdraw pool is dry");
    });

    it("should require one signature for medium withdraws", async function () {
      const withdrawIndex = await requestWithdraw(ratifiedWithdrawAmount);
      await expect(controller.connect(withdrawRatifier1).ratifyWithdraw(withdrawIndex, user1.address, ratifiedWithdrawAmount, tronBurnTx))
        .to.emit(controller, "WithdrawFinalized");
    });

    it("should require multiple signatures for large withdrawals", async function () {
      const withdrawIndex = await requestWithdraw(largeWithdrawAmount);

      await controller.connect(withdrawRatifier1).ratifyWithdraw(withdrawIndex, user1.address, largeWithdrawAmount, tronBurnTx);
      await controller.connect(withdrawRatifier2).ratifyWithdraw(withdrawIndex, user1.address, largeWithdrawAmount, tronBurnTx);

      // The last ratification should trigger finalization
      let netLargeWithdrawAmount = largeWithdrawAmount - (largeWithdrawAmount * FEE_RATE / 1000000n);
      await expect(controller.connect(withdrawRatifier3).ratifyWithdraw(withdrawIndex, user1.address, largeWithdrawAmount, tronBurnTx))
        .to.emit(controller, "WithdrawFinalized")
        .withArgs(user1.address, netLargeWithdrawAmount, tronBurnTx, withdrawIndex);
    });

    it("should enforce pool limits for non-admin withdraws", async function () {
      // Deplete instant withdraw pool
      for (let i = 0; i < 10; i++) {
        await expect(controller.connect(systemOperator).instantWithdraw(user1.address, instantWithdrawAmount, tronBurnTx))
          .to.not.be.reverted;
      }
      await expect(controller.connect(systemOperator).instantWithdraw(user1.address, instantWithdrawAmount, tronBurnTx))
        .to.be.revertedWith("Instant withdraw pool is dry");

      // Deplete ratified withdraw pool and part of multi-sig pool
      let withdrawIndex;
      for (let i = 0; i < 15; i++) {
        withdrawIndex = await requestWithdraw(ratifiedWithdrawAmount);
        if (i < 10) {
          // First 10 withdraws should only need one signature
          await expect(controller.connect(withdrawRatifier1).ratifyWithdraw(withdrawIndex, user1.address, ratifiedWithdrawAmount, tronBurnTx))
            .to.emit(controller, "WithdrawFinalized");
        } else {
          // Next 5 withdraws should require multi-sig (3 signatures)
          await controller.connect(withdrawRatifier1).ratifyWithdraw(withdrawIndex, user1.address, ratifiedWithdrawAmount, tronBurnTx);
          await controller.connect(withdrawRatifier2).ratifyWithdraw(withdrawIndex, user1.address, ratifiedWithdrawAmount, tronBurnTx);
          await expect(controller.connect(withdrawRatifier3).ratifyWithdraw(withdrawIndex, user1.address, ratifiedWithdrawAmount, tronBurnTx))
            .to.emit(controller, "WithdrawFinalized");
        }
      }

      // Attempt multi-sig withdraws until pool is depleted
      for (let i = 0; i < 10; i++) {
        withdrawIndex = await requestWithdraw(largeWithdrawAmount);
        await controller.connect(withdrawRatifier1).ratifyWithdraw(withdrawIndex, user1.address, largeWithdrawAmount, tronBurnTx);
        await controller.connect(withdrawRatifier2).ratifyWithdraw(withdrawIndex, user1.address, largeWithdrawAmount, tronBurnTx);
        if (i < 9) {
          await expect(controller.connect(withdrawRatifier3).ratifyWithdraw(withdrawIndex, user1.address, largeWithdrawAmount, tronBurnTx))
            .to.emit(controller, "WithdrawFinalized");
        } else {
          // The last multi-sig withdraw should fail due to insufficient pool funds
          await controller.connect(withdrawRatifier3).ratifyWithdraw(withdrawIndex, user1.address, largeWithdrawAmount, tronBurnTx);
          await expect(controller.connect(withdrawRatifier3).canFinalize(withdrawIndex))
            .to.be.revertedWith("Not enough approvals");
        }
      }

      // Verify that all pools are depleted
      expect(await controller.getInstantWithdrawPool()).to.equal(0);
      expect(await controller.getRatifiedWithdrawPool()).to.equal(0);
      expect(await controller.getMultiSigWithdrawPool()).to.be.lt(largeWithdrawAmount);
    });

    it("should allow admin to bypass multi-signature requirement and pool limits", async function () {
      await controller.connect(systemOperator).requestWithdraw(user1.address, largeWithdrawAmount, tronBurnTx);
      await expect(controller.connect(owner).finalizeWithdraw(0))
        .to.emit(controller, "WithdrawFinalized");
    });

    it("should not allow the same ratifier to approve twice", async function () {
      const withdrawIndex = await requestWithdraw(largeWithdrawAmount);
      await controller.connect(withdrawRatifier1).ratifyWithdraw(withdrawIndex, user1.address, largeWithdrawAmount, tronBurnTx);
      await expect(controller.connect(withdrawRatifier1).ratifyWithdraw(withdrawIndex, user1.address, largeWithdrawAmount, tronBurnTx))
        .to.be.revertedWith("Already approved");
    });

    it("should revert if withdraw details do not match", async function () {
      const withdrawIndex = await requestWithdraw(largeWithdrawAmount);
      await expect(controller.connect(withdrawRatifier1).ratifyWithdraw(withdrawIndex, user2.address, largeWithdrawAmount, tronBurnTx))
        .to.be.revertedWith("To address does not match");
      await expect(controller.connect(withdrawRatifier1).ratifyWithdraw(withdrawIndex, user1.address, ratifiedWithdrawAmount, tronBurnTx))
        .to.be.revertedWith("Amount does not match");
      await expect(controller.connect(withdrawRatifier1).ratifyWithdraw(withdrawIndex, user1.address, largeWithdrawAmount, "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"))
        .to.be.revertedWith("Tron burn tx does not match");
    });
  });

  describe("invalidateAllPendingWithdraws functionality", function () {
    it("should invalidate all pending withdrawals", async function () {
      await controller.connect(systemOperator).requestWithdraw(user1.address, ethers.parseUnits("1000", 6), tronBurnTx);
      await controller.connect(systemOperator).requestWithdraw(user1.address, ethers.parseUnits("2000", 6), tronBurnTx);

      await controller.connect(owner).invalidateAllPendingWithdraws();

      await expect(controller.connect(withdrawRatifier1).ratifyWithdraw(0, user1.address, ethers.parseUnits("1000", 6), tronBurnTx))
        .to.be.revertedWith("This withdraw is invalid");
      await expect(controller.connect(withdrawRatifier1).ratifyWithdraw(1, user1.address, ethers.parseUnits("2000", 6), tronBurnTx))
        .to.be.revertedWith("This withdraw is invalid");
    });
  });

  describe("Whitelist management", function () {
    it("should allow whitelist manager to update whitelist", async function () {
      await expect(controller.connect(whitelistManager).updateWhitelist(user2.address, true))
        .to.not.be.reverted;
    });

    it("should not allow non-whitelist manager to update whitelist", async function () {
      await expect(controller.connect(user1).updateWhitelist(user2.address, true))
        .to.be.reverted;
    });
  });

  describe("Investment address management", function () {
    it("should allow admin to set investment address", async function () {
      await expect(controller.connect(owner).setInvestmentAddress(user2.address))
        .to.emit(controller, "InvestmentAddressSet")
        .withArgs(ethers.ZeroAddress, user2.address);
    });

    it("should not allow non-admin to set investment address", async function () {
      await expect(controller.connect(user1).setInvestmentAddress(user2.address))
        .to.be.reverted;
    });

    it("should allow fund manager to transfer funds to investment address", async function () {
      await controller.connect(owner).setInvestmentAddress(user2.address);
      const transferAmount = ethers.parseUnits("1000", 6);
      await expect(controller.connect(fundManager).transferToInvestment(transferAmount))
        .to.emit(controller, "FundsTransferredToInvestment")
        .withArgs(transferAmount);

      expect(await mockUSDC.balanceOf(user2.address)).to.equal(transferAmount);
    });
  });

  describe("Fee management", function () {
    const initialBalance = ethers.parseUnits("1000000", 6);
    const depositAmount = ethers.parseUnits("10000", 6);

    beforeEach(async function () {
      // 为用户铸造初始余额
      await mockUSDC.mint(user1.address, initialBalance);

      // 模拟存款
      await mockUSDC.connect(user1).approve(tronUsdcBridge.getAddress(), depositAmount);
      await tronUsdcBridge.connect(user1).deposit(depositAmount, targetTronAddress);
    });

    it("should allow admin to set fee rate", async function () {
      await expect(controller.connect(owner).setFeeRate(2000)) // 0.2%
        .to.emit(controller, "FeeRateSet")
        .withArgs(1000, 2000);
      expect(await controller.getFeeRate()).to.equal(2000);
    });

    it("should allow admin to set treasurer", async function () {
      await expect(controller.connect(owner).setTreasury(user2.address))
        .to.emit(controller, "TreasurySet")
        .withArgs(treasurer.address, user2.address);
      expect(await controller.getTreasury()).to.equal(user2.address);
    });

    it("should deduct fee during withdraw", async function () {
      const withdrawAmount = ethers.parseUnits("1000", 6);
      const feeRate = await controller.getFeeRate();
      const fee = (withdrawAmount * BigInt(feeRate)) / BigInt(1000000);
      const netWithdrawAmount = withdrawAmount - fee;

      const userInitialBalance = await mockUSDC.balanceOf(user1.address);
      const treasurerInitialBalance = await mockUSDC.balanceOf(treasurer.address);

      await controller.connect(systemOperator).instantWithdraw(user1.address, withdrawAmount, tronBurnTx);

      // Check user received correct amount
      expect(await mockUSDC.balanceOf(user1.address)).to.equal(userInitialBalance + netWithdrawAmount);

      // Check treasurer received fee
      expect(await mockUSDC.balanceOf(treasurer.address)).to.equal(treasurerInitialBalance + fee);
    });
  });
  describe("Reclaim functionality", function () {
    it("should allow admin to reclaim tokens", async function () {
      const MockToken = await ethers.getContractFactory("MockERC20");
      const mockToken = await MockToken.deploy("Mock Token", "MTK", ethers.parseUnits("1000000", USDC_DECIMALS), owner.address);
      await mockToken.waitForDeployment();
      await mockToken.mint(await controller.getAddress(), ethers.parseUnits("1000", USDC_DECIMALS));

      await expect(controller.connect(owner).reclaimToken(await mockToken.getAddress(), owner.address))
        .to.changeTokenBalance(mockToken, owner, ethers.parseUnits("1000", USDC_DECIMALS));
    });
  });

  describe("Bridge management", function () {
    it("should allow admin to pause and unpause the bridge", async function () {
      await controller.connect(owner).pauseBridge();
      expect(await tronUsdcBridge.paused()).to.be.true;

      await controller.connect(owner).unpauseBridge();
      expect(await tronUsdcBridge.paused()).to.be.false;
    });

    it("should allow admin to set whitelist status on bridge", async function () {
      await controller.connect(owner).setWhitelistEnabled(false);
      expect(await tronUsdcBridge.isWhitelistEnabled()).to.be.false;

      await controller.connect(owner).setWhitelistEnabled(true);
      expect(await tronUsdcBridge.isWhitelistEnabled()).to.be.true;
    });

    it("should allow admin to set minimum deposit amounts on bridge", async function () {
      const newMinDeposit = ethers.parseUnits("200", USDC_DECIMALS);

      await controller.connect(owner).setMinDepositAmount(newMinDeposit);
      expect(await tronUsdcBridge.getMinDepositAmount()).to.equal(newMinDeposit);
    });
  });
});