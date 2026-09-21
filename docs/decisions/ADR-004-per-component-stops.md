# ADR-004 — Stops are per operation and per component, and they stop; they do not move

**Status:** Proposed, 12 September 2026. Not decided. Awaits the engineering lead and an independent reviewer (blueprint R06). Usage policy: [OPERATIONS.md](OPERATIONS.md).

## Context

One issuer can fail while the other does not, so the series must stop only what fails. The blueprint (§11) proposes a mint stop and a per-component claim stop; the second adds dependence on the operator.

## Decision

- **Pause minting**: `setMintPaused(true, reason)`, resumable; exit allocations and claims continue.
- **Pause claims of A or of B** separately: `setClaimPaused(component, paused, reason)`. Pausing A does not pause B, and by the blueprint's default B is *not* paused because A has a problem.
- Every stop and resume emits an event with a reason.
- **No stop moves anything**: no function transfers backing, rewrites a claim, sweeps surplus, changes a component, or pays anyone but a claim's holder, paused or not.
- **Two automatic stops**, not the operator's: `BackingShort` reverts a mint that would leave the series short; `ShortfallHaltsPayment` reverts every claim of a short component until the shortfall is gone, so no fastest claimant takes the rest.

## Consequences

- A claim on a paused component waits; the other pays. The series page's drill shows both.
- The operator can really delay one component's withdrawal (shown in the series document). Policy limits it to exploit risk, insufficient bookkeeping or a defined access obligation, and a resume needs a second review.
- A shortfall halts that component for every holder, honest ones included, until resolved; first-come payment was rejected as a race.

## What exists today

`mintPaused`, `claimPausedA`, `claimPausedB`, the setters with events, `BackingShort`, `ShortfallHaltsPayment`; tests T05, T06, T09, T10 and the operator-limit cases; the drill's "issuer freezes A" and "series short of A" scenarios. The Robinhood Chain treasury signers are recorded; an operator Safe on the candidate Ethereum series chain remains unverified.

## Open

- Should a resume need an on-chain time delay? (Today: policy only.)
- Should a permanent "closed to new mints" state differ from a pause? (See [ADR-001](ADR-001-immutable-series.md).)
