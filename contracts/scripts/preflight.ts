import { ethers, network } from 'hardhat';

/**
 * Checks everything a deployment needs before it spends anything.
 *
 * Run this before deploy:testnet and again before deploy:mainnet. A mainnet
 * deployment is the Wave 3 submission artifact — finding out mid-transaction
 * that the RPC is unreachable or the deployer is unfunded is an avoidable way
 * to burn an afternoon.
 */

const EXPECTED: Record<string, { chainId: number; explorer: string; faucet?: string }> = {
  ogTestnet: {
    chainId: 16602,
    explorer: 'https://chainscan-galileo.0g.ai',
    faucet: 'https://faucet.0g.ai/',
  },
  ogMainnet: {
    chainId: 16661,
    explorer: 'https://chainscan.0g.ai',
  },
};

// A conservative floor. The pair costs well under this; the margin is for
// retries and for the verdict transactions that follow.
const MIN_BALANCE = ethers.parseEther('0.05');

async function main(): Promise<void> {
  const failures: string[] = [];
  const warnings: string[] = [];

  console.log(`\npreflight — ${network.name}\n${'─'.repeat(52)}`);

  const expected = EXPECTED[network.name];
  if (!expected) {
    console.log(`  note        no expectations registered for "${network.name}"`);
  }

  // --- key -----------------------------------------------------------------
  if (!process.env.DEPLOYER_PRIVATE_KEY) {
    failures.push('DEPLOYER_PRIVATE_KEY is not set — hardhat has no account to deploy from');
  }

  const signers = await ethers.getSigners();
  const deployer = signers[0];
  if (!deployer) {
    failures.push('no signer available');
  } else {
    console.log(`  deployer    ${deployer.address}`);
  }

  // --- chain ---------------------------------------------------------------
  let chainId: number | undefined;
  try {
    const net = await ethers.provider.getNetwork();
    chainId = Number(net.chainId);
    console.log(`  rpc         reachable, chainId ${chainId}`);
  } catch (error) {
    failures.push(
      `RPC unreachable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (expected && chainId !== undefined && chainId !== expected.chainId) {
    failures.push(
      `chainId mismatch — connected to ${chainId}, expected ${expected.chainId} for ${network.name}`,
    );
  }

  // --- balance -------------------------------------------------------------
  if (deployer && chainId !== undefined) {
    const balance = await ethers.provider.getBalance(deployer.address);
    console.log(`  balance     ${ethers.formatEther(balance)} 0G`);

    if (balance === 0n) {
      failures.push(
        expected?.faucet
          ? `deployer has no funds — request testnet tokens at ${expected.faucet}`
          : 'deployer has no funds',
      );
    } else if (balance < MIN_BALANCE) {
      warnings.push(
        `balance is below ${ethers.formatEther(MIN_BALANCE)} 0G; deployment may succeed but ` +
          'leave nothing for the verdict transactions that follow',
      );
    }
  }

  // --- attestor ------------------------------------------------------------
  const attestor = process.env.ATTESTOR_ADDRESS;
  if (attestor) {
    if (!ethers.isAddress(attestor)) {
      failures.push(`ATTESTOR_ADDRESS is not a valid address: ${attestor}`);
    } else {
      console.log(`  attestor    ${attestor}`);
    }
  } else if (deployer) {
    warnings.push(
      'ATTESTOR_ADDRESS is unset — the deployer will be the sole attestor. Fine for a ' +
        'testnet run; decide deliberately before mainnet.',
    );
  }

  // --- compiled artifacts --------------------------------------------------
  try {
    await ethers.getContractFactory('QDSRRegistry');
    await ethers.getContractFactory('AgenticID');
    console.log('  artifacts   compiled');
  } catch {
    failures.push('contracts are not compiled — run `pnpm --filter @workspace/contracts run compile`');
  }

  // --- report --------------------------------------------------------------
  console.log('');
  for (const warning of warnings) console.log(`  WARN  ${warning}`);
  for (const failure of failures) console.log(`  FAIL  ${failure}`);

  if (failures.length > 0) {
    console.log(`\n  not ready to deploy — ${failures.length} blocking issue(s)\n`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n  ready to deploy to ${network.name}`);
  if (expected) console.log(`  explorer    ${expected.explorer}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
