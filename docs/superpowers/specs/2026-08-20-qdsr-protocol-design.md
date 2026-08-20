# Q-DSR Protocol — Design Spec

**Date:** 2026-08-20
**Target:** 0G Bridge Buildathon (AKINDO) — Wave 3 submission, deadline ~2026-08-30
**Status:** approved to build; mainnet deploy deferred to the end

---

## 1. Thesis

Most published backtests are overfit. A strategy tuned across hundreds of parameter
configurations will produce an impressive Sharpe ratio on noise alone. Q-DSR makes an
AI trading agent prove statistical significance **before** it is allowed to mint an
Agentic ID (ERC-7857) on 0G.

The claim we certify is narrow and falsifiable:

> Given this evidence bundle, this seed, and this pinned engine version, anyone can
> recompute PBO and DSR and obtain byte-identical numbers.

## 2. What changed from the original idea, and why

### 2.1 0G Compute TEE is out of scope

The original plan ran the Monte Carlo bootstrap "inside a 0G Compute TEE". Verified
against the docs: 0G Compute serves **LLM inference** (live), **fine-tuning** (live),
and **training** (not yet released). Its TEE attests *which model executed an
inference request*. There is no documented path for submitting an arbitrary compute
job. The premise is not buildable as written.

**Replacement mechanism: reproducibility, not hardware attestation.**

| | Original | This design |
|---|---|---|
| Basis of trust | TEE attestation | Deterministic recomputation |
| Verifier action | Check TEE signature | Re-run engine, compare hashes |
| Buildable in 10 days | No | Yes |

Evidence bundle and bootstrap matrix are pushed to 0G Storage (merkle `rootHash`).
The root, the verdict, and the metrics are anchored on 0G Chain. A third party
downloads the artifacts with `withProof: true`, re-runs the pinned engine with the
recorded seed, and must reproduce the exact metrics. A dishonest verdict is
detectable by anyone, permanently.

TEE remains on the roadmap for Wave 4/5 and is documented as such. **We do not claim
TEE in the Wave 3 submission.**

### 2.2 The DSR threshold in the original plan is inverted

The plan said "fail if DSR ≤ 0.05". DSR is a **probability in [0,1]** that the true
Sharpe ratio exceeds zero after deflating for selection bias and non-normality.
`DSR ≤ 0.05` would certify only the *worst* strategies.

**Corrected convention:** certified when `DSR ≥ 0.95` (equivalently p ≤ 0.05).

### 2.3 The existing mockup displays DSR as a ratio

Seed data shows DSR values like `3.61`, `2.94`, `4.08`. Those are not probabilities.
The UI is corrected to render DSR as a probability (4 decimal places).

## 3. Certification rule

An agent is **Certified** when all hold:

| Gate | Threshold | Source |
|---|---|---|
| Deflated Sharpe Ratio | `DSR ≥ 0.95` | Bailey & López de Prado (2014) |
| Probability of Backtest Overfitting | `PBO ≤ 0.10` | Bailey, Borwein, López de Prado, Zhu (2014) |
| Minimum observations | `T ≥ 252` | one trading year |
| Minimum declared trials | `N ≥ 2` | DSR is undefined for a single trial |

Otherwise the verdict is **Statistically Insignificant** and is written on-chain
permanently. There is no delete path — that permanence is the product.

## 4. Mathematics

All formulas operate on **per-period** (not annualized) returns. Annualization is a
display concern only.

### 4.1 Deflated Sharpe Ratio

```
DSR = Z[ (SR̂ − SR₀)·√(T−1) / √(1 − γ₃·SR̂ + ((γ₄−1)/4)·SR̂²) ]
```

- `SR̂` — observed Sharpe of the selected strategy
- `T` — number of observations
- `γ₃` — skewness of returns
- `γ₄` — kurtosis, non-excess (normal = 3)
- `Z` — standard normal CDF

Expected maximum Sharpe under the null, across `N` trials:

```
SR₀ = √(V[SR̂ₙ]) · [ (1−γ)·Z⁻¹(1 − 1/N) + γ·Z⁻¹(1 − 1/(N·e)) ]
```

