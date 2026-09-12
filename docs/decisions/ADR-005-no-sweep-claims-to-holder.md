# ADR-005 — Nothing is swept, and a claim is paid only to its holder

**Status:** Proposed, 12 September 2026. Not decided. Awaits the engineering lead and an independent reviewer (blueprint R06).

## Context

Two token amounts can sit in a series contract without being owed to anyone: a surplus (someone transferred a component to the contract directly — a "donation" — or a component's balance rose on its own) and dust. Many contracts give an admin a function to take such amounts. The blueprint (§7, §11) proposes none, because a function that can take a surplus is a function that can take backing if the accounting is ever wrong, and a claim that can be paid to an address of someone's choosing is a claim that can be stolen with a key.

## Decision

- **No sweep.** There is no function that moves a component out of the series except `claimComponent`, which pays a recorded claim to its holder. Surplus stays in the contract as extra backing. Donations do not create lots, do not raise anyone's claim, and are visible in the reconciliation as `SURPLUS`, never counted as owed.
- **Claims pay the caller.** `claimComponent` pays `msg.sender` the whole of `msg.sender`'s recorded claim for that component and nothing else. There is no `to` parameter and no operator function to pay on a holder's behalf.
- **Effects before transfer, and the transfer is checked.** The claim is set to zero and the reserve reduced before the token is called; if the token reverts, returns false, or moves the wrong amount, the whole call reverts and the claim stays whole. A component that takes a fee on transfer therefore cannot be paid from the series (`TransferFailed`), which is deliberate: a fee would be paid out of other holders' backing.
- **Claims never read the other component.** A claim of A does not call B, so a broken or reentrant B cannot hold A.

## Consequences

- A mistaken transfer to the series is not recoverable by the operator. The doctrine of the site says so in the same words it uses for everything else: what was sent is sent.
- A component that changes to charge a fee on transfer stops paying from the series until the fee is gone. The claim is kept; the holder waits or the series is retired.
- Reconciliation can show `SURPLUS` indefinitely. That is a reported fact, not a balance to be "cleaned up".

## What exists today

`CompanySeries.sol` has no sweep or rescue function; `claimComponent` pays `msg.sender`, sets effects first, checks the balance delta, and is `nonReentrant`; `MockToken` switches (return-false, fee, reentrancy, halted) exercise it in T07, T08, T11, T12, T20, T22–T25 and the fuzz run. The reconciliation reports `SURPLUS` separately from `MATCHED`.

## Open

- Whether an explicit, operator-signed **retirement** of an empty series (zero lots, zero claims) should be able to forward a remaining surplus to a published address, or whether surplus simply stays. The proposal is that it stays: the case is rare and the function is the kind this record refuses.
