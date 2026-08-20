import '@nomicfoundation/hardhat-ethers';
import '@nomicfoundation/hardhat-chai-matchers';
import '@nomicfoundation/hardhat-network-helpers';
import '@typechain/hardhat';
import '@nomicfoundation/hardhat-verify';
import type { HardhatUserConfig } from 'hardhat/config';

/**
 * Deployment keys come from the environment only — never from a file in the repo.
 * `DEPLOYER_PRIVATE_KEY` stays unset until the moment of a real deploy.
 */
const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
const accounts = deployerKey ? [deployerKey] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // submitVerdict carries enough fields to exhaust the legacy stack; the IR
      // pipeline compiles it without contorting the function signature.
      viaIR: true,
      // 0G Chain runs the EVM at the cancun hard fork.
      evmVersion: process.env.EVM_VERSION ?? 'cancun',
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    // A local node running the same contracts. Deploying and validating here
    // first proves the deploy script and the anchoring path without spending a
    // single testnet token.
    localhost: {
      url: process.env.LOCAL_RPC_URL ?? 'http://127.0.0.1:8545',
      chainId: 31337,
    },
    // 0G Galileo testnet
    ogTestnet: {
      url: process.env.OG_TESTNET_RPC_URL ?? 'https://evmrpc-testnet.0g.ai',
      chainId: 16602,
      accounts,
    },
    // 0G mainnet
    ogMainnet: {
      url: process.env.OG_MAINNET_RPC_URL ?? 'https://evmrpc.0g.ai',
      chainId: 16661,
      accounts,
    },
  },
  etherscan: {
    apiKey: {
      ogTestnet: 'not-required',
      ogMainnet: 'not-required',
    },
    customChains: [
      {
        network: 'ogTestnet',
        chainId: 16602,
        urls: {
          apiURL: 'https://chainscan-galileo.0g.ai/open/api',
          browserURL: 'https://chainscan-galileo.0g.ai',
        },
      },
      {
        network: 'ogMainnet',
        chainId: 16661,
        urls: {
          apiURL: 'https://chainscan.0g.ai/open/api',
          browserURL: 'https://chainscan.0g.ai',
        },
      },
    ],
  },
  typechain: {
    outDir: 'typechain-types',
    target: 'ethers-v6',
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
};

export default config;
