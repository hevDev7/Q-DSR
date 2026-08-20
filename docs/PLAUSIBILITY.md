# Intake plausibility — is this a trading record at all?

**Date:** 2026-08-20

The certification engine answers "is this edge real or overfit". It assumed its
input was a trading return series. A user can break that assumption two ways —
by mistake (uploading the wrong file, or the right data in the wrong unit) or
deliberately (fabricating a series, or forging the declared search space). This
layer checks that an upload is *shaped* like a daily trading record before the
engine measures it.

## How it was designed

An adversarial sweep ran **49 wrong, irrelevant, or fabricated CSV uploads**
through the bare engine. **25 were certified** — a spreadsheet of row counters
(annualised Sharpe 28), raw stock prices (Sharpe 130), sales figures (Sharpe
160), a constant-drift fabrication (Sharpe 244), and — most damaging — a real
series with its search space forged from **60 identical columns**, which
certified an unproven edge at a believable Sharpe of 1.07.

Every threshold below is placed outside the documented range of a genuine daily
record, so an honest strategy (Sharpe ~0.5–4, some losing periods, low serial
correlation) passes every hard check untouched. Verified: the demo's genuine
sample certifies clean, the overfit sample is measured and returns
`insignificant`, neither raises a warning.

## The checks

Hard rejects (422, with an actionable message):

| Check | Rejects when | Catches |
|---|---|---|
| Search-space forgery | a trials column duplicates or scales another (standardised \|ρ\| ≥ 0.9999), or is constant | the live hole — copies erase both the DSR deflation and PBO |
| Flat series | per-period sd < 1e-6 | constant/degenerate uploads |
| Wrong scale (mean) | \|mean\| > 0.02 per period | price levels, balances, counts — with a percent/bps/level hint |
| Wrong scale (tail) | p95(\|return\|) > 0.5 | percent-scaled (×100) and bps (×10000) misformats, with the divisor named |
| No losses | zero negative periods over ≥252 rows | equity curves, cumulative series |
| Running level | lag-1 autocorrelation > 0.90 | prices/equity fed as returns |
| Padding | fewer than 126 active (non-zero) periods | a few weeks of edge padded with zeros to clear the 252 floor |
| Degenerate | ≤ 5 distinct values over ≥252 rows | square waves, Likert scores, two-point payoffs |
| Sharpe ceiling | annualised Sharpe > 10 | the widest backstop — no daily CSV-journal record reaches 10 |

Warnings (accepted, surfaced beside the verdict — never a rejection):

annualised Sharpe 5–10 · \|lag-1 autocorrelation\| > 0.40 · fewer than 10% losing
periods · more than 30% zero periods · \|skew\| > 4 · kurtosis > 30 · hit-rate > 90%.

These are warn-only because a genuine short-vol or option-selling strategy
legitimately runs heavy negative skew, high kurtosis, and 85–95% hit-rates.
Rejecting them would burn real users; a caption lets a human judge.

## What it does not prove

It proves an upload is *shaped* like a trading journal — plausible magnitudes,
both-signed values, a non-degenerate and genuinely distinct search space, a
Sharpe inside physical reality. It does **not** prove the trades happened.

A determined forger can still synthesise a series with realistic moments, a
plausible Sharpe (~3), and distinct decoy columns; the sweep's
`optimised-to-target-sharpe` attack does exactly this and passes every shape
check by construction. Closing that gap needs provenance from **outside** the
CSV — broker attestations, signed fills, or returns derived from the agent's own
on-chain wallet — not statistics. That is the honest boundary of this layer, and
it is where on-chain trading history (roadmap) would take over.

## Reproducibility

The engine's numeric identity is unchanged. For any bundle that still produces a
verdict, `(sharpe, dsr, pbo, sr₀)` are byte-identical to before this layer —
every check either rejects an input or adds an advisory warning, and warnings do
not feed the digest. `ENGINE_VERSION` stays `qdsr-core/1.0.0` because the number
that matters — what a verifier reproduces — did not move.
