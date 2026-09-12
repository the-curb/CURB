# ADR-004 — Stops are per operation and per component, and they stop; they do not move

**Status:** Proposed, 12 September 2026. Not decided. Awaits the engineering lead and an independent reviewer (blueprint R06); the policy for using them is in [OPERATIONS.md](OPERATIONS.md).

## Context

The reason a two-issuer position exists is that one issuer can fail while the other does not. The series must therefore be able to stop exactly the thing that is failing and nothing else, and no stop may become a way to change who is owed what. The blueprint (§11) proposes a stop on minting and a stop on claims of one component at a time, and says the second adds dependence on the operator.

## Decision

- The operator may **pause minting** (`setMintPaused(true, reason)`) and resume it. A paused series still records exit allocations and still pays claims.
- The operator may **pause claims of A** or **claims of B**, separately (`setClaimPaused(component, paused, reason)`). Pausing A does not pause B. The blueprint's default is that B is *not* paused because A has a problem.
- Every stop and every resume is a transaction with an event carrying a reason string, so the record shows who stopped what, when, and why.
- **No stop moves anything.** There is no function that transfers backing, rewrites a claim, sweeps a surplus, changes a component, or pays a claim to an address other than its holder — paused or not.
- Two stops are **automatic and not the operator's**: a mint that would leave the series short of what it owes reverts (`BackingShort`), and a claim of a component the series is short of reverts for everyone (`ShortfallHaltsPayment`) until the shortfall is gone — the fastest claimant does not take the remainder.

## Consequences

- A holder's claim on a paused component waits; their claim on the other component pays. The drill on the series page shows both.
- The operator can delay withdrawal of one component. That authority is real and is shown in the series document; the policy limits when it may be used (exploit risk, insufficient bookkeeping, a defined access obligation) and requires a second review to resume.
- A shortfall halts payment of that component for every holder, including honest ones, until it is resolved. The alternative — pay first-come until the pool is empty — was rejected because it turns a bookkeeping problem into a race.

## What exists today

`mintPaused`, `claimPausedA`, `claimPausedB`, the setters with events, `BackingShort`, `ShortfallHaltsPayment`; tests T05, T06, T09, T10 and the operator-limit cases; the drill's "issuer freezes A" and "series short of A" scenarios. No signers, so no operator exists yet.

## Open

- Whether a resume should require a time delay on chain (today: a policy requirement only).
- Whether a permanent "closed to new mints" state should be distinct from a pause (see [ADR-001](ADR-001-immutable-series.md)).
