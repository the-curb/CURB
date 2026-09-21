# ADR-002 — The receipt does not transfer

**Status:** Proposed, 12 September 2026. Not decided. Awaits the product owner and the reviewer of instruments and distribution (blueprint R03, R06).

## Context

A receipt is one whole lot (`qA` of A, `qB` of B). If movable, it would give a wallet a claim on two issuers' instruments without their access checks. The blueprint (§1, §5, §12) narrows the experiment to a receipt that cannot move.

## Decision

`transfer`, `transferFrom` and `approve` revert for every caller with `ReceiptNotTransferable`. Receipts move only by mint (to the minter) and burn on exit allocation (from the holder). No transfer allow-list; a restricted-transfer receipt would be a separate decision with its own eligibility rules. Exit is by claim, not by sale: allocate lots, claim each component to your own wallet, then hold two tokens with their own markets and rules.

## Consequences

- No secondary market and no receipt price; this site quotes none.
- An ineligible wallet ([ADR-003](ADR-003-on-chain-access.md)) cannot pass its receipt on; settlement follows ADR-003.
- "My position" is a lookup by address, not custody; integrators cannot hold and move receipts for users.
- `Transfer` still fires on mint and burn, so indexers see supply.

## What exists today

`CompanySeries.transfer`, `transferFrom` and `approve` revert unconditionally (T17 in `contracts/test/CompanySeries.t.sol`). The receipt has 0 decimals. The simulation, previews and "my position" say exit is by claim, not by sale.

## Open

- Should the operator be able to exit an ineligible holder's lot on the holder's instruction, to the holder's own address only? Or is the current design (claims need a claim permit; see ADR-003) enough?
