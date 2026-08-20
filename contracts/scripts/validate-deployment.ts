import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ethers, network } from 'hardhat';

/**
 * Exercises a deployed pair end to end and reports what it observed.
 *
 * The read-only section runs everywhere. The write section actually pushes
 * verdicts and attempts mints, which is the only way to prove the gate works
 * against a real chain rather than against Hardhat's in-process node.
 *
 * Writes are enabled by default on localhost and the testnet, and require an
 * explicit VALIDATE_ALLOW_WRITES=1 on mainnet — the mainnet registry is the
 * submission artifact and should not carry scratch agents unless someone
 * decided so on purpose.
 */

interface DeploymentRecord {
  chainId: number;
  contracts: { QDSRRegistry: string; AgenticID: string };
  explorer: { QDSRRegistry: string; AgenticID: string };
}

const EXPLORERS: Record<number, string> = {
  16661: 'https://chainscan.0g.ai',
  16602: 'https://chainscan-galileo.0g.ai',
};

function loadAddresses(): { registry: string; agenticId: string } {
  const fromEnv = process.env.QDSR_REGISTRY_ADDRESS;
  const agenticFromEnv = process.env.AGENTIC_ID_ADDRESS;
  if (fromEnv && agenticFromEnv) {
    return { registry: fromEnv, agenticId: agenticFromEnv };
  }

  const path = resolve(__dirname, '..', 'deployments', `${network.name}.json`);
  try {
    const record = JSON.parse(readFileSync(path, 'utf8')) as DeploymentRecord;
    return {
      registry: record.contracts.QDSRRegistry,
      agenticId: record.contracts.AgenticID,
    };
  } catch {
    throw new Error(
      `No addresses found. Either deploy first (writing ${path}) or set ` +
        'QDSR_REGISTRY_ADDRESS and AGENTIC_ID_ADDRESS.',
    );
  }
}

const results: { ok: boolean; label: string; detail: string }[] = [];

