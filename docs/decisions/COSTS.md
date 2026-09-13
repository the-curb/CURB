# Cost of a position against the baseline — measured inputs, proposed method

**Status:** Proposed, 12 September 2026. Not decided. Awaits product and finance (blueprint B01). What is measured is measured on a fork of Ethereum with both real components and is dated by its block; what is not measured is left as a variable, and no dollar figure here is a price or a quote. The revenue side is the mechanism's §16 and is not repeated: a fee-free pilot, and no fee logic in the contract before demand is shown.

## The baseline

The baseline the blueprint asks the product to beat is the two tokens in a wallet: a holder who already has wAAPLx and AAPLon and simply keeps them. Against that, a Curb position costs whatever it costs to form and to unwind, in gas and in the issuers' own fees, and gives in return one receipt with a recorded composition, per-component exit rights, and the evidence beneath it.

## Measured: execution gas, both components real

From the 13 September 2026 mainnet-preparation run of `contracts/evidence/apple-s1.fork.json`, schema 2, Ethereum block **25,967,875**, with the two-step-operator CompanySeries source. Raw test output: `contracts/evidence/mainnet-prep-apple-components-fork.txt`; release record: `docs/reviews/MAINNET-PREPARATION-2026-09-13.md`. The prior first-release record is preserved in `contracts/evidence/history/apple-s1.fork.before-two-step-operator-2026-09-13.json`. Execution gas is measured by `gasleft()` deltas inside calls with already-touched storage warm. Separate transactions have base gas, calldata and cold-access costs that this measurement does not include. No full-transaction or dollar-price quote is established here; production configuration and any later source change require their own measurement.

| Operation | Gas (execution, warm) | Who pays | Baseline equivalent |
| --- | ---: | --- | --- |
| Transfer of the wrapper (holding A directly) | 43,882 | the holder | this is the baseline for moving A |
| Transfer of AAPLon (holding B directly) | 66,578 | the holder | this is the baseline for moving B |
| Approve A, approve B | not measured here; measure the actual tokens and allowance state | the holder, when allowance is insufficient | none for simply holding |
| Mint 3 lots (both deposits, the receipt) | 170,806 | the holder | none: the baseline forms nothing |
| Allocate 3 lots for exit (no token moves) | 90,740 | the holder | none |
| Claim A (the real wrapper moves out) | 62,081 | the holder | a transfer of A, 43,882 |
| Claim B (real AAPLon moves out) | 65,102 | the holder | a transfer of B, 66,578 |

The measured subtotal for mint, allocate and two claims is **388,729 execution gas** for the three-lot scenario. The two direct-transfer observations sum to **110,460 execution gas**. Approvals and transaction overhead are missing from both an actual transaction-budget comparison and any complete acquisition-to-exit journey; simply retaining two tokens has no new transaction cost. Do not describe this subtotal as the cost of a full round trip. Gas must be remeasured for the selected production quantities and current token state.

## The method, with the variables left as variables

Cost in money = Σ (gas per operation) × (gas price at the time) × (price of ETH at the time), plus the issuers' own fees where an issuer is used:

- **Gas price and ETH price** are not read by this desk for Ethereum and are not applied. The desk's price feeds are Robinhood Chain's. When a pilot exists, both are read at the time and dated like every other figure; until then the table stays in gas.
- **Acquisition and issuer-route fees** need a dated quote for the actual eligible route. Forming and claiming the series moves tokens; obtaining those tokens, wrapping, trading or redeeming with an issuer can incur separate costs. Historical issuer terms in the instrument file must be checked again for the chosen account, route, size and date. No current fee or minimum is assumed in this calculation.
- **The Curb's own fee** is zero in the pilot ([the operator policy](OPERATIONS.md) has no fee lever, and the contract has no fee logic).

Arithmetic illustration only: **if** gas were 1 gwei and ETH were US$3,000, the measured 388,729-gas subtotal would be US$1.166187; at 30 gwei it would be US$34.98561. These are invented price inputs for demonstrating the formula, exclude the missing costs above and are not a current quote or a production budget.

## What the comparison cannot yet say

- Whether the position's benefit — one receipt, recorded rights, per-component exit — is worth a round trip's gas to anyone. That is R04 and B02: interviews and comprehension tests, not measurement.
- Whether sufficient wrapper shares can be acquired or newly issued. At the recorded block, wrapper inventory was about 10.16 raw tokens and total supply about 10.13 wrapper shares. Ten wrapper shares would use almost all that existing supply, but historical inventory is not an issuance ceiling. Current-wrapper deposit/mint access, limits, rounding and raw-token acquisition have not been demonstrated by this fork.
- Anything about volume, AUM or revenue. The mechanism's §16 says why those are kept apart.

## What exists today

`npm run test:fork` in `contracts/` writes the machine-readable gas inputs, shown on the series page. This document's table is a dated manual transcription of the run identified above; update its evidence reference and all rows together after a new measurement. The [mainnet dossier](../mainnet/PREPARATION.md#economics-and-proceeds) has a complete-cost worksheet; it does not substitute invented operating costs for measurement.
