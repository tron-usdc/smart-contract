require("@nomicfoundation/hardhat-toolbox");
require('@openzeppelin/hardhat-upgrades');
require('dotenv').config()


/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.26",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          }
        }
      },
    ],
  },
  networks: {
    localhost: {
      url: "http://localhost:9545",
    },
    sepolia: {
      url: "https://sepolia.infura.io/v3/3c27e0aba8d543f3a1bdb553edebd491",
      accounts: [process.env.OWNER_PRIVATE_KEY_SEPOLIA, process.env.USER_1_PRIVATE_KEY_SEPOLIA]
    },
  }
};
