# ADR-005 — Nothing is swept, and a claim is paid only to its holder

**Status:** Proposed, 12 September 2026. Not decided. Awaits the engineering lead and an independent reviewer (blueprint R06).

## Context

A series can hold amounts owed to no one: dust and surplus (a direct "donation", or a balance that rose on its own). The blueprint (§7, §11) proposes no admin function to take them, since it could take backing if the accounting were wrong.

## Decision

- **No sweep.** Only `claimComponent` moves a component out, paying a recorded claim to its holder. Surplus stays as extra backing; donations create no lots, raise no claim, and show in the reconciliation as `SURPLUS`, never as owed.
- **Claims pay the caller**: `msg.sender` gets its whole recorded claim for that component, nothing else. No `to` parameter; no operator function pays for a holder.
- **Effects before transfer, and the transfer is checked**: claim zeroed and reserve reduced before the token call. If the token reverts, returns false or moves the wrong amount, the call reverts and the claim stays whole. So a fee-on-transfer component cannot be paid from the series (`TransferFailed`), deliberately.
- **Claims never read the other component**: a broken or reentrant B cannot hold a claim of A.

## Consequences

- The operator cannot recover a mistaken transfer: what was sent is sent.
- A component that adds a transfer fee stops paying from the series until the fee is gone; the claim is kept, and the holder waits or the series is retired.
- `SURPLUS` may show indefinitely: a reported fact, not a balance to "clean up".

## What exists today

`CompanySeries.sol` has no sweep or rescue function. `claimComponent` pays `msg.sender`, sets effects first, checks the balance delta and is `nonReentrant`. `MockToken` switches (return-false, fee, reentrancy, halted) exercise it in T07, T08, T11, T12, T20, T22–T25 and the fuzz run. The reconciliation reports `SURPLUS` separately from `MATCHED`.

## Open

- Should an operator-signed **retirement** of an empty series (zero lots, zero claims) forward leftover surplus to a published address? Proposed: no, it stays; that function is the kind this record refuses.