function check(label: string, ok: boolean, detail: string): void {
  results.push({ ok, label, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(46)} ${detail}`);
}

// Metrics matching a certified verdict and an overfit one. These are the real
// numbers the engine produced for the demo fleet, so the validation exercises
// the same values the protocol actually writes.
const CERTIFIED = { dsrBps: 9_982n, pboBps: 4n, trials: 60n, observations: 756n };
const OVERFIT = { dsrBps: 4_889n, pboBps: 5_041n, trials: 60n, observations: 756n };
const ENGINE = 'qdsr-core/1.0.0';

async function main(): Promise<void> {
  const { registry: registryAddress, agenticId: agenticAddress } = loadAddresses();
  const [signer] = await ethers.getSigners();
  if (!signer) throw new Error('No signer available — is DEPLOYER_PRIVATE_KEY set?');

  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const explorer = EXPLORERS[chainId];

  console.log(`\nvalidating deployment — ${network.name} (chainId ${chainId})`);
  console.log('─'.repeat(76));
  console.log(`  registry    ${registryAddress}`);
  console.log(`  agenticId   ${agenticAddress}`);
  console.log(`  caller      ${signer.address}\n`);

  const registry = await ethers.getContractAt('QDSRRegistry', registryAddress, signer);
  const agentic = await ethers.getContractAt('AgenticID', agenticAddress, signer);

  // --- read-only -----------------------------------------------------------

  const code = await ethers.provider.getCode(registryAddress);
  check('registry has bytecode at that address', code !== '0x', `${(code.length - 2) / 2} bytes`);

  const minDsr = await registry.MIN_DSR_BPS();
  const maxPbo = await registry.MAX_PBO_BPS();
  const minObs = await registry.MIN_OBSERVATIONS();
  const minTrials = await registry.MIN_TRIALS();

  check('DSR threshold is 0.95', minDsr === 9_500n, `${minDsr} bps`);
  check('PBO threshold is 0.10', maxPbo === 1_000n, `${maxPbo} bps`);
  check('minimum observations is one trading year', minObs === 252n, `${minObs}`);
  check('minimum trials is 2', minTrials === 2n, `${minTrials}`);

  const wiredRegistry = await agentic.registry();
  check(
    'AgenticID points at this registry',
    wiredRegistry.toLowerCase() === registryAddress.toLowerCase(),
    wiredRegistry,
  );

  const symbol = await agentic.symbol();
  check('AgenticID is an ERC-721', await agentic.supportsInterface('0x80ac58cd'), symbol);

  const isAttestor = await registry.isAttestor(signer.address);
  check('caller is an authorised attestor', isAttestor, isAttestor ? 'yes' : 'no — writes will revert');

  // --- write path ----------------------------------------------------------

  const writesAllowed =
    chainId === 16661 ? process.env.VALIDATE_ALLOW_WRITES === '1' : true;

  if (!writesAllowed) {
    console.log(
      '\n  write checks skipped on mainnet. Set VALIDATE_ALLOW_WRITES=1 to run them,\n' +
        '  which will write two scratch verdicts and mint one token.',
    );
  } else if (!isAttestor) {
    console.log('\n  write checks skipped — the caller is not an attestor.');
  } else {
    console.log('');
    // A scratch identity, namespaced per run so repeated validations do not
    // collide with each other on a persistent chain.
    const agentId = ethers.keccak256(
      ethers.toUtf8Bytes(`qdsr-validation-${chainId}-${Date.now()}`),
    );
    const evidenceRoot = ethers.keccak256(ethers.toUtf8Bytes(`root-${agentId}`));
    const resultDigest = ethers.keccak256(ethers.toUtf8Bytes(`digest-${agentId}`));

    // 1. an overfit verdict must not certify, even though we submitted it
    const failTx = await registry.submitVerdict(
      agentId, evidenceRoot, resultDigest, ENGINE,
      OVERFIT.dsrBps, OVERFIT.pboBps, OVERFIT.trials, OVERFIT.observations,
    );
    const failReceipt = await failTx.wait();
    check(
      'overfit metrics are refused certification',
      (await registry.isCertified(agentId)) === false,
      `block ${failReceipt?.blockNumber}`,
    );

    // 2. minting must revert while uncertified
    let mintBlocked = false;
    try {
      await agentic.mint.staticCall(signer.address, agentId, '0g://scratch', resultDigest);
    } catch {
      mintBlocked = true;
    }
    check('mint reverts for an uncertified agent', mintBlocked, 'AgentNotCertified');

    // 3. the oracle hook answers correctly
    const proof = ethers.AbiCoder.defaultAbiCoder().encode(['bytes32'], [agentId]);
    check('IOracle.verifyProof reports false', (await registry.verifyProof(proof)) === false, 'false');

    // 4. a passing verdict certifies
    const passTx = await registry.submitVerdict(
      agentId, evidenceRoot, resultDigest, ENGINE,
      CERTIFIED.dsrBps, CERTIFIED.pboBps, CERTIFIED.trials, CERTIFIED.observations,
    );
    const passReceipt = await passTx.wait();
    check(
      'passing metrics certify the agent',
      (await registry.isCertified(agentId)) === true,
      `block ${passReceipt?.blockNumber}`,
    );

    // 5. the earlier failure is still on the record
    check(
      'the failed verdict is still on record',
      (await registry.hasFailedVerdict(agentId)) === true,
      `${await registry.verdictCount(agentId)} verdicts`,
    );

    // 6. minting now succeeds
    const mintTx = await agentic.mint(signer.address, agentId, '0g://scratch', resultDigest);
    const mintReceipt = await mintTx.wait();
    const tokenId = await agentic.tokenIdOfAgent(agentId);
    check('mint succeeds once certified', tokenId > 0n, `tokenId ${tokenId}, block ${mintReceipt?.blockNumber}`);

    check('the minted token reports its certification', await agentic.isStillCertified(tokenId), 'true');

    if (explorer) {
      console.log(`\n  transactions:`);
      for (const [label, hash] of [
        ['overfit verdict', failReceipt?.hash],
        ['passing verdict', passReceipt?.hash],
        ['mint', mintReceipt?.hash],
      ] as const) {
        if (hash) console.log(`    ${label.padEnd(16)} ${explorer}/tx/${hash}`);
      }
    }
  }

  // --- summary -------------------------------------------------------------

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${'─'.repeat(76)}`);
  if (failed.length === 0) {
    console.log(`  ${results.length} checks passed — this deployment behaves correctly`);
    if (explorer) {
      console.log(`\n  registry    ${explorer}/address/${registryAddress}`);
      console.log(`  agenticId   ${explorer}/address/${agenticAddress}`);
    }
    console.log('');
  } else {
    console.log(`  ${failed.length} of ${results.length} checks FAILED\n`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