- `γ = 0.5772156649015329` — **Euler–Mascheroni constant**
- `V[SR̂ₙ]` — variance of Sharpe ratios across the N trials
- `Z⁻¹` — probit (inverse normal CDF)

### 4.2 PBO via CSCV

Combinatorially Symmetric Cross-Validation over the trials matrix `M ∈ R^(T×N)`:

1. Partition the `T` rows into `S` disjoint contiguous submatrices (default `S = 16`).
2. Enumerate all `C(S, S/2)` splits — `C(16,8) = 12,870` combinations.
3. For each split `c`: in-sample half `J`, out-of-sample half `J̄`.
   - `n* = argmaxₙ Sharpe(J, n)`
   - `rank` of `n*` among the `N` out-of-sample Sharpes on `J̄`
   - `ω_c = rank / (N+1)`, `λ_c = ln(ω_c / (1 − ω_c))`
4. `PBO = |{c : λ_c ≤ 0}| / C(S, S/2)`

**Performance note.** A naive implementation is `C(S,S/2) × N × T/2` operations. Sharpe
depends only on `(Σx, Σx², n)`, and those are additive over submatrices. Precomputing
per-`(submatrix, strategy)` partial sums reduces each split to `O(S/2 × N)`:

```
12,870 × 16 × N   instead of   12,870 × N × T/2
```

For `N = 100, T = 1000` that is ~20M operations instead of ~640M — sub-second instead
of a minute. This is what makes the run feel live in the UI.

### 4.3 Block bootstrap

Circular block bootstrap over the selected strategy's return series, preserving
autocorrelation. Default block size `⌈T^(1/3)⌉`, default `10,000` resamples. Produces
the empirical Sharpe distribution and confidence interval. The full resample matrix is
the artifact pushed to 0G Storage.

### 4.4 Determinism

Non-negotiable, because reproducibility *is* the trust model.

- Seeded PRNG (xorshift128+). `Math.random()` is banned in `@workspace/qdsr-core`.
- Fixed iteration order; no `Set`/`Map` ordering dependence; no parallelism in the
  numeric path.
- Engine version string embedded in every result and in the on-chain record.
- Same `(bundle, seed, version)` ⇒ identical `(sharpe, pbo, dsr, sr0)` bit-for-bit.

## 5. Architecture

```
lib/
  qdsr-core/        NEW  pure statistics engine — no I/O, no chain, no network
  og-storage/       NEW  0G Storage client wrapper (mockable)
  og-chain/         NEW  contract ABIs + typed client
  db/               MOD  schema: agents, submissions, runs, results, anchors, audit
  api-zod/          MOD  regenerated from the extended OpenAPI spec
  api-client-react/ MOD  regenerated hooks
contracts/          NEW  Hardhat project
  QDSRRegistry.sol       verdict registry + IOracle implementation
  AgenticID.sol          ERC-7857 reference impl, mint gated by the registry
artifacts/
  api-server/       MOD  evidence upload, run orchestration, anchoring
  qdsr-verification/MOD  UI wired to real data
```

**Dependency direction is one-way:** `qdsr-core` depends on nothing in the workspace.
It is a library you could publish standalone, and it is the piece a judge can verify
without running anything else.

### 5.1 Module contracts

| Module | Does | Depends on |
|---|---|---|
| `qdsr-core` | `verify(bundle, opts) → Result` | nothing |
| `og-storage` | `upload(bytes) → {rootHash, txHash}`, `download(rootHash, withProof)` | 0G SDK, wallet |
| `og-chain` | `submitVerdict()`, `isCertified()`, `mint()` | ethers, RPC, wallet |
| `api-server` | HTTP + job queue + persistence | all of the above |
| UI | render + poll | `api-client-react` |

`og-storage` and `og-chain` are behind interfaces with in-memory fakes, so the whole
workflow is testable end-to-end **without** credentials or a deployed contract. That
is what makes "everything ready, deploy last" possible.

## 6. Evidence bundle format

The original mockup promised parquet. Dropped — CSV/JSON is shippable and readable by
judges.

