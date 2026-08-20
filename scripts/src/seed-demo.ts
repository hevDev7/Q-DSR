/**
 * Populates a running API server with a demonstrative fleet.
 *
 * Two agents built from pure noise, one with a genuine but unprovable edge, and
 * one that clears the bar. The near-miss matters most: it shows the protocol is
 * a measurement rather than a binary theatre.
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
  { name: 'Vega Lantern', family: 'Options volatility / ETH', owner: 'dev@vega', kind: 'genuine', seed: 7101 },
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
      observations: 756,
      trials: 60,
      seed: spec.seed,
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
