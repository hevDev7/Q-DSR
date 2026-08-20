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

const API = process.env.QDSR_API_URL ?? 'http://127.0.0.1:8080/api';

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

    const started = await call<Run>(`/agents/${agent.id}/verify`, {
      returnsCsv: sample.returnsCsv,
      trialsCsv: sample.trialsCsv,
      selectedColumn: sample.selectedColumn,
    });

    let run = started;
    for (let attempt = 0; attempt < 100 && run.status !== 'completed' && run.status !== 'failed'; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      run = await call<Run>(`/runs/${started.id}`);
    }

    // Anchoring is expected to fail without chain credentials; the evidence root
    // is still computed and recorded, which is the part worth demonstrating.
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
