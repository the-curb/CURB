# Cost of a position against the baseline — measured inputs, proposed method

**Status:** Proposed, 12 September 2026. Not decided. Awaits product and finance (blueprint B01). Measured on an Ethereum fork with both real components, dated by block; the rest stays a variable. No dollar figure here is a price or a quote. Revenue: the mechanism's §16 — a pilot with no fee, no fee logic in the contract before demand is shown.

## The baseline

Two tokens in a wallet: a holder keeps wAAPLx and AAPLon. A Curb position adds gas and issuer fees to form and unwind, for one receipt with a recorded composition, per-component exit rights and evidence.

## Measured: execution gas, both components real

13 September 2026 mainnet-preparation run of `contracts/evidence/apple-s1.fork.json`, schema 2, Ethereum block **25,967,875**, two-step-operator CompanySeries source. Raw output: `contracts/evidence/mainnet-prep-apple-components-fork.txt`. Release record: `docs/reviews/MAINNET-PREPARATION-2026-09-13.md`. Prior first-release record: `contracts/evidence/history/apple-s1.fork.before-two-step-operator-2026-09-13.json`.

`gasleft()` deltas inside calls, touched storage warm; no base gas, calldata or cold access; not a full-transaction or dollar quote. Production configuration and later source changes need new measurement.

| Operation | Gas (execution, warm) | Who pays | Baseline equivalent |
| --- | ---: | --- | --- |
| Transfer of the wrapper (holding A directly) | 43,882 | the holder | baseline for moving A |
| Transfer of AAPLon (holding B directly) | 66,578 | the holder | baseline for moving B |
| Approve A, approve B | not measured; measure actual tokens and allowance | the holder, if allowance is short | none for holding |
| Mint 3 lots (both deposits, the receipt) | 170,806 | the holder | none: forms nothing |
| Allocate 3 lots for exit (no token moves) | 90,740 | the holder | none |
| Claim A (the real wrapper moves out) | 62,081 | the holder | a transfer of A, 43,882 |
| Claim B (real AAPLon moves out) | 65,102 | the holder | a transfer of B, 66,578 |

Mint, allocate and two claims (three lots): **388,729 execution gas**. The two direct transfers: **110,460 execution gas**. Both omit approvals and overhead, so neither is a transaction budget, a full acquisition-to-exit journey or a round trip. Keeping two tokens adds no transaction. Remeasure for production quantities and current token state.

## The method, with the variables left as variables

Cost in money = Σ (gas per operation) × (gas price at the time) × (price of ETH at the time), plus the issuers' own fees where an issuer is used:

- **Gas and ETH price**: not read or applied (the desk's feeds are Robinhood Chain's); a pilot reads and dates both. Until then, gas only.
- **Acquisition and issuer-route fees**: need a dated quote for the actual eligible route; obtaining, wrapping, trading or redeeming can cost extra. Recheck historical issuer terms in the instrument file for the chosen account, route, size and date. No current fee or minimum assumed.
- **The Curb's own fee**: zero in the pilot ([the operator policy](OPERATIONS.md) has no fee lever; the contract no fee logic).

Arithmetic illustration only: **if** gas were 1 gwei and ETH US$3,000, the 388,729-gas subtotal would be US$1.166187; at 30 gwei, US$34.98561. Invented inputs, missing costs excluded; not a quote or a production budget.

## What the comparison cannot yet say

- Whether the receipt, recorded rights and per-component exit are worth a round trip's gas to anyone (R04, B02; not measurement).
- Whether enough wrapper shares can be acquired or newly issued. At the recorded block: about 10.16 raw tokens in the wrapper, about 10.13 wrapper shares; ten shares would use almost all, but past inventory is not an issuance ceiling. This fork has not shown current-wrapper deposit/mint access, limits, rounding or raw-token acquisition.
- Volume, AUM or revenue (the mechanism's §16).

## What exists today

`npm run test:fork` in `contracts/` writes the gas inputs shown on the series page. This table is a dated manual copy of that run; after a new one, update its evidence reference and all rows together. The [mainnet dossier](../mainnet/PREPARATION.md#economics-and-proceeds) has a complete-cost worksheet that invents no operating costs.
