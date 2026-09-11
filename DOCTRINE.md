# Doctrine

The rules this system is built on. They are not aspirations — each one names the
file that enforces it. If a rule here is not enforced somewhere in `lib/`, it is a
lie and should be deleted rather than softened.

## 1. Three states, not two

`lib/doctrine/reading.ts`

Most systems have two outcomes: a value, or an error. That collapses the most
common real case — the source answered slowly, partially, or not at all — into
whichever of the two is more convenient, and convenience always picks the value.

| State      | Meaning                                              | Renders as        |
| ---------- | ---------------------------------------------------- | ----------------- |
| `VERIFIED` | Read and current, with its source and the time read  | the figure        |
| `STALE`    | Read, past the freshness threshold                   | the figure + age  |
| `UNREAD`   | Not read, with a reason                              | `—`, never `0`    |

`UnreadReading.value` is typed `null`, so arithmetic on an absence does not
compile without an explicit `unwrapOr` or `mustRead`. The mistake is made hard,
not merely forbidden.

## 2. Absence is not the middle

`declareCoverage()` in `lib/doctrine/reading.ts`

Below a stated minimum of sources, a reading is `UNKNOWN` — never `NEUTRAL`.
Neutral is a measurement: it says the signals were read and they cancelled out.
Unknown says they were not read. Publishing the first when the second is true is
the quietest way to lie with a dashboard.

## 3. One interval, three consequences

`lib/agents/registry.ts`, `freshnessSeconds()` / `absenceSeconds()`

Each agent declares its cadence as a **single number**. The freshness threshold
(interval + 2h grace), the absence threshold (2 × interval + grace), and the
cadence the site promises are all derived from it. Choosing those three separately
is how they drift apart.

An agent with `intervalSeconds: null` is answered on request and is never counted
as a failure for staying quiet.

## 4. Policy is code, not a prompt

`lib/doctrine/policy.ts`

A prompt is a request; this is a check. Every candidate output passes `screen()`
before publication. A blocked output is an event with a recorded reason, not a
silence.

Enforced today:

- **Banned claims** — the "Batas klaim" list: no share ownership, no guaranteed
  redemption, no 24/7 liquidity, no automatic dividends, no best execution, no
  risk-free backing, no "available to anyone", no "fully backed".
- **Advice shape** — no entry, stop, target, or buy/sell rating. Even when asked.
- **Forecast** — no expected return, yield, multiple, or direction.
- **Verdict** — never "is safe", never "is a scam". We publish what was checked.
- **Eligibility and legal** — no eligibility determination, no tax or legal
  characterisation. A wallet signature is not KYC.
- **Unsourced figure** — every number in the narration must appear in the declared
  figure set with a source and a timestamp. A figure that cannot carry those does
  not go out. Checked before publication, not asserted afterwards.
- **Absence rendered as value** — if a reading is `UNREAD` and the text puts a
  number beside its label, the output is blocked. This is the specific bug the
  whole system exists to prevent.

## 5. The pipeline, and the heartbeat that always runs

`lib/agents/runtime.ts`

Every published line travels the same route, and there is no way around it:

    PRODUCE → PROVENANCE → POLICY → PUBLISH → HEARTBEAT

Provenance runs **before** policy on purpose. Policy's unsourced-figure gate reads
the declared figure set to decide which numbers the narration may contain — so the
set has to be validated first, or a figure carrying an empty source would launder
every number that matched it.

A run ends in exactly one of six outcomes, and **every one of them writes a
heartbeat**:

| Outcome                   | Meaning                                        |
| ------------------------- | ---------------------------------------------- |
| `PUBLISHED`               | Passed every gate                              |
| `NOTHING_TO_SAY`          | Ran, had no news. An outcome, not a failure    |
| `COVERAGE_BELOW_MINIMUM`  | Too few sources answered. Declares unknown     |
| `PROVENANCE_INCOMPLETE`   | A figure carried no source or no readable time |
| `POLICY_BLOCKED`          | Breached a rule; the text is kept as an event  |
| `PRODUCER_FAILED`         | Crashed; the error is recorded, not swallowed  |

An agent that fails quietly must not look identical to one that had nothing to
say. That is the whole reason the heartbeat is unconditional.

