const {expect} = require("chai");
const {ethers, upgrades} = require("hardhat");

describe('USDCControllerTest', function () {
  let USDCController, controller, USDC, usdc;
  let owner, user1, user2, systemOperator, mintRatifier1, mintRatifier2, mintRatifier3, whitelistManager, treasury;
  const SYSTEM_OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("SYSTEM_OPERATOR_ROLE"));
  const MINT_RATIFIER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINT_RATIFIER_ROLE"));
  const ACCESS_MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ACCESS_MANAGER_ROLE"));
  const PAUSER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PAUSER_ROLE"));
  const minBurnAmount = ethers.parseUnits("10", 6);
  const ethDepositTx = "0x1234567890123456789012345678901234567890123456789012345678901234";

  beforeEach(async function () {
    [owner, user1, user2, systemOperator, mintRatifier1, mintRatifier2, mintRatifier3, whitelistManager, treasury] = await ethers.getSigners();

    // Deploy USDC
    USDC = await ethers.getContractFactory("USDC");
    usdc = await upgrades.deployProxy(USDC, [owner.address, minBurnAmount]);
    await usdc.waitForDeployment();

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
  });

  describe("Initialization", function () {
    it("should set the right owner", async function () {
      expect(await controller.hasRole(await controller.DEFAULT_ADMIN_ROLE(), owner.address)).to.equal(true);
    });

    it("should set the correct USDC token address", async function () {
      expect(await controller.token()).to.equal(await usdc.getAddress());
    });

    it("should set the correct treasury", async function () {
      expect(await controller.getTreasury()).to.equal(treasury.address);
    });
  });

  describe("Mint Request", function () {
    it("should allow system operator to request mint", async function () {
      await expect(controller.connect(systemOperator).requestMint(user1.address, ethers.parseUnits("100", 6), ethDepositTx))
        .to.emit(controller, "MintRequested")
        .withArgs(user1.address, ethers.parseUnits("100", 6), ethDepositTx, 0);
    });

    it("should not allow non-system operator to request mint", async function () {
      await expect(controller.connect(user1).requestMint(user1.address, ethers.parseUnits("100", 6), ethDepositTx))
        .to.be.reverted;
    });
  });

  describe("Instant Mint", function () {
    it("should allow system operator to perform instant mint", async function () {
      const mintAmount = ethers.parseUnits("100", 6);
      const fee = mintAmount * BigInt(1000) / BigInt(1000000); // 0.1% fee
      const actualMintAmount = mintAmount - fee;

      await expect(controller.connect(systemOperator).instantMint(user1.address, mintAmount, ethDepositTx))
        .to.emit(controller, "InstantMint")
        .withArgs(user1.address, actualMintAmount, ethDepositTx)
        .to.emit(controller, "FeePaid")
        .withArgs(treasury.address, fee);

      expect(await usdc.balanceOf(user1.address)).to.equal(actualMintAmount);
      expect(await usdc.balanceOf(treasury.address)).to.equal(fee);
    });

    it("should not allow instant mint above threshold", async function () {
      await expect(controller.connect(systemOperator).instantMint(user1.address, ethers.parseUnits("2000", 6), ethDepositTx))
        .to.be.revertedWith("Over the instant mint threshold");
    });
  });

  describe("Ratify Mint", function () {
    beforeEach(async function () {
      await controller.connect(systemOperator).requestMint(user1.address, ethers.parseUnits("5000", 6), ethDepositTx);
    });

    it("should allow mint ratifier to ratify mint", async function () {
      await expect(controller.connect(mintRatifier1).ratifyMint(0, user1.address, ethers.parseUnits("5000", 6), ethDepositTx))
        .to.emit(controller, "MintRatified")
        .withArgs(0, mintRatifier1.address);
    });

    it("should not allow non-ratifier to ratify mint", async function () {
      await expect(controller.connect(user1).ratifyMint(0, user1.address, ethers.parseUnits("5000", 6), ethDepositTx))
        .to.be.reverted;
    });
  });

  describe("Finalize Mint", function () {
    beforeEach(async function () {
      await controller.connect(systemOperator).requestMint(user1.address, ethers.parseUnits("5000", 6), ethDepositTx);
    });

    it("should allow admin to finalize mint without ratification", async function () {
      const mintAmount = ethers.parseUnits("5000", 6);
      const fee = mintAmount * BigInt(1000) / BigInt(1000000); // 0.1% fee
      const actualMintAmount = mintAmount - fee;

      await expect(controller.connect(owner).finalizeMint(0))
        .to.emit(controller, "MintFinalized")
        .withArgs(user1.address, actualMintAmount, ethDepositTx, 0)
        .to.emit(controller, "FeePaid")
        .withArgs(treasury.address, fee);

      expect(await usdc.balanceOf(user1.address)).to.equal(actualMintAmount);
      expect(await usdc.balanceOf(treasury.address)).to.equal(fee);
    });

    it("should require ratification for non-admin to finalize mint", async function () {
      await expect(controller.connect(systemOperator).finalizeMint(0))
        .to.be.revertedWith("Not enough approvals");

      await expect(controller.connect(mintRatifier1).ratifyMint(0, user1.address, ethers.parseUnits("5000", 6), ethDepositTx))
        .to.emit(controller, "MintFinalized");
    });
  });

  describe("Revoke Mint", function () {
    beforeEach(async function () {
      await controller.connect(systemOperator).requestMint(user1.address, ethers.parseUnits("5000", 6), ethDepositTx);
    });

    it("should allow system operator to revoke mint", async function () {
      await expect(controller.connect(systemOperator).revokeMint(0))
        .to.emit(controller, "MintRevoked")
        .withArgs(0);
    });

    it("should not allow non-system operator to revoke mint", async function () {
      await expect(controller.connect(user1).revokeMint(0))
        .to.be.reverted;
    });
  });

  describe("Mint Thresholds and Limits", function () {
    it("should allow admin to set new mint thresholds", async function () {
      await controller.connect(owner).setMintThresholds(
        ethers.parseUnits("2000", 6),
        ethers.parseUnits("20000", 6),
        ethers.parseUnits("200000", 6)
      );
      expect(await controller.getInstantMintThreshold()).to.equal(ethers.parseUnits("2000", 6));
      expect(await controller.getRatifiedMintThreshold()).to.equal(ethers.parseUnits("20000", 6));
      expect(await controller.getMultiSigMintThreshold()).to.equal(ethers.parseUnits("200000", 6));
    });

    it("should allow admin to set new mint limits", async function () {
      await controller.connect(owner).setMintLimits(
        ethers.parseUnits("20000", 6),
        ethers.parseUnits("200000", 6),
        ethers.parseUnits("2000000", 6)
      );
      expect(await controller.getInstantMintLimit()).to.equal(ethers.parseUnits("20000", 6));
      expect(await controller.getRatifiedMintLimit()).to.equal(ethers.parseUnits("200000", 6));
      expect(await controller.getMultiSigMintLimit()).to.equal(ethers.parseUnits("2000000", 6));
    });
  });

  describe("Refill Mint Pools", function () {
    it("should allow mint ratifier to refill instant mint pool", async function () {
      const mintAmount = ethers.parseUnits("1000", 6);
      await controller.connect(systemOperator).instantMint(user1.address, mintAmount, ethDepositTx);

      const beforeRefill = await controller.getInstantMintPool();

      await expect(controller.connect(mintRatifier1).refillInstantMintPool())
        .to.emit(controller, "PoolRefilled")
        .withArgs("Instant", ethers.parseUnits("10000", 6) - beforeRefill);

      expect(await controller.getInstantMintPool()).to.equal(ethers.parseUnits("10000", 6));
    });

    it("should allow mint ratifier to refill ratified mint pool", async function () {
      const mintAmount = ethers.parseUnits("10000", 6);
      await controller.connect(systemOperator).requestMint(user1.address, mintAmount, ethDepositTx);
      await controller.connect(mintRatifier1).ratifyMint(0, user1.address, mintAmount, ethDepositTx);

      const beforeRefill = await controller.getRatifiedMintPool();

      await controller.connect(mintRatifier1).refillRatifiedMintPool();
      await controller.connect(mintRatifier2).refillRatifiedMintPool();
      await expect(controller.connect(mintRatifier3).refillRatifiedMintPool())
        .to.emit(controller, "PoolRefilled")
        .withArgs("Ratified", ethers.parseUnits("100000", 6) - beforeRefill);

      expect(await controller.getRatifiedMintPool()).to.equal(ethers.parseUnits("100000", 6));
    });

    it("should allow admin to refill multi-sig mint pool", async function () {
      const mintAmount = ethers.parseUnits("500000", 6);
      await controller.connect(systemOperator).requestMint(user1.address, mintAmount, ethDepositTx);
      await controller.connect(mintRatifier1).ratifyMint(0, user1.address, mintAmount, ethDepositTx);
      await controller.connect(mintRatifier2).ratifyMint(0, user1.address, mintAmount, ethDepositTx);
      await controller.connect(mintRatifier3).ratifyMint(0, user1.address, mintAmount, ethDepositTx);

      const beforeRefill = await controller.getMultiSigMintPool();

      await expect(controller.connect(owner).refillMultiSigMintPool())
        .to.emit(controller, "PoolRefilled")
        .withArgs("MultiSig", ethers.parseUnits("1000000", 6) - beforeRefill);

      expect(await controller.getMultiSigMintPool()).to.equal(ethers.parseUnits("1000000", 6));
    });
  });

  describe("Pause functionality", function () {
    it("should allow pauser to pause the contract", async function () {
      await expect(controller.connect(owner).pause())
        .to.emit(controller, "Paused")
        .withArgs(owner.address);
      expect(await controller.paused()).to.equal(true);
    });

    it("should not allow mint requests when paused", async function () {
      await controller.connect(owner).pause();
      await expect(controller.connect(systemOperator).requestMint(user1.address, ethers.parseUnits("100", 6), ethDepositTx))
        .to.be.revertedWithCustomError(controller, "EnforcedPause");
    });

    it("should allow pauser to unpause the contract", async function () {
      await controller.connect(owner).pause();
      await expect(controller.connect(owner).unpause())
        .to.emit(controller, "Unpaused")
        .withArgs(owner.address);
      expect(await controller.paused()).to.equal(false);
    });
  });

  describe("Update USDC", function () {
    it("should allow admin to set USDC address", async function () {
      const newUsdc = await upgrades.deployProxy(USDC, [owner.address, minBurnAmount]);
      await newUsdc.waitForDeployment();

      await controller.connect(owner).setToken(await newUsdc.getAddress());

      expect(await controller.token()).to.equal(await newUsdc.getAddress());
    });

    it("should not allow non-admin to set USDC address", async function () {
      const newUsdc = await upgrades.deployProxy(USDC, [owner.address, minBurnAmount]);
      await newUsdc.waitForDeployment();

      await expect(controller.connect(user1).setToken(await newUsdc.getAddress()))
        .to.be.reverted;
    });
  });

  describe("Multi-signature process and mint pool limits", function () {
    const instantMintAmount = ethers.parseUnits("1000", 6);
    const ratifiedMintAmount = ethers.parseUnits("10000", 6);
    const largeMintAmount = ethers.parseUnits("100000", 6);

    async function requestMint(amount) {
      const mintIndex = await controller.mintOperationCount();
      await controller.connect(systemOperator).requestMint(user1.address, amount, ethDepositTx);
      return mintIndex;
    }

    it("should handle instant mints correctly", async function () {
      for (let i = 0; i < 10; i++) {
        await expect(controller.connect(systemOperator).instantMint(user1.address, instantMintAmount, ethDepositTx))
          .to.not.be.reverted;
      }
      await expect(controller.connect(systemOperator).instantMint(user1.address, instantMintAmount, ethDepositTx))
        .to.be.revertedWith("Instant mint pool is dry");
    });

    it("should require one signature for medium mints", async function () {
      const mintIndex = await requestMint(ratifiedMintAmount);
      await expect(controller.connect(mintRatifier1).ratifyMint(mintIndex, user1.address, ratifiedMintAmount, ethDepositTx))
        .to.emit(controller, "MintFinalized");
    });

    it("should require multiple signatures for large mints", async function () {
      const mintIndex = await requestMint(largeMintAmount);

      await controller.connect(mintRatifier1).ratifyMint(mintIndex, user1.address, largeMintAmount, ethDepositTx);
      await controller.connect(mintRatifier2).ratifyMint(mintIndex, user1.address, largeMintAmount, ethDepositTx);

      // The last ratification should trigger finalization
      await expect(controller.connect(mintRatifier3).ratifyMint(mintIndex, user1.address, largeMintAmount, ethDepositTx))
        .to.emit(controller, "MintFinalized");
    });

    it("should enforce pool limits for non-admin mints", async function () {
      const instantMintAmount = ethers.parseUnits("1000", 6);
      const ratifiedMintAmount = ethers.parseUnits("10000", 6);
      const multiSigMintAmount = ethers.parseUnits("100000", 6);

      // Deplete instant mint pool
      for (let i = 0; i < 10; i++) {
        await expect(controller.connect(systemOperator).instantMint(user1.address, instantMintAmount, ethDepositTx))
          .to.not.be.reverted;
      }
      await expect(controller.connect(systemOperator).instantMint(user1.address, instantMintAmount, ethDepositTx))
        .to.be.revertedWith("Instant mint pool is dry");

      // Deplete ratified mint pool and part of multi-sig pool
      let mintIndex;
      for (let i = 0; i < 15; i++) {
        mintIndex = await requestMint(ratifiedMintAmount);
        if (i < 10) {
          // First 10 mints should only need one signature
          await expect(controller.connect(mintRatifier1).ratifyMint(mintIndex, user1.address, ratifiedMintAmount, ethDepositTx))
            .to.emit(controller, "MintFinalized");
        } else {
          // Next 5 mints should require multi-sig (3 signatures)
          await controller.connect(mintRatifier1).ratifyMint(mintIndex, user1.address, ratifiedMintAmount, ethDepositTx);
          await controller.connect(mintRatifier2).ratifyMint(mintIndex, user1.address, ratifiedMintAmount, ethDepositTx);
          await expect(controller.connect(mintRatifier3).ratifyMint(mintIndex, user1.address, ratifiedMintAmount, ethDepositTx))
            .to.emit(controller, "MintFinalized");
        }
      }

      // Attempt multi-sig mints until pool is depleted
      for (let i = 0; i < 10; i++) {
        mintIndex = await requestMint(multiSigMintAmount);
        await controller.connect(mintRatifier1).ratifyMint(mintIndex, user1.address, multiSigMintAmount, ethDepositTx);
        await controller.connect(mintRatifier2).ratifyMint(mintIndex, user1.address, multiSigMintAmount, ethDepositTx);
        if (i < 9) {
          await expect(controller.connect(mintRatifier3).ratifyMint(mintIndex, user1.address, multiSigMintAmount, ethDepositTx))
            .to.emit(controller, "MintFinalized");
        } else {
          // The last multi-sig mint should fail due to insufficient pool funds
          await controller.connect(mintRatifier3).ratifyMint(mintIndex, user1.address, multiSigMintAmount, ethDepositTx);
          await expect(controller.connect(mintRatifier3).canFinalize(mintIndex))
            .to.be.revertedWith("Not enough approvals");
        }
      }

      // Verify that all pools are depleted
      expect(await controller.getInstantMintPool()).to.equal(0);
      expect(await controller.getRatifiedMintPool()).to.equal(0);
      expect(await controller.getMultiSigMintPool()).to.be.lt(multiSigMintAmount);
    });

    it("should allow admin to bypass multi-signature requirement and pool limits", async function () {
      await controller.connect(systemOperator).requestMint(user1.address, largeMintAmount, ethDepositTx);
      await expect(controller.connect(owner).finalizeMint(0))
        .to.emit(controller, "MintFinalized");
    });

    it("should not allow the same ratifier to approve twice", async function () {
      const mintIndex = await requestMint(largeMintAmount);
      await controller.connect(mintRatifier1).ratifyMint(mintIndex, user1.address, largeMintAmount, ethDepositTx);
      await expect(controller.connect(mintRatifier1).ratifyMint(mintIndex, user1.address, largeMintAmount, ethDepositTx))
        .to.be.revertedWith("Already approved");
    });

    it("should revert if mint details do not match", async function () {
      const mintIndex = await requestMint(largeMintAmount);
      await expect(controller.connect(mintRatifier1).ratifyMint(mintIndex, user2.address, largeMintAmount, ethDepositTx))
        .to.be.revertedWith("To address does not match");
      await expect(controller.connect(mintRatifier1).ratifyMint(mintIndex, user1.address, ratifiedMintAmount, ethDepositTx))
        .to.be.revertedWith("Amount does not match");
      await expect(controller.connect(mintRatifier1).ratifyMint(mintIndex, user1.address, largeMintAmount, "0x1234"))
        .to.be.revertedWith("Eth deposit tx does not match");
    });
  });

  describe("invalidateAllPendingMints functionality", function () {
    it("should invalidate all pending mints", async function () {
      await controller.connect(systemOperator).requestMint(user1.address, ethers.parseUnits("1000", 6), ethDepositTx);
      await controller.connect(systemOperator).requestMint(user1.address, ethers.parseUnits("2000", 6), ethDepositTx);

      await controller.connect(owner).invalidateAllPendingMints();

      await expect(controller.connect(mintRatifier1).ratifyMint(0, user1.address, ethers.parseUnits("1000", 6), ethDepositTx))
        .to.be.revertedWith("This mint is invalid");
      await expect(controller.connect(mintRatifier1).ratifyMint(1, user1.address, ethers.parseUnits("2000", 6), ethDepositTx))
        .to.be.revertedWith("This mint is invalid");
    });
  });

  describe("Fee management", function () {
    it("should allow admin to set fee rate", async function () {
      await expect(controller.connect(owner).setFeeRate(2000))
        .to.not.be.reverted;
      expect(await controller.getFeeRate()).to.equal(2000);
    });

    it("should not allow setting invalid fee rate", async function () {
      await expect(controller.connect(owner).setFeeRate(1000_001))
        .to.be.revertedWith("Invalid fee rate");
    });

    it("should allow admin to set treasury", async function () {
      await expect(controller.connect(owner).setTreasury(user2.address))
        .to.not.be.reverted;
      expect(await controller.getTreasury()).to.equal(user2.address);
    });

    it("should correctly apply fees during minting", async function () {
      const mintAmount = ethers.parseUnits("10000", 6);
      const feeRate = await controller.getFeeRate();
      const fee = mintAmount * feeRate / BigInt(1000000);
      const actualMintAmount = mintAmount - fee;

      await controller.connect(systemOperator).requestMint(user1.address, mintAmount, ethDepositTx);
      await expect(controller.connect(mintRatifier1).ratifyMint(0, user1.address, mintAmount, ethDepositTx))
        .to.emit(controller, "MintFinalized")
        .withArgs(user1.address, actualMintAmount, ethDepositTx, 0)
        .to.emit(controller, "FeePaid")
        .withArgs(treasury.address, fee);

      expect(await usdc.balanceOf(user1.address)).to.equal(actualMintAmount);
      expect(await usdc.balanceOf(treasury.address)).to.equal(fee);
    });
  });

  describe("Token management", function () {
    it("should allow admin to transfer token ownership", async function () {
      await expect(controller.connect(owner).transferTokenOwnership(user2.address))
        .to.not.be.reverted;
      expect(await usdc.pendingOwner()).to.equal(user2.address);
    });
  });

  describe("Whitelist management", function () {
    it("should allow whitelist manager to update whitelist", async function () {
      await expect(controller.connect(whitelistManager).updateWhitelist(user2.address, true))
        .to.not.be.reverted;
      expect(await usdc.isWhitelisted(user2.address)).to.be.true;
    });

    it("should not allow non-whitelist manager to update whitelist", async function () {
      await expect(controller.connect(user1).updateWhitelist(user2.address, true))
        .to.be.reverted;
    });
  });

  describe("Blacklist management", function () {
    it("should allow whitelist manager to add to blacklist", async function () {
      await expect(controller.connect(whitelistManager).addBlacklist(user2.address))
        .to.not.be.reverted;
      expect(await usdc.isBlacklisted(user2.address)).to.be.true;
    });

    it("should allow admin to remove from blacklist", async function () {
      await controller.connect(whitelistManager).addBlacklist(user2.address);
      await expect(controller.connect(owner).removeBlacklist(user2.address))
        .to.not.be.reverted;
      expect(await usdc.isBlacklisted(user2.address)).to.be.false;
    });

    it("should not allow non-admin to remove from blacklist", async function () {
      await controller.connect(whitelistManager).addBlacklist(user2.address);
      await expect(controller.connect(whitelistManager).removeBlacklist(user2.address))
        .to.be.reverted;
    });

    it("should allow admin to destroy black funds", async function () {
      const blacklistedAmount = ethers.parseUnits("1000", 6);

      const feeRate = await controller.getFeeRate();
      const fee = blacklistedAmount * feeRate / 1_000_000n;
      const actualBlacklistedAmount = blacklistedAmount - fee;

      // Mint some tokens to user2 and blacklist them
      await controller.connect(systemOperator).instantMint(user2.address, blacklistedAmount, ethDepositTx);
      await controller.connect(whitelistManager).addBlacklist(user2.address);

      // Check initial balances
      expect(await usdc.balanceOf(user2.address)).to.equal(actualBlacklistedAmount);
      const initialTotalSupply = await usdc.totalSupply();

      // Destroy black funds
      await expect(controller.connect(owner).destroyBlackFunds(user2.address))
        .to.emit(usdc, "DestroyedBlackFunds")
        .withArgs(user2.address, actualBlacklistedAmount);

      // Check final balances
      expect(await usdc.balanceOf(user2.address)).to.equal(0);
      expect(await usdc.totalSupply()).to.equal(initialTotalSupply - actualBlacklistedAmount);
    });

    it("should not allow non-admin to destroy black funds", async function () {
      await controller.connect(whitelistManager).addBlacklist(user2.address);
      await expect(controller.connect(whitelistManager).destroyBlackFunds(user2.address))
        .to.be.reverted;
    });

    it("should not allow destroying funds of non-blacklisted address", async function () {
      await expect(controller.connect(owner).destroyBlackFunds(user2.address))
        .to.be.revertedWith("USDC: account is not blacklisted");
    });
  });

  describe("Token reclaim", function () {
    it("should allow admin to reclaim other tokens from USDC", async function () {
      const MockToken = await ethers.getContractFactory("MockERC20");
      const mockToken = await MockToken.deploy("Mock Token", "MTK", ethers.parseUnits("1000000", 18), owner);
      await mockToken.waitForDeployment();

      const amount = ethers.parseUnits("1000", 18);
      await mockToken.transfer(await usdc.getAddress(), amount);

      expect(await mockToken.balanceOf(await usdc.getAddress())).to.equal(amount);

      await expect(controller.connect(owner).reclaimTokenFromUSDC(await mockToken.getAddress()))
        .to.changeTokenBalances(
          mockToken,
          [usdc, owner],
          [-amount, amount]
        );

      expect(await mockToken.balanceOf(await usdc.getAddress())).to.equal(0);
    });
    it("should allow admin to reclaim other tokens", async function () {
      const MockToken = await ethers.getContractFactory("MockERC20");
      const mockToken = await MockToken.deploy("Mock", "MCK", ethers.parseUnits("1000000", 18), owner);
      await mockToken.waitForDeployment();

      const amount = ethers.parseUnits("1000", 18);
      await mockToken.transfer(await controller.getAddress(), amount);

      await expect(controller.connect(owner).reclaimToken(await mockToken.getAddress(), owner.address))
        .to.changeTokenBalances(mockToken, [controller, owner], [-amount, amount]);
    });
  });
});