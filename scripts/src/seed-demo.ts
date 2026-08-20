/**
 * Populates a running API server with a demonstrative fleet.
 *
 * Four agents telling four different stories:
 *
 *   Cinder Delta   a real edge with six years behind it        -> certified
 *   Vega Lantern   the same kind of edge, only three years     -> not yet provable
 *   Orbital Carry  pure noise                                  -> rejected
 *   Juniper Flow   pure noise                                  -> rejected
 *
 * Vega Lantern is the one worth demonstrating. It is not a strawman and not a
 * fraud — it is a genuine edge that the record is still too short to prove, and
 * the protocol says so rather than rounding it up. A fleet of obvious passes and
 * obvious failures would suggest the bar is decorative.
 *
 *   pnpm --filter @workspace/scripts exec tsx src/seed-demo.ts
 */

import { gzipSync } from 'node:zlib';

import { createEvidenceStorage, type EvidenceStorage } from '@workspace/og-storage';

const API = process.env.QDSR_API_URL ?? 'http://127.0.0.1:8080/api';

/**
 * The script plays the claimant, and pays like one.
 *
 * Evidence is published by whoever is making the claim — that is the whole point
 * of the arrangement — so this seeder publishes its own bundles rather than
 * handing CSVs to the server, which no longer accepts them. In a browser the
 * signer is the user's wallet; here it is a key from the environment.
 *
 * Without OG_PRIVATE_KEY this falls back to local storage, which still produces
 * a genuine 0G content address. The verdict anchors against a root nobody else
 * can fetch, which is worth knowing but fine for a local demo.
 */
let storage: EvidenceStorage | undefined;

async function publisher(): Promise<EvidenceStorage> {
  storage ??= await createEvidenceStorage({
    indexerRpc: process.env.OG_STORAGE_INDEXER_RPC,
    evmRpc: process.env.OG_STORAGE_EVM_RPC ?? process.env.OG_RPC_URL,
    privateKey: process.env.OG_STORAGE_PRIVATE_KEY ?? process.env.OG_PRIVATE_KEY,
    cacheDir: process.env.QDSR_SEED_CACHE ?? '.data/seed-storage',
  });
  return storage;
}

async function publishEvidence(
  agentName: string,
  sample: Sample,
  periodsPerYear = 252,
): Promise<string> {
  // Gzipped, like the browser publishes. A trials matrix is decimal text and
  // compresses about threefold — which is both three times less to pay for and
  // the difference between an upload the testnet indexer accepts and one that
  // stalls.
  const bytes = new Uint8Array(
    gzipSync(
      new TextEncoder().encode(
        JSON.stringify({
          agent: { name: agentName, periodsPerYear },
          evidence: {
            returnsCsv: sample.returnsCsv,
            trialsCsv: sample.trialsCsv,
            selectedColumn: sample.selectedColumn,
          },
        }),
      ),
    ),
  );
  const { rootHash } = await (await publisher()).upload(bytes, 'evidence.json');
  return rootHash;
}

interface Agent {
  id: string;
  name: string;
}

interface Sample {
  returnsCsv: string;
  trialsCsv: string;
  selectedColumn: string;
}

interface Run {
  id: string;
  status: string;
  result?: {
    verdict: string;
    dsr: number;
    pbo: number;
    sharpeAnnualised: number;
    elapsedMs: number;
  };
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(API + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${path}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

const FLEET = [
  { name: 'Cinder Delta', family: 'Market-neutral / ETH', owner: 'quants@cinder', kind: 'genuine', seed: 4242 },
  // Deliberately short: a real edge, three years of record, not yet provable at
  // sixty trials. This is the interesting verdict.
  { name: 'Vega Lantern', family: 'Options volatility / ETH', owner: 'dev@vega', kind: 'genuine', seed: 7101, observations: 756 },
  { name: 'Orbital Carry', family: 'Funding carry / SOL', owner: 'ops@orbital', kind: 'overfit', seed: 9931 },
  { name: 'Juniper Flow', family: 'Order flow / BTC', owner: 'research@juniper', kind: 'overfit', seed: 20260820 },
] as const;

async function main(): Promise<void> {
  const existing = await call<Agent[]>('/agents');

  for (const spec of FLEET) {
    let agent = existing.find((candidate) => candidate.name === spec.name);
    if (!agent) {
      agent = await call<Agent>('/agents', {
        name: spec.name,
        family: spec.family,
        owner: spec.owner,
      });
    }

    const sample = await call<Sample>('/evidence/sample', {
      kind: spec.kind,
      trials: 60,
      seed: spec.seed,
      // Omitted for most agents so the server picks a length suited to the kind.
      ...('observations' in spec ? { observations: spec.observations } : {}),
    });

    const evidenceRoot = await publishEvidence(spec.name, sample);
    const started = await call<Run>(`/agents/${agent.id}/verify`, { evidenceRoot });

    let run = started;
    for (let attempt = 0; attempt < 100 && run.status !== 'completed' && run.status !== 'failed'; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      run = await call<Run>(`/runs/${started.id}`);
    }

    // Anchoring is expected to fail without chain credentials; the evidence is
    // already published either way, which is the part worth demonstrating.
    await call(`/runs/${started.id}/anchor`, {}).catch(() => undefined);

    const result = run.result;
    console.log(
      result
        ? `  ${spec.name.padEnd(16)} ${result.verdict.padEnd(15)} ` +
            `DSR=${result.dsr.toFixed(4)} PBO=${result.pbo.toFixed(4)} ` +
            `SR=${result.sharpeAnnualised.toFixed(2)} ${Math.round(result.elapsedMs)}ms`
        : `  ${spec.name.padEnd(16)} ${run.status}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
