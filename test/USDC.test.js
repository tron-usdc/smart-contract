const {expect} = require("chai");
const {ethers, upgrades} = require("hardhat");

describe('USDCTest', function () {
  let USDC, usdc, owner, user1, user2, user3;
  const INITIAL_SUPPLY = 0;
  const MIN_BURN_AMOUNT = ethers.parseUnits("10", 6); // 10 USDC

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();
    USDC = await ethers.getContractFactory('USDC');
    usdc = await upgrades.deployProxy(USDC, [owner.address, MIN_BURN_AMOUNT]);
    await usdc.waitForDeployment();
  });

  describe("Initialization", function () {
    it("should set the right owner", async function () {
      expect(await usdc.owner()).to.equal(owner.address);
    });

    it("should have correct name and symbol", async function () {
      expect(await usdc.name()).to.equal("USD Coin");
      expect(await usdc.symbol()).to.equal("USDC");
    });

    it("should have 6 decimals", async function () {
      expect(await usdc.decimals()).to.equal(6);
    });

    it("should have correct initial supply", async function () {
      expect(await usdc.totalSupply()).to.equal(INITIAL_SUPPLY);
    });

    it("should set correct min burn amount", async function () {
      expect(await usdc.getMinBurnAmount()).to.equal(MIN_BURN_AMOUNT);
    });
  });

  describe("Minting", function () {
    it("should allow owner to mint tokens", async function () {
      const mintAmount = ethers.parseUnits("1000", 6);
      await expect(usdc.connect(owner).mint(user1.address, mintAmount))
        .to.emit(usdc, "Transfer")
        .withArgs(ethers.ZeroAddress, user1.address, mintAmount);
      expect(await usdc.balanceOf(user1.address)).to.equal(mintAmount);
    });

    it("should not allow non-owner to mint tokens", async function () {
      const mintAmount = ethers.parseUnits("1000", 6);
      await expect(usdc.connect(user1).mint(user2.address, mintAmount))
        .to.be.revertedWithCustomError(usdc, "OwnableUnauthorizedAccount");
    });

    it("should not allow minting when paused", async function () {
      await usdc.connect(owner).pause();
      const mintAmount = ethers.parseUnits("1000", 6);
      await expect(usdc.connect(owner).mint(user1.address, mintAmount))
        .to.be.revertedWithCustomError(usdc, "EnforcedPause");
    });
  });

  describe("Burning", function () {
    beforeEach(async function () {
      const mintAmount = ethers.parseUnits("1000", 6);
      await usdc.connect(owner).mint(user1.address, mintAmount);
      await usdc.connect(owner).updateWhitelist(user1.address, true);
    });

    it("should reject burn with invalid Ethereum address", async function () {
      const invalidEthAddress = "0xinvalidAddress";
      const ethZeroAddress = "0x0000000000000000000000000000000000000000";

      const burnAmount = ethers.parseUnits("100", 6);
      await expect(usdc.connect(user1).burn(burnAmount, invalidEthAddress))
        .to.be.revertedWith("Invalid target eth address");

      await expect(usdc.connect(user1).burn(burnAmount, ethZeroAddress))
        .to.be.revertedWith("Invalid target eth address");
    });

    it("should allow whitelisted users to burn tokens", async function () {
      const burnAmount = ethers.parseUnits("100", 6);
      const targetEthAddress = "0x1234567890123456789012345678901234567890";
      await expect(usdc.connect(user1).burn(burnAmount, targetEthAddress))
        .to.emit(usdc, "Burned")
        .withArgs(user1.address, targetEthAddress, burnAmount);

      // invalid target eth address
      await expect(usdc.connect(user1).burn(burnAmount, "742d35Cc6634C0532925a3b844Bc454e4438f44e"))
        .to.be.revertedWith("Invalid target eth address");
    });

    it("should not allow non-whitelisted users to burn tokens", async function () {
      const burnAmount = ethers.parseUnits("100", 6);
      await expect(usdc.connect(user2).burn(burnAmount, user2.address))
        .to.be.revertedWith("Whitelistable: account is not whitelisted");
    });

    it("should not allow burning less than minimum amount", async function () {
      const burnAmount = ethers.parseUnits("5", 6);
      await expect(usdc.connect(user1).burn(burnAmount, user1.address))
        .to.be.revertedWith("Amount less than min burn amount");
    });

    it("should not allow burning when paused", async function () {
      await usdc.connect(owner).pause();
      const burnAmount = ethers.parseUnits("100", 6);
      await expect(usdc.connect(user1).burn(burnAmount, user1.address))
        .to.be.revertedWithCustomError(usdc, "EnforcedPause");
    });
  });

  describe("Blacklisting", function () {
    it("should allow owner to blacklist an address", async function () {
      await expect(usdc.connect(owner).blacklist(user1.address))
        .to.emit(usdc, "BlacklistUpdated")
        .withArgs(user1.address, true);
      expect(await usdc.isBlacklisted(user1.address)).to.be.true;
    });

    it("should allow owner to unblacklist an address", async function () {
      await usdc.connect(owner).blacklist(user1.address);
      await expect(usdc.connect(owner).unblacklist(user1.address))
        .to.emit(usdc, "BlacklistUpdated")
        .withArgs(user1.address, false);
      expect(await usdc.isBlacklisted(user1.address)).to.be.false;
    });

    it("should prevent transfers to and from blacklisted addresses", async function () {
      const mintAmount = ethers.parseUnits("1000", 6);
      await usdc.connect(owner).mint(user1.address, mintAmount);
      await usdc.connect(owner).blacklist(user2.address);

      await expect(usdc.connect(user1).transfer(user2.address, mintAmount))
        .to.be.revertedWith("Blacklistable: account is blacklisted");
      await expect(usdc.connect(user2).transfer(user1.address, mintAmount))
        .to.be.revertedWith("Blacklistable: account is blacklisted");
    });

    it("should not allow non-owner to blacklist or unblacklist", async function () {
      await expect(usdc.connect(user1).blacklist(user2.address))
        .to.be.revertedWithCustomError(usdc, "OwnableUnauthorizedAccount");
      await expect(usdc.connect(user1).unblacklist(user2.address))
        .to.be.revertedWithCustomError(usdc, "OwnableUnauthorizedAccount");
    });
  });

  describe("Pausing", function () {
    beforeEach(async function () {
      await usdc.connect(owner).mint(user1.address, ethers.parseUnits("1000", 6));
      await usdc.connect(owner).updateWhitelist(user1.address, true);
    });

    it("should allow owner to pause and unpause the contract", async function () {
      await expect(usdc.connect(owner).pause()).to.emit(usdc, "Paused");
      expect(await usdc.paused()).to.be.true;

      await expect(usdc.connect(owner).unpause()).to.emit(usdc, "Unpaused");
      expect(await usdc.paused()).to.be.false;
    });

    it("should prevent mint when paused", async function () {
      await usdc.connect(owner).pause();
      await expect(usdc.connect(owner).mint(user1.address, ethers.parseUnits("1000", 6)))
        .to.be.revertedWithCustomError(usdc, "EnforcedPause");
    });

    it("should prevent burn when paused", async function () {
      await usdc.connect(owner).pause();
      await expect(usdc.connect(user1).burn(ethers.parseUnits("100", 6), user1.address))
        .to.be.revertedWithCustomError(usdc, "EnforcedPause");
    });
  });

  describe("Whitelist", function () {
    it("should allow owner to update whitelist", async function () {
      await expect(usdc.connect(owner).updateWhitelist(user1.address, true))
        .to.emit(usdc, "WhitelistUpdated")
        .withArgs(user1.address, true);

      expect(await usdc.isWhitelisted(user1.address)).to.be.true;
    });

    it("should not allow non-owner to update whitelist", async function () {
      await expect(usdc.connect(user1).updateWhitelist(user2.address, true))
        .to.be.revertedWithCustomError(usdc, "OwnableUnauthorizedAccount");
    });
  });

  describe("Whitelist Enabled", function () {
    it("should allow owner to enable/disable whitelist", async function () {
      await expect(usdc.connect(owner).setWhitelistEnabled(false))
        .to.emit(usdc, "WhitelistStatusChanged")
        .withArgs(false);
      expect(await usdc.isWhitelistEnabled()).to.be.false;

      await expect(usdc.connect(owner).setWhitelistEnabled(true))
        .to.emit(usdc, "WhitelistStatusChanged")
        .withArgs(true);
      expect(await usdc.isWhitelistEnabled()).to.be.true;
    });

    it("should not allow non-owner to enable/disable whitelist", async function () {
      await expect(usdc.connect(user1).setWhitelistEnabled(false))
        .to.be.revertedWithCustomError(usdc, "OwnableUnauthorizedAccount");
    });

    it("should allow any user to burn when whitelist is disabled", async function () {
      const mintAmount = ethers.parseUnits("1000", 6);
      const burnAmount = ethers.parseUnits("100", 6);

      await usdc.connect(owner).mint(user2.address, mintAmount);
      await expect(usdc.connect(user2).burn(burnAmount, user1.address))
        .to.be.revertedWith("Whitelistable: account is not whitelisted");

      await usdc.connect(owner).setWhitelistEnabled(false);
      await expect(usdc.connect(user2).burn(burnAmount, user1.address))
        .to.emit(usdc, "Burned")
        .withArgs(user2.address, user1.address, burnAmount);

      expect(await usdc.balanceOf(user2.address)).to.equal(mintAmount - burnAmount);

      await usdc.connect(owner).setWhitelistEnabled(true);
      await expect(usdc.connect(user2).burn(burnAmount, user1.address))
        .to.be.revertedWith("Whitelistable: account is not whitelisted");
    });

  });

  describe("Burn Min Amount", function () {
    it("should allow owner to update burn min amount", async function () {
      const newMinBurnAmount = ethers.parseUnits("20", 6);
      await expect(usdc.connect(owner).updateBurnMinAmount(newMinBurnAmount))
        .to.emit(usdc, "MinBurnAmountUpdated")
        .withArgs(MIN_BURN_AMOUNT, newMinBurnAmount);

      expect(await usdc.getMinBurnAmount()).to.equal(newMinBurnAmount);
    });

    it("should not allow non-owner to update burn min amount", async function () {
      await expect(usdc.connect(user1).updateBurnMinAmount(ethers.parseUnits("20", 6)))
        .to.be.revertedWithCustomError(usdc, "OwnableUnauthorizedAccount");
    });
  });

  describe("Destroy Black Funds", function () {
    it("should allow owner to destroy funds of blacklisted address", async function () {
      await usdc.connect(owner).mint(user1.address, ethers.parseUnits("1000", 6));
      await usdc.connect(owner).blacklist(user1.address);

      await expect(usdc.connect(owner).destroyBlackFunds(user1.address))
        .to.emit(usdc, "DestroyedBlackFunds")
        .withArgs(user1.address, ethers.parseUnits("1000", 6));

      expect(await usdc.balanceOf(user1.address)).to.equal(0);
    });

    it("should not allow destroying funds of non-blacklisted address", async function () {
      await expect(usdc.connect(owner).destroyBlackFunds(user1.address))
        .to.be.revertedWith("USDC: account is not blacklisted");
    });
  });

  describe("Reclaiming", function () {
    it("should allow owner to reclaim other tokens", async function () {
      const OtherToken = await ethers.getContractFactory("MockERC20");
      const otherToken = await OtherToken.deploy("Other", "OTH", ethers.parseUnits("1000", 18), owner.address);
      await otherToken.transfer(await usdc.getAddress(), ethers.parseUnits("100", 18));

      await expect(usdc.connect(owner).reclaimToken(await otherToken.getAddress(), user1.address))
        .to.changeTokenBalance(otherToken, user1, ethers.parseUnits("100", 18));
    });

    it("should not allow non-owner to reclaim tokens", async function () {
      const OtherToken = await ethers.getContractFactory("MockERC20");
      const otherToken = await OtherToken.deploy("Other", "OTH", ethers.parseUnits("1000", 18), owner.address);
      await otherToken.transfer(await usdc.getAddress(), ethers.parseUnits("100", 18));

      await expect(usdc.connect(user1).reclaimToken(await otherToken.getAddress(), user1.address))
        .to.be.revertedWithCustomError(usdc, "OwnableUnauthorizedAccount");
    });
  });

  describe("Ownership", function () {
    it("should allow owner to transfer ownership", async function () {
      await expect(usdc.connect(owner).transferOwnership(user1.address))
        .to.emit(usdc, "OwnershipTransferStarted")
        .withArgs(owner.address, user1.address);
    });

    it("should allow pending owner to accept ownership", async function () {
      await usdc.connect(owner).transferOwnership(user1.address);
      await expect(usdc.connect(user1).acceptOwnership())
        .to.emit(usdc, "OwnershipTransferred")
        .withArgs(owner.address, user1.address);
      expect(await usdc.owner()).to.equal(user1.address);
    });

    it("should not allow non-pending owner to accept ownership", async function () {
      await usdc.connect(owner).transferOwnership(user1.address);
      await expect(usdc.connect(user2).acceptOwnership())
        .to.be.revertedWithCustomError(usdc, "OwnableUnauthorizedAccount");
    });
  });

  describe("ERC20 standard functions", function () {
    beforeEach(async function () {
      await usdc.connect(owner).mint(user1.address, ethers.parseUnits("1000", 6));
    });

    it("should return correct balanceOf", async function () {
      expect(await usdc.balanceOf(user1.address)).to.equal(ethers.parseUnits("1000", 6));
    });

    it("should return correct allowance", async function () {
      await usdc.connect(user1).approve(user2.address, ethers.parseUnits("500", 6));
      expect(await usdc.allowance(user1.address, user2.address)).to.equal(ethers.parseUnits("500", 6));
    });

    it("should emit Transfer event on transfer", async function () {
      await expect(usdc.connect(user1).transfer(user2.address, ethers.parseUnits("100", 6)))
        .to.emit(usdc, "Transfer")
        .withArgs(user1.address, user2.address, ethers.parseUnits("100", 6));
    });

    it("should emit Approval event on approve", async function () {
      await expect(usdc.connect(user1).approve(user2.address, ethers.parseUnits("500", 6)))
        .to.emit(usdc, "Approval")
        .withArgs(user1.address, user2.address, ethers.parseUnits("500", 6));
    });
  });

  describe("Edge cases", function () {
    it("should not allow minting to zero address", async function () {
      await expect(usdc.connect(owner).mint(ethers.ZeroAddress, ethers.parseUnits("1000", 6)))
        .to.be.revertedWithCustomError(usdc, "ERC20InvalidReceiver");
    });

    it("should not allow burning more than balance", async function () {
      await usdc.connect(owner).mint(user1.address, ethers.parseUnits("1000", 6));
      await usdc.connect(owner).updateWhitelist(user1.address, true);
      await expect(usdc.connect(user1).burn(ethers.parseUnits("1001", 6), user1.address))
        .to.be.revertedWithCustomError(usdc, "ERC20InsufficientBalance");
    });

    it("should not allow transferring more than balance", async function () {
      await usdc.connect(owner).mint(user1.address, ethers.parseUnits("1000", 6));
      await expect(usdc.connect(user1).transfer(user2.address, ethers.parseUnits("1001", 6)))
        .to.be.revertedWithCustomError(usdc, "ERC20InsufficientBalance");
    });

    it("should not allow transferFrom more than allowed", async function () {
      await usdc.connect(owner).mint(user1.address, ethers.parseUnits("1000", 6));
      await usdc.connect(user1).approve(user2.address, ethers.parseUnits("500", 6));
      await expect(usdc.connect(user2).transferFrom(user1.address, user3.address, ethers.parseUnits("501", 6)))
        .to.be.revertedWithCustomError(usdc, "ERC20InsufficientAllowance");
    });
  });
});