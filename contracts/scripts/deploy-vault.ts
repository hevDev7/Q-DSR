import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ethers, network } from 'hardhat';

/**
 * Deploys the CertifiedVault demo against the registry that is already live.
 *
 * The vault is a consumer of Q-DSR, not part of it: it reads an existing
 * registry and gates capital on its verdicts. So this script never deploys a
 * registry — it loads the address the main deploy recorded and points the vault
 * at it, then appends the vault to the same record.
 */
async function main(): Promise<void> {
  const recordPath = resolve(__dirname, '..', 'deployments', `${network.name}.json`);
  const record = JSON.parse(readFileSync(recordPath, 'utf8')) as {
    contracts: Record<string, string>;
    explorer?: Record<string, string>;
  };

  const registryAddress = record.contracts.QDSRRegistry;
  if (!registryAddress) throw new Error(`no QDSRRegistry in ${recordPath} — deploy the pair first`);

  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error('No signer — is DEPLOYER_PRIVATE_KEY set?');

  console.log(`network   ${network.name} (chainId ${network.config.chainId})`);
  console.log(`deployer  ${deployer.address}`);
  console.log(`registry  ${registryAddress}\n`);

  console.log('deploying CertifiedVault...');
  const vault = await (await ethers.getContractFactory('CertifiedVault')).deploy(registryAddress);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log(`  CertifiedVault  ${vaultAddress}`);

  const EXPLORERS: Record<number, string> = {
    16661: 'https://chainscan.0g.ai',
    16602: 'https://chainscan-galileo.0g.ai',
  };
  const explorer = EXPLORERS[network.config.chainId ?? 0];

  record.contracts.CertifiedVault = vaultAddress;
  if (explorer) {
    record.explorer = record.explorer ?? {};
    record.explorer.CertifiedVault = `${explorer}/address/${vaultAddress}`;
  }
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  console.log(`\nwrote ${recordPath}`);
  if (explorer) console.log(`explorer:\n  ${explorer}/address/${vaultAddress}`);
  console.log('\nverify:');
  console.log(
    `  pnpm --filter @workspace/contracts exec hardhat verify --network ${network.name} ${vaultAddress} ${registryAddress}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
