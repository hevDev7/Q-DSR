# Pre-mainnet contract audit

**Date:** 2026-08-20
**Scope:** `contracts/contracts/` — `QDSRRegistry.sol`, `AgenticID.sol`,
`AgenticIdMetadata.sol`, `IERC7857.sol`, `IQDSROracle.sol`
**Reason:** these contracts have no proxy, no pause, and no upgrade path. Whatever
ships to mainnet is what exists forever, so the review happened before the deploy
rather than after it.

Four findings. Each was reproduced against the code as it stood, fixed, and locked
behind a regression test that fails on the old code. The tests carry the old
behaviour in their comments, so a later refactor that reintroduces one is caught
with an explanation instead of a bare assertion.

---

## 1. Markup injection through the agent name — **critical**

**Where:** `AgenticIdMetadata._svg`, via `_escape`

`_escape` implements JSON string escaping: it handles `"` and `\`. It was used for
both documents the library produces — the JSON metadata *and* the fallback SVG that
is generated when a token supplies no image.

An SVG is XML. Its metacharacters are a different set, and the agent name is
supplied by whoever mints. Minting an agent named

    </text><script>alert(1)</script><text>

produced an SVG containing a live `<script>` tag, base64'd into the `image` field of
`tokenURI`, and rendered by any wallet or explorer that displays the token.

Reproduced before the fix:

    SVG mengandung <script>: true

**Fix.** A separate `_xmlEscape` covering the five predefined XML entities, with `&`
replaced first so the ampersands introduced by the later substitutions are not
rewritten a second time. `_escape` keeps its JSON job and its documentation now says
which context it is for.

**Tests.** `AgenticID — audit regressions › markup injection through the agent name`
— three cases: the script payload, all five entities at once with the
ampersand-ordering trap, and a name with quotes and backslashes confirming the JSON
path still works. A fourth checks that control characters are dropped rather than
emitted raw, since a bare newline inside a JSON string is a parse error and an
unparseable `tokenURI` cannot be fixed on an immutable contract.

---

## 2. The oracle proof was not bound to the token — **high**

**Where:** `AgenticID.transfer`, `AgenticID.clone`

    modifier validProof(bytes calldata proof) {
        if (address(oracle) == address(0)) revert InvalidProof();
        if (!oracle.verifyProof(proof)) revert InvalidProof();
        _;
    }

The modifier asked the oracle whether a proof was *valid*. It never asked whether the
proof described *this token*. `verifyProof` decodes an agentId and answers whether
that agent is certified, so any holder could satisfy the gate on any token by passing
the id of any certified agent — including one they had nothing to do with.

The requirement read as a constraint while constraining nothing.

**Fix.** `_requireProofFor(tokenId, proof)` decodes the proof, compares it against
`_records[tokenId].agentId`, and only then consults the oracle. A proof that is not
32 bytes is rejected before `abi.decode` can misread it.

**Tests.** `the oracle proof is bound to the token` — transfer and clone each
rejected when handed a different certified agent's proof, a malformed proof rejected,
and the token's own proof still accepted so the fix does not simply close the door.

---

## 3. State written after the receiver callback — **medium**

**Where:** `AgenticID.mint`, `AgenticID.clone`

`_safeMint` was called before `_records`, `_metadata` and `tokenIdOfAgent` were
written. `_safeMint` invokes `onERC721Received` on a contract recipient, and that
callback runs while the mint is still in progress: a vault, a marketplace escrow or a
staking contract that indexed the token at that moment read an empty record, an empty
metadata struct, and a zero reverse lookup — then stored those zeros.

**Fix.** All three writes moved ahead of `_safeMint`, in both functions.

**Test.** `state is written before the receiver callback` uses
`test-support/StateProbeReceiver.sol`, a receiver that reads the token back out of
`AgenticID` from inside its own `onERC721Received`. That is the only vantage point
from which the ordering is observable, and both values it captures were zero before
the fix.

---

## 4. Unbounded loop in `hasFailedVerdict` — **medium**

**Where:** `QDSRRegistry.hasFailedVerdict`

    for (uint256 i = 0; i < history.length; i++) {
        if (!history[i].certified) return true;
    }

Verdict history is append-only with no cap — that permanence is the product. But the
query walked it, so its cost grew with every submission. An agent that kept
resubmitting could push the cost past what an on-chain caller could afford, burying
its own rejection behind a gas limit.

**Fix.** A `_everFailed` flag maintained on write. Same answer, constant cost.

**Tests.** `hasFailedVerdict does not walk the history` — gas measured after one
verdict and again after fifty, asserted equal; plus the semantics that matter: a
later pass does not erase an earlier failure, a clean agent reports false, and an
agent nobody has submitted reports false rather than reverting.

---

## Also changed

**Two-step ownership, both contracts.** Ownership moved in a single call. On an
immutable contract with no recovery path, a transfer to a mistyped or unreachable
address would strand `setAttestor` permanently — and with it the only way to rotate a
compromised attestor key. `transferOwnership` now nominates and `acceptOwnership`
claims, so the recipient proves it can transact before it becomes the only address
that can.

**`AgenticID.owner` documented as powerless.** `registry` and `oracle` are
`immutable` and nothing else is gated on `onlyOwner`, so the role cannot pause, mint,
seize or re-point anything. It is kept because marketplaces read `owner()` as the
collection-admin convention, and it now says so in the source — a role that implies
an intervention nobody can perform is worse than no role at all.

---

## What the deployment check now proves

`validate-deployment.ts` compares the deployed runtime bytecode against what this
checkout compiles, masking the immutable slots using the offsets recorded in the
build-info. Behavioural probes sample a few paths; this settles identity. When it
passes, every test in `contracts/test` describes the contract that is actually live —
including the escaping and proof-binding paths, which no probe transaction reaches.

    PASS  QDSRRegistry is the code in this checkout   3395 bytes identical
    PASS  AgenticID is the code in this checkout      15895 bytes identical, 192 immutable bytes masked

---

## Method and limits

The review used the `solidity-auditor` reference material — attack-vector catalogue
and the four-gate judging protocol (refutation, reachability, trigger, impact) — read
and applied directly rather than dispatched to its agent fleet.

This is a single-reviewer pass on a five-file surface, not a substitute for a paid
audit. What it does establish: every finding here was reproduced before being fixed,
and none of them can return silently.
