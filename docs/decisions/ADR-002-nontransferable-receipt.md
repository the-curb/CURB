# ADR-002 — The receipt does not transfer

**Status:** Proposed, 12 September 2026. Not decided. Awaits the product owner and the reviewer of instruments and distribution (blueprint R03, R06).

## Context

A receipt is one whole lot of a series — a claim on `qA` units of A and `qB` units of B — with 0 decimals. If it could be sent to another wallet, that wallet would acquire a claim on two issuers' instruments without passing either issuer's own access requirements, and the Curb would have made a market in a thing that is not a share and not a dollar. The blueprint (§1, §5, §12) narrows the experiment to a receipt that cannot move.

## Decision

`transfer`, `transferFrom` and `approve` on the receipt revert, for every caller, with `ReceiptNotTransferable`. The only ways a receipt changes hands are mint (to the minter) and burn on exit allocation (from the holder). There is no allow-list of transfer pairs in this design; a restricted-transfer receipt would need its own eligibility rules and is a separate decision, not a toggle.

Consequences for a holder are stated where the receipt is shown: exit is by claim, not by sale; a holder who needs liquidity allocates lots for exit and claims each component to their own wallet, and then holds two tokens with their own markets and rules.

## Consequences

- No secondary market in receipts, so no price of a receipt, so nothing on this site quotes one.
- A holder whose wallet becomes ineligible (see [ADR-003](ADR-003-on-chain-access.md)) cannot hand the receipt to an eligible wallet; the settlement path is the one ADR-003 describes.
- Integrators cannot hold receipts on a user's behalf and move them later. The interface's "my position" is a lookup by address, not a custody feature.
- The `Transfer` event is still emitted on mint and burn, so indexers that expect it see the supply correctly.

## What exists today

`CompanySeries.transfer`, `transferFrom` and `approve` revert unconditionally (T17 in `contracts/test/CompanySeries.t.sol`). The receipt has 0 decimals. The site's simulation, previews and "my position" say exit is by claim, not by sale.

## Open

- Whether an ineligible holder's lot should be exitable by the operator on the holder's instruction and to the holder's own address only — a narrow settlement path — or whether the current design (claims need a claim permit; see ADR-003) is enough.
