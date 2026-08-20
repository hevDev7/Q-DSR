import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { ethers, network } from 'hardhat';

/**
 * Deploys the Q-DSR contract pair and records the addresses where the API server
 * and the UI can pick them up.
 *
 * Run against `ogTestnet` freely. `ogMainnet` is the Wave 3 submission artifact and
 * should be run exactly once, deliberately.
 */
async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error('No signer available — is DEPLOYER_PRIVATE_KEY set?');

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`network   ${network.name} (chainId ${network.config.chainId})`);
  console.log(`deployer  ${deployer.address}`);
  console.log(`balance   ${ethers.formatEther(balance)} 0G`);

  if (balance === 0n) {
    throw new Error('Deployer has a zero balance — fund it before deploying.');
  }

  const attestor = process.env.ATTESTOR_ADDRESS ?? deployer.address;

  console.log('\ndeploying QDSRRegistry...');
  const registryFactory = await ethers.getContractFactory('QDSRRegistry');
  const registry = await registryFactory.deploy(attestor);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log(`  QDSRRegistry  ${registryAddress}`);

  console.log('deploying AgenticID...');
  const agenticFactory = await ethers.getContractFactory('AgenticID');
  const agentic = await agenticFactory.deploy(registryAddress);
  await agentic.waitForDeployment();
  const agenticAddress = await agentic.getAddress();
  console.log(`  AgenticID     ${agenticAddress}`);

  // Only the 0G networks have an explorer. A local node must not be handed a
  // Galileo link — a wrong link is worse than no link, because it looks checked.
  const EXPLORERS: Record<number, string> = {
    16661: 'https://chainscan.0g.ai',
    16602: 'https://chainscan-galileo.0g.ai',
  };
  const explorer = EXPLORERS[network.config.chainId ?? 0];

  const record = {
    network: network.name,
    chainId: network.config.chainId,
    deployer: deployer.address,
    attestor,
    deployedAt: new Date().toISOString(),
    contracts: {
      QDSRRegistry: registryAddress,
      AgenticID: agenticAddress,
    },
    explorer: explorer
      ? {
          QDSRRegistry: `${explorer}/address/${registryAddress}`,
          AgenticID: `${explorer}/address/${agenticAddress}`,
        }
      : undefined,
  };

  const outPath = resolve(__dirname, '..', 'deployments', `${network.name}.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  console.log(`\nwrote ${outPath}`);
  if (record.explorer) {
    console.log(`\nexplorer:\n  ${record.explorer.QDSRRegistry}\n  ${record.explorer.AgenticID}`);
  } else {
    console.log(`\nno block explorer for chain ${network.config.chainId}`);
  }

  console.log(
    `\nnext:\n  pnpm --filter @workspace/contracts run validate:${network.name === 'ogMainnet' ? 'mainnet' : network.name === 'ogTestnet' ? 'testnet' : 'local'}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