A **dry run writes nothing at all** — no heartbeat, no publication, no block
record. A rehearsal that moves the state you use to judge production is not a
rehearsal.

The scheduler is triggered from outside the hosting platform (`POST /api/tick`).
A platform cron that has silently degraded is indistinguishable from an agent with
nothing to say, which is the one confusion this system exists to remove. Agents
described in the registry but not yet wired are reported by name as
`notImplemented` rather than blending in with the quiet ones.

### The store answers in readings, not in empties

`lib/store/types.ts`

Every read on `Store` returns a `Reading`. This is the doctrine applied to the
system's own record: a store that will not answer comes back UNREAD, because an
outage that returns `[]` reads exactly like a system where no agent has ever run,
and nothing downstream can tell the two apart.

The consequences are load-bearing, not cosmetic:

- **The Warden refuses to report.** An unreadable heartbeat log publishes nothing
  rather than "0 of 9 agents reporting", which would be the loudest possible
  version of the quiet lie.
- **`tick()` runs nothing it cannot judge.** Due-ness is derived from the last
  run, so an unreadable store means the question has no answer. Running blind can
  publish twice; assuming not-due can silence an agent forever while the
  dashboard looks fine. It reports `undetermined` and names each agent.
- **The dashboard and `/api/state` say so.** The endpoint answers 503 with
  `STORE_UNREADABLE` instead of serving an empty roster.

### Publishing is one event, written once

`publishAtomically()` is the only supported way to publish. A publication and its
heartbeat describe the same run: a publication with no heartbeat went out without
being recorded, and a heartbeat pointing at a publication that was never written
describes something that does not exist.

A store that cannot offer a transaction reports `atomic: false` rather than
implying a guarantee it does not have — and `lib/store/fs.ts` reports exactly
that on every publish, in the API response, where it is visible rather than
buried in a comment. On failure, `partial` names which of the two landed, which
is the state an operator has to repair.

### The store is still not production-ready

`lib/store/fs.ts` is an append-only JSONL log on local disk, and its limits are
properties of the medium: no durable disk on serverless, one file per instance,
no transaction, and observation values that round-trip through a lossy double
(`ObservationRecord` documents which fields are the record of record). It must be
reimplemented against a database before deploy. The interface exists so that swap
touches nothing above it.

## 6. Code computes, the model narrates

Volatility, trend strength, range position and session state are computed by
declared formulas in code. The model is used for the sentence, never for the
number. Trend strength is normalised on the dispersion of the residuals rather
than reported as a raw slope: two series that rise by the same amount, one clean
and one jagged, have the same slope and very different reliability.

## 7. The chain never closes; the exchange does

`lib/market/session.ts`

This is the claim the project is actually about. A price read at 03:00 on a Sunday
is not a price, it is a memory, and a venue that prints it without saying so has
told you something false without stating a single wrong number.

The session calendar is **computed, not tabulated** — a hardcoded holiday table is
correct on the day it is written and rots silently. Holiday rules, observance
shifts, Good Friday and the three 13:00 ET early closes are all derived, so they
hold for any year.

`describePriceAge()` answers the question that matters: not "how old is this
number" but "has this number been refreshed against an open market since it was
taken".

### Declared blind spots

Published in the API response and on the page, not buried here:

- Ad-hoc closures — mourning, weather, systems failure — are not rule-derivable
  and are **not** detected.
- Single-security halts are a per-symbol state, not a session state.

## 8. Networks do not fall back

`lib/chain/networks.ts`

Mainnet (4663) and testnet (46630) are separate profiles with no address fallback
and no RPC fallback between them. A testnet address that silently answers a
mainnet question is the kind of bug that only appears in production.

Every RPC read confirms `eth_chainId` against the declared chain before anything
downstream trusts the answer.

## 9. What no agent does

- Executes an order. Not now, not later. `AGENT_COUNTS.execute` is `0` and is
  derived from the roster, so it cannot disagree with it.
- Gives an entry, a stop or a target.
- Forecasts price, return or direction.
- Declares a token safe, backed, or a scam.
- Decides that a reader is eligible.

Eight of the nine agents measure and one promotes — and the promoter's disclosure
is appended by code, on every output, not by its own good manners.
