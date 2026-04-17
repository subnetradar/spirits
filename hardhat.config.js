require("@nomicfoundation/hardhat-toolbox");

/**
 * Hardhat config for Subnet Spirits.
 *
 * Networks configured:
 *   - hardhat (local, default)
 *   - bittensorTestnet (EVM testnet)
 *   - bittensorMainnet (EVM mainnet)
 *
 * Env vars (put in .env; never commit):
 *   DEPLOYER_PRIVATE_KEY   — wallet that deploys
 *   BITTENSOR_TESTNET_RPC  — RPC URL for testnet
 *   BITTENSOR_MAINNET_RPC  — RPC URL for mainnet
 *   ETHERSCAN_API_KEY      — if Bittensor EVM has Etherscan-compatible verifier
 */

require("dotenv").config();

const PK = process.env.DEPLOYER_PRIVATE_KEY;
const accounts = PK ? [PK] : [];

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: false,
      evmVersion: "cancun",
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    bittensorTestnet: {
      url: process.env.BITTENSOR_TESTNET_RPC || "",
      accounts,
      chainId: 945, // update if different
    },
    bittensorMainnet: {
      url: process.env.BITTENSOR_MAINNET_RPC || "",
      accounts,
      chainId: 964, // update if different
    },
  },
  gasReporter: {
    enabled: true,
    currency: "USD",
  },
  mocha: {
    timeout: 40000,
  },
};
