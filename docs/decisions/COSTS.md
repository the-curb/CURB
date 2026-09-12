# Cost of a position against the baseline — measured inputs, proposed method

**Status:** Proposed, 12 September 2026. Not decided. Awaits product and finance (blueprint B01). What is measured is measured on a fork of Ethereum with both real components and is dated by its block; what is not measured is left as a variable, and no dollar figure here is a price or a quote. The revenue side is the mechanism's §16 and is not repeated: a fee-free pilot, and no fee logic in the contract before demand is shown.

## The baseline

The baseline the blueprint asks the product to beat is the two tokens in a wallet: a holder who already has wAAPLx and AAPLon and simply keeps them. Against that, a Curb position costs whatever it costs to form and to unwind, in gas and in the issuers' own fees, and gives in return one receipt with a recorded composition, per-component exit rights, and the evidence beneath it.

## Measured: execution gas, both components real

From `contracts/evidence/apple-s1.fork.json` (see the series page for the block). Execution gas by `gasleft()` deltas inside one call with warm storage; a real transaction pays cold storage access, the 21,000 base and its calldata on top, so these are lower bounds for a first-time interaction and closer to true for a repeat one.

| Operation | Gas (execution, warm) | Who pays | Baseline equivalent |
| --- | ---: | --- | --- |
| Transfer of the wrapper (holding A directly) | 13,587 | the holder | this is the baseline for moving A |
| Transfer of AAPLon (holding B directly) | 68,533 | the holder | this is the baseline for moving B |
| Approve A, approve B | not measured here (a standard ERC-20 approval each, ~46,000 cold) | the holder, once per series | none |
| Mint 3 lots (both deposits, the receipt) | 168,789 | the holder | none: the baseline forms nothing |
| Allocate 3 lots for exit (no token moves) | 90,695 | the holder | none |
| Claim A (the real wrapper moves out) | 62,080 | the holder | a transfer of A, 13,587 |
| Claim B (real AAPLon moves out) | 65,104 | the holder | a transfer of B, 68,533 |

So a full round trip — approve twice, mint, allocate, claim twice — costs on the order of **480,000 gas** of execution for three lots against roughly **82,000** to move the two tokens once each. Per lot the mint and the exit are the same size whatever the lot count; the claims scale with nothing but the token's own transfer cost.

## The method, with the variables left as variables

Cost in money = Σ (gas per operation) × (gas price at the time) × (price of ETH at the time), plus the issuers' own fees where an issuer is used:

- **Gas price and ETH price** are not read by this desk for Ethereum and are not applied. The desk's price feeds are Robinhood Chain's. When a pilot exists, both are read at the time and dated like every other figure; until then the table stays in gas.
- **Issuer fees** are not part of forming or unwinding a Curb position, because the series moves tokens only. They apply when a holder goes further: xStocks documents up to 0.50% on issuance and redemption and a $5,000 minimum through the issuer; Ondo documents a $1 minimum and settlement in USDon with a USDC swapper. Those are the holder's costs of *leaving the tokens*, the same with or without the Curb.
- **The Curb's own fee** is zero in the pilot ([the operator policy](OPERATIONS.md) has no fee lever, and the contract has no fee logic).

An illustration, labelled as such and not a price: at a gas price of 1 gwei and ETH at $3,000, 480,000 gas is about $1.44; at 30 gwei it is about $43. The number that matters is the holder's own, at their own time.

## What the comparison cannot yet say

- Whether the position's benefit — one receipt, recorded rights, per-component exit — is worth a round trip's gas to anyone. That is R04 and B02: interviews and comprehension tests, not measurement.
- What the wrapper's size does to the baseline: at the block read, the current wrapper held about ten raw tokens in all, so a lot of ten wrapper shares would be the whole wrapper and the market offer for it is a question the fork cannot answer.
- Anything about volume, AUM or revenue. The mechanism's §16 says why those are kept apart.

## What exists today

The gas table is written by `npm run test:fork` in `contracts/` and shown on the series page; the formula above is not implemented anywhere, on purpose, until there is a dated gas price to put in it.
