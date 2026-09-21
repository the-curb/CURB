# Doctrine

Each rule names the file that enforces it. A rule not enforced in `lib/` is a
lie: delete it, do not soften it.

## 1. Three states, not two

`lib/doctrine/reading.ts`

| State      | Meaning                                    | Renders as        |
| ---------- | ------------------------------------------ | ----------------- |
| `VERIFIED` | Read, current, with source and time read   | the figure        |
| `STALE`    | Read, past the freshness threshold         | the figure + age  |
| `UNREAD`   | Not read, with a reason                    | `—`, never `0`    |

`UnreadReading.value` is typed `null`: arithmetic on an absence needs an
explicit `unwrapOr` or `mustRead` to compile.

## 2. Absence is not the middle

`declareCoverage()` in `lib/doctrine/reading.ts`

Below a stated minimum of sources, a reading is `UNKNOWN` (not read), never
`NEUTRAL` (read and cancelled out).

## 3. One interval, three consequences

`lib/agents/registry.ts`, `freshnessSeconds()` / `absenceSeconds()`

Each agent declares its cadence as a **single number**. The freshness threshold
(interval + 2h grace), the absence threshold (2 × interval + grace) and the
promised cadence all derive from it. An agent with `intervalSeconds: null`
answers on request; its silence is never a failure.

## 4. Policy is code, not a prompt

`lib/doctrine/policy.ts`

Every output passes `screen()` before publication; a block is recorded as an
event with its reason. Enforced today:

- **Banned claims** (the "Batas klaim" list): share ownership, guaranteed
  redemption, 24/7 liquidity, automatic dividends, best execution, risk-free
  backing, "available to anyone", "fully backed".
- **Advice shape**: no entry, stop, target or buy/sell rating, even when asked.
- **Forecast**: no expected return, yield, multiple or direction.
- **Verdict**: never "is safe" or "is a scam"; we publish what was checked.
- **Eligibility and legal**: no eligibility determination, tax or legal
  characterisation. A wallet signature is not KYC.
- **Unsourced figure**: a narrated number not in the declared figure set, with
  a source and a timestamp, does not go out.
- **Absence rendered as value**: an `UNREAD` reading with a number beside its
  label is blocked.

## 5. The pipeline, and the heartbeat that always runs

`lib/agents/runtime.ts`

Every published line takes this route, with no way around it:

    PRODUCE → PROVENANCE → POLICY → PUBLISH → HEARTBEAT

Provenance runs **before** policy, so a figure with an empty source cannot
launder numbers past the unsourced-figure gate.

A run ends in one of six outcomes, and **every one writes a heartbeat**:

| Outcome                   | Meaning                                      |
| ------------------------- | -------------------------------------------- |
| `PUBLISHED`               | Passed every gate                            |
| `NOTHING_TO_SAY`          | Ran, no news: an outcome, not a failure      |
| `COVERAGE_BELOW_MINIMUM`  | Too few sources answered; declares unknown   |
| `PROVENANCE_INCOMPLETE`   | A figure lacked a source or a readable time  |
| `POLICY_BLOCKED`          | Breached a rule; text kept as an event       |
| `PRODUCER_FAILED`         | Crashed; error recorded, not swallowed       |

`NOTHING_TO_SAY` also stops repeats: the Bell files on a phase change, the
Pillar on a change in the book's shape, else noting with the time that it is
unchanged. Measurements are still written; the heartbeat records each
suppressed repeat (the ninety-sixth of the day).

A **dry run writes nothing at all**: no heartbeat, publication or block record.

The scheduler is triggered from outside the host (`POST /api/tick`). Registry
agents not yet wired are reported by name as `notImplemented`.

### The store answers in readings, not in empties

`lib/store/types.ts`

Every read on `Store` returns a `Reading`; a store that will not answer is
UNREAD, never `[]`.

- **The Warden refuses to report**; it never says "0 of 9 agents reporting".
- **`tick()` runs nothing it cannot judge**: it reports `undetermined`, naming
  each agent.
- **The dashboard and `/api/state` say so**: 503 with `STORE_UNREADABLE`.

### Publishing is one event, written once

`publishAtomically()` is the only supported way to publish a publication and
its heartbeat as one run. A store without transactions reports `atomic: false`,
on every publish, in the API response. On failure, `partial` names which half
landed.

### Two stores, one contract

`lib/store/fs.ts` (append-only JSONL on local disk; its `publishAtomically`
reports `atomic: false`) is for development; `lib/store/postgres.ts` is
production. Both pass `tests/store-conformance.ts`; the Postgres suite uses a
private schema, so it can never truncate the record's tables.

### Series and snapshots

- An **observation** is one series sample (a Pillar price, an Archivist
  multiplier), with the chain's raw integer beside the lossy double.
- A **snapshot** is one thing's latest state, replaced on each write. Pages
  showing "now" read snapshots, never the chain or a series.

Both are written before any gate: policy governs what is published, not what
was measured.

### Reads are batched, and the batch is not a source

Thirty-five equity feeds asked three questions each is a hundred and five calls,
a burst the public endpoint was measured partly refusing. Reads go through
Multicall3 (`lib/chain/multicall.ts`): one `eth_call`, one block, a success flag
per call. A failed subcall is that feed's absence, not the batch's. Its code
hash is a tripwire, like every other address here.

## 6. Code computes, the model narrates

Volatility, trend strength, range position and session state come from declared
formulas in code; the model writes the sentence, never the number. Trend
strength is normalised on the dispersion of the residuals, not a raw slope.

## 7. The chain never closes; the exchange does

`lib/market/session.ts`

A price read at 03:00 on a Sunday is a memory, not a price, and is marked as
one. The session calendar is **computed, not tabulated**: holiday rules,
observance shifts, Good Friday and the three 13:00 ET early closes hold for any
year. `describePriceAge()` asks whether a number was refreshed against an open
market since it was taken.

### Two prices, two ages, one distance

`lib/market/basis.ts`, `lib/agents/producers/specialist.ts`

The oracle price (the exchange's last print) and the pool price (on chain, now)
are published with their ages and signed distance in basis points of the
reference. Nothing says whether that is wide, worth anything, or which way it
closes; over a shut weekend it is mostly not a mispricing, and the run says the
market was shut.

The reference is the Pillar's own snapshot, never a second oracle read, so an
unread feed makes an unread basis, not a zero. A ticker whose every pool is
empty goes unpriced, with the reason (one abandoned pool here reports a mid of
3.4 × 10^50).

### Declared blind spots

Published in the API response and on the page:

- Ad-hoc closures (mourning, weather, systems failure) are not rule-derivable
  and are **not** detected.
- Single-security halts are a per-symbol state, not a session state.

## 8. Networks do not fall back

`lib/chain/networks.ts`

Mainnet (4663) and testnet (46630) are separate profiles, with no address or RPC
fallback between them. Every RPC read checks `eth_chainId` against the declared
chain first.

## 9. What no agent does

- Executes an order, now or later: `AGENT_COUNTS.execute` is `0`, derived from
  the roster.
- Gives an entry, a stop or a target.
- Forecasts price, return or direction.
- Declares a token safe, backed, or a scam.
- Decides that a reader is eligible.
- Quotes a fill (an execution question); Uniswap's quoter here goes uncalled.
  Published instead: the size that moves the mid one percent against the
  liquidity in force. `lib/chain/venues.ts`, `QUOTER_NOT_USED`.

Nine of the ten agents measure; one promotes, with its disclosure appended by
code to every output.