```
evidence/
├── manifest.json     strategy name, params, periodsPerYear, engineVersion, seed
├── returns.csv       timestamp,return   — selected strategy, net of fees
└── trials.csv        T × N matrix — every configuration tried during optimization
```

`trials.csv` is mandatory. PBO is meaningless without the full search space, and a
submission that omits it is rejected at validation — that refusal is itself a feature
worth demoing.

## 7. On-chain design

### 7.1 `QDSRRegistry.sol`

```solidity
struct Verdict {
    bytes32 evidenceRoot;   // 0G Storage merkle root
    uint32  pboBps;         // PBO   in basis points (0..10000)
    uint32  dsrBps;         // DSR   in basis points (0..10000)
    uint32  trials;         // N
    uint32  observations;   // T
    uint64  certifiedAt;
    address attestor;
    bool    certified;
}

mapping(bytes32 => Verdict) public verdicts;      // key: agentHash
function submitVerdict(bytes32 agentHash, Verdict calldata v) external onlyAttestor;
function isCertified(bytes32 agentHash) external view returns (bool);
function verifyProof(bytes calldata proof) external view returns (bool);  // IOracle
```

`verifyProof` implements the `IOracle` interface that the ERC-7857 reference
implementation already expects. Q-DSR plugs into the standard's own extension point
rather than working around it.

### 7.2 `AgenticID.sol`

ERC-7857 reference implementation with one change — the mint gate:

```solidity
function mint(address to, string calldata encryptedURI, bytes32 metadataHash)
    external returns (uint256)
{
    require(registry.isCertified(metadataHash), "QDSR: agent not certified");
    ...
}
```

Uncertified agents cannot mint. Their failed verdict stays queryable forever.

## 8. Data flow

```
upload bundle → validate → run engine (deterministic)
    → verdict + bootstrap matrix
    → 0G Storage  (rootHash)
    → 0G Chain    (submitVerdict)
    → mint allowed / blocked
    → third party: download withProof → re-run → compare
```

## 9. Error handling

| Failure | Response |
|---|---|
| Malformed / missing `trials.csv` | 422 with the specific missing column |
| `T < 252` or `N < 2` | 422, refuse to run — a wrong number is worse than none |
| Engine throws mid-run | run marked `failed`, error persisted, no partial verdict |
| 0G Storage unreachable | verdict persists locally, `anchorStatus = pending`, retryable |
| Chain tx reverts | same — anchoring is a separate retryable step, never blocks the verdict |

Anchoring is deliberately decoupled from verification. A failed upload must never
destroy a completed run.

## 10. Testing

- **`qdsr-core`** — the only module with hard correctness requirements.
  - Known-answer tests for normal CDF / probit against published values
  - DSR reproduces the worked example in Bailey & López de Prado (2014)
  - PBO = ~0.5 for pure-noise trials matrices (the null case)
  - PBO → low for a genuinely persistent signal
  - Determinism: same seed ⇒ identical output across 100 runs
- **contracts** — Hardhat tests: uncertified mint reverts, certified mint succeeds,
  non-attestor cannot write a verdict.
- **api-server** — end-to-end with the in-memory storage/chain fakes.

## 11. Build order (de-risked)

Ordered so that the hard Wave 3 gate is cleared early and the droppable work is last.

| Phase | Work | Droppable |
|---|---|---|
| 1 | `qdsr-core` + tests | no — this is the differentiator |
| 2 | contracts + Hardhat tests, testnet deploy | no — hard gate |
| 3 | db schema + api-server + job queue | no |
| 4 | UI wiring, fix the 3 dead buttons, DSR display | no |
| 5 | 0G Storage integration | **yes** — degrade to local hashing |
| 6 | README, architecture diagram, demo video, X post | no |
| 7 | **mainnet deploy** | blocked until user says go |

## 12. Out of scope for Wave 3

- 0G Compute TEE execution (roadmap Wave 4/5)
- Encrypted metadata / sealed-key transfer beyond the ERC-7857 reference behaviour
- Multi-user auth — single operator workspace
- Parquet ingestion
- Real DAO review voting; the reviewer role is display-only
