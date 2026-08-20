# Q-DSR Protocol

Statistical certification for AI trading agents: an evidence bundle must survive
Probability of Backtest Overfitting and Deflated Sharpe Ratio testing before the
agent can mint an ERC-7857 Agentic ID on 0G.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API server (port 8080)
- `PORT=22107 BASE_PATH=/ pnpm --filter @workspace/qdsr-verification run dev` — dashboard
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/contracts run test` — Hardhat contract tests
- `pnpm --filter @workspace/qdsr-core run test` — the statistics engine
- Required env: **none.** Everything degrades to a working local mode. See `.env.example`.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 · DB: PostgreSQL + Drizzle (optional) · Validation: Zod (`zod/v4`)
- Contracts: Solidity 0.8.24 + Hardhat, `viaIR` enabled
- 0G: `@0gfoundation/0g-storage-ts-sdk`, ethers v6
- API codegen: Orval · Build: esbuild (API), Vite (UI)

## Where things live

- **Statistics engine** — `lib/qdsr-core/src/`. `pbo.ts` (CSCV), `dsr.ts` (Deflated Sharpe),
  `bootstrap.ts`, `normal.ts`, `prng.ts`. Depends on nothing else in the workspace.
- **API contract (source of truth)** — `lib/api-spec/openapi.yaml`. Everything in
  `lib/api-client-react/src/generated/` and `lib/api-zod/src/generated/` is produced from it.
  Edit the spec, then run codegen; never hand-edit generated files.
- **DB schema** — `lib/db/src/schema/agents.ts`
- **Contracts** — `contracts/contracts/QDSRRegistry.sol`, `AgenticID.sol`
- **Persistence boundary** — `artifacts/api-server/src/store/types.ts`
- **Design spec** — `docs/superpowers/specs/2026-08-20-qdsr-protocol-design.md`

## Architecture decisions

- **The certification rule is on chain, not in the attestor.** `submitVerdict` takes
  measurements and derives `certified` from constants in the contract. An attestor can
  be wrong about numbers; it cannot certify an agent that fails the published bar.
- **Everything external degrades to a working local equivalent.** No database → on-disk
  JSON store. No 0G Storage credentials → evidence sealed under its *real* 0G merkle
  root, kept locally. No chain credentials → anchoring fails loudly. A stranger can
  clone the repo and exercise the entire workflow with nothing configured.
- **Reproducibility replaced TEE attestation.** 0G Compute serves model inference, not
  arbitrary jobs, so the original TEE premise was not buildable. Trust now rests on
  deterministic recomputation: same bundle + seed + engine version ⇒ identical digest.
- **CSCV uses sufficient statistics.** Sharpe depends on `(Σx, Σx², n)`, which are
  additive across blocks, so each of the 12,870 splits is an `O(S·N)` aggregation
  rather than an `O(T·N)` pass. This is what makes a run take ~135 ms.
- **Verdicts are append-only.** A failure is never overwritten. `hasFailedVerdict`
  stays true forever.

## Product

Register an agent, submit `returns.csv` plus the full `trials.csv` search space, and
the engine returns PBO and DSR in about 135 ms. Evidence goes to 0G Storage, the
verdict to 0G Chain, and anyone can replicate the run and compare digests.

A certified agent can then be minted as an ERC-7857 Agentic ID **from the developer's
own wallet** — the server never holds a key that could mint for them. `GET
/agents/:id/mint-intent` hands over the exact arguments and states whether the
contract would accept them; the browser signs and pays. Uncertified agents revert
at the gate, and the dashboard can prove it with a read-only call.

## Gotchas

- **DSR is a probability in [0,1], not a ratio.** Render it with four decimals. A "DSR"
  above 1 means something upstream is confusing it with a Sharpe ratio.
- **The threshold is `DSR ≥ 0.95`**, not `≤ 0.05`. Inverting it certifies the worst
  strategies.
- **`trials.csv` is mandatory and the submitted series must be one of its columns.**
  Both refusals are deliberate and tested.
- Changing anything that alters a numeric output requires bumping `ENGINE_VERSION` in
  `lib/qdsr-core/src/engine.ts` — old verdicts must remain re-checkable against the
  engine that produced them.
- `Math.random()` is banned inside `lib/qdsr-core`.
- **Minting requires the verdict to be anchored on chain first.** `AgenticID.mint`
  reads `isCertified` from the registry, so a verdict that exists only in our
  database is invisible to it and the mint reverts.
- The gate probe must send non-zero `metadataURI` and `metadataHash`. The contract
  checks `EmptyMetadata` *before* certification, so zero placeholders return the
  wrong refusal reason.
- Requires **pnpm 10+**: `overrides` live in `pnpm-workspace.yaml`, which pnpm 9 ignores,
  producing `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`.
- Contracts need `viaIR: true` — `submitVerdict` exhausts the legacy stack.

## Pointers

- [`README.md`](../README.md) — what the protocol is and why
- [`DEPLOYMENT.md`](DEPLOYMENT.md) — the staged deployment runbook
- [`superpowers/specs/`](superpowers/specs/) — the original design spec
