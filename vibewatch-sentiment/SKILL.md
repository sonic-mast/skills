---
name: vibewatch-sentiment
description: "Stacks ecosystem community sentiment from the Vibewatch Stacks Vibe Index — free public index plus x402 pay-per-query depth (per-project history, evidence receipts, deltas) settled in sBTC on Stacks."
metadata:
  author: "brandonjamesmarshall"
  author-agent: "Sonic Mast"
  user-invocable: "false"
  arguments: "index | terms | reports | project | evidence | delta"
  entry: "vibewatch-sentiment/vibewatch-sentiment.ts"
  requires: "wallet"
  tags: "l2, read-only, requires-funds"
---

# vibewatch-sentiment

Community sentiment for the Stacks ecosystem, from the [Vibewatch Stacks Vibe
Index](https://stacks.vibewatch.io) — a public sentiment index over an opted-in
panel of Stacks projects (Stacks, Zest Protocol, Bitflow, Stacking DAO, AIBTC,
Hermetica, and more), computed from each project's own community channels
(Discord, Telegram, X, forums, GitHub Discussions, governance votes) and
published with k-anonymity floors and marked suppression.

Two tiers:

- **Free** (`index`, `terms`, `reports`) — everything the public page shows:
  ecosystem composite (0–10), per-project current scores, 90-day history with
  Fear & Greed overlay, weekly message/author counts, rolling themes,
  governance votes, and the weekly-report archive. No wallet, no key.
- **Paid** (`project`, `evidence`, `delta`) — depth per query over x402,
  settled on Stacks: 100 sats sBTC per query (the discovery document also
  advertises an STX price for clients that can't hold sBTC; this skill pays
  with the first asset the shared engine can sign, which is sBTC). Answers
  "what changed, why, and where's the receipt": per-project daily series, the
  public posts backing each weekly theme, and changes-since deltas for
  polling loops.

## Subcommands

### `index` (free)

```bash
bun run vibewatch-sentiment/vibewatch-sentiment.ts index
```

The full live index payload (`schema_version`, `as_of`, `index`, `panel`,
`source_mix_7d`, `distribution_7d`, `history`, `projects[]`, `panel_joins`,
`panel_joins_truncated`, `governance`, `summary`, `suppressed[]`, plus the
skill's own `network` and `endpoint`). Each `projects[]` entry carries the
project's `slug` and `name`.

### `terms` (free)

```bash
bun run vibewatch-sentiment/vibewatch-sentiment.ts terms
```

The x402 discovery document (`/.well-known/x402.json`): current price,
accepted assets, `payTo`, and every paid resource. When the paid tier is
disabled the document truthfully serves empty `accepts` — check this before
the first paid call.

### `reports` (free)

```bash
bun run vibewatch-sentiment/vibewatch-sentiment.ts reports
```

The Stacks Vibe Weekly archive: one line per completed report with its
`week_start` (the `--week` value for `evidence`), title, week composite, and
week-over-week change.

### `project` (paid)

```bash
bun run vibewatch-sentiment/vibewatch-sentiment.ts project --project "Zest Protocol" --days 30
```

One panel project's daily composite series (≤90 days) plus its current score
and week-over-week change. `--project` accepts the project's name or slug;
the skill resolves it against the free index before paying (live slugs carry
a suffix, e.g. `zest-protocol-3672`, so you never have to know it). An
unknown or ambiguous project fails before any payment and lists the panel.
`latest` is null when the project's newest score is older than the index's
7-day recency floor — an old number is never presented as current.

### `evidence` (paid)

```bash
bun run vibewatch-sentiment/vibewatch-sentiment.ts evidence --week 2026-08-24
```

Receipts behind one weekly report's themes: links to the public posts backing
each theme, with attributed excerpts for X posts. `--week` is a `week_start`
from `reports`; the skill checks it against the archive before paying, so a
week with no completed report fails free. Themes whose evidence is all in-server return `receipts: []`
marked `no_public_evidence` — private community content is never exposed.

### `delta` (paid)

```bash
bun run vibewatch-sentiment/vibewatch-sentiment.ts delta --since 2026-09-01T00:00:00Z
```

What changed since a timestamp (hour-bucketed): per-project score moves with
constant-panel baselines, ecosystem composite then/now, current themes, and
reports published since. Defaults to the last 24 hours; `--since` older than
90 days is clamped.

## Payment

Standard x402 flow via the shared payment engine: the first request answers
402 with payment terms, the wallet signs, the retry carries the payment, and
the response includes a `payment_receipt` with the on-chain txid. One run,
one payment. Running the same command again is a new query and a new
payment — there is no free re-read window across runs. (The server does hold
a 10-minute idempotency window keyed on the *signed payment itself*, which the
engine uses internally if the retry that carries a payment has to be resent;
that never costs a second payment.)

## Networks

`--network mainnet` (default) pays real sBTC on the live index. `--network testnet`
targets the staging index, which advertises the canonical testnet sBTC
(`SN3VMHXEN64ZZF71JQ5VESXDWTR301XTTXGF4J8F1.sbtc-token`); the shared engine
currently pins a different testnet sBTC id (aibtcdev/skills#419), so paid
testnet calls fail at the asset check until that lands. Free subcommands work
on both.

## Reference

- Index: https://stacks.vibewatch.io
- Methodology: https://stacks.vibewatch.io/methodology
- Discovery: https://stacks.vibewatch.io/.well-known/x402.json
- Weekly reports: https://stacks.vibewatch.io/reports
- x402scan listing: https://scan.stacksx402.com/resources/6c71357a-b7f8-466e-a7e8-0e5babd8039d
- Report a problem: https://github.com/Vibewatch-io/vibewatch-mcp/issues
