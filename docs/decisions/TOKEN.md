# The CURB token — one function, priced in dollars, paid in CURB

**Status:** Proposed, 12 September 2026, with the prices decided: **the opening minimum of US$20.00 and the per-unit prices below were decided by the product owner on 12 September 2026.** The validity and cancellation terms, the governance line, the proceeds split and the order of work remain proposed and await the product owner. The mechanism's §16 says the only sensible function to test for CURB is payment for data and integration services that actually exist, with stated prices, a stated conversion, slippage limits, credit validity and a cancellation policy. This record proposes each of those, and the order in which they happen: the services and the gate first, the token after.

## Why the token comes up now

The desk has no marketing budget and no way to find the ten to fifteen people the interview guide needs. A public launch of the token on a launchpad is a way to be looked at. That is the reason, and it is stated as such: the launch is a marketing step. It does not change what the mechanism says about the token, and it does not make any of the [assumption register's](ASSUMPTIONS.md) questions answered. What it can do is pay for two things the register keeps open — an independent review and a legal read — if the proceeds are budgeted for them in advance and in public.

## The function

A CURB paid to the credit desk is a prepaid unit of service. Nothing else. The services it buys exist today and are listed with a price in dollars; a key is credited in dollars at the rate CURB traded at when the payment was mined, and each call is charged in dollars from the key.

| Service | What it is | Price |
| --- | --- | --- |
| Opening a key | The minimum paid in before a key can be used, cumulative across top-ups | **US$20.00 — decided**, the product owner, 12 September 2026 |
| Evidence versions | Every archived version of one source's record — the identities, the dates, the parsed record of each — for a series | **US$0.05 per call — decided**, the product owner, 12 September 2026 |
| Journal by day | The product's verified changes on one UTC day, as the Gazette prints them | **US$0.05 per call — decided**, the product owner, 12 September 2026 |
| Alert delivery | The desk's conditions — raised, cleared, still active — posted to a webhook the key registered, once per change | **US$0.10 per delivery — decided**, the product owner, 12 September 2026 |

Everything the site shows today stays free: the series page, the latest evidence, the instrument file, the previews, the wallet lookups, the status endpoint, the Gazette. The paid endpoints are the ones that cost the desk something to keep — the history, the fan-out — and the price is for that. A key is not a condition of using the position product; forming or claiming a position needs no CURB and never will (§16: positions never depend on a CURB price).

## The conversion, stated

**Prices are in dollars; payment is in CURB; the amount of CURB changes with the market.** The rule:

1. The desk reads CURB's price from a pool the site can read on chain: the ratio of the pool's reserves, at a block. Market capitalisation is that price times the token's `totalSupply()`, read at the same block. The two are the same fact in two units, so *CURB for US$20 = 20 × supply ÷ market cap*, and the page shows both.
2. A top-up is credited at the price read **at the block the top-up was mined**. Where the node no longer serves that block by the time the desk indexes it, the price at the head of the chain when it was indexed is used instead, and the record says which basis was used. The desk indexes every fifteen minutes, so that difference is bounded by fifteen minutes of market movement.
3. A quote — "US$20 is *n* CURB" — is read at a block and shown with it. Between the quote and the top-up the price moves; that movement is the payer's slippage, and it is bounded only by how long they wait. The desk does not hold a quote open, because the contract cannot check a dollar figure and the desk will not credit a figure it did not read.
4. No pool the site can read means no conversion. Until the token trades in a pool the desk's chain profile can read, the price list stays in dollars and no CURB amount is quoted. The desk will not type a price in by hand: a rate that was not read from the chain is not a rate the desk states.
5. The price source is named on the page — pool address, chain, quote asset — the day it exists, from the chain, not from a launchpad's page. A launchpad's terms, curve or listing rules are not assumed here; if the token trades on a bonding curve before a pool exists, that is a period with no conversion, and it is said so.

The token itself is read the same way: address, decimals and supply from the chain, once it exists. Nothing about supply, allocation or vesting is proposed here, because the mechanism says there is no basis for it yet, and a launch does not create one.

## Credit validity and cancellation

- A credit is a prepaid unit of service. It is not a deposit, not an investment, not a claim on the desk's revenue, treasury or anything else, and it is not refundable in dollars or in CURB: the contract has no refund path and the desk offers none informally.
- Credits do not expire while the service they can buy is offered.
- The desk may close a service with thirty days' notice on the services page and in the journal; the remaining services keep accepting credits. If every paid service closes, the remaining credits are void at the end of the notice period, and that is said before it happens, not after.
- The desk may change a price with thirty days' notice; a top-up already credited keeps its dollar value.
- A key is a secret held by whoever created it. The desk stores only its hash; a lost key is a lost balance, exactly as with a lost private key, and no recovery is promised.

## Governance, if ever

Proposals on research priorities — which issuer to file next, which candidate to verify — and nothing else. A vote never changes a holder's balance, takes claim reserves, replaces a series' components, or declares an issuer safe because many tokens said so (§16). No vote is proposed for the launch; this line is here so no one reads a launch as a governance promise.

## What the token does not do

The eight claims the desk refuses for the position it refuses for the token. CURB is not capital protected, can be frozen by whoever controls the chain it lives on, is not the same as holding anything, is not automatically safer, is not always sellable at any reference value, does not earn more, does not make issuers independent, and is not first of its kind. In addition:

- It is not a condition of forming, holding or claiming a position.
- It is not a claim on the components any series holds, on the treasury, on fees or on revenue. No fee sharing, no buyback and no burn is proposed.
- It is not a loss guarantor for any series, any holder or any issuer failure.
- Its price is not a fact about the position product. A series' value comes from its components (§8); the token's from its market; the site never adds the two.
- It does not give the desk an admin key over anything: the credit desk contract has no owner, no pause, no upgrade and holds no balance.

## Proceeds

If a launch raises anything, the budget is published before the launch, in this order, in the journal, with the receipts after:

| Use | Share of net proceeds | What it buys |
| --- | --- | --- |
| Independent review and audit of `CompanySeries` and `CreditDesk` | first US$40,000, then 40% | The register's A2, the plan's first condition |
| Legal read on the position product and on the token's function | next US$15,000, then 20% | The register's A3, the plan's second condition |
| Infrastructure and data | 20% | RPC, store, hosting — the desk's costs are published |
| Reserve, unallocated | 20% | Held by the operator multisig; spent only under the operator policy, logged |

Shares are of net proceeds after the launchpad's own take, which is not known here and not assumed. Nothing goes to a founder allocation from the proceeds; if the launchpad's mechanics allocate tokens to the creator, the allocation is stated on the page the day it exists, with its vesting as the chain has it.

## The order of work

1. **The services and the gate exist first.** The paid endpoints, the key store, the top-up indexer and the price reader ship, tested on a local chain with a mock token and a mock pool, before the token exists. Done in this repository; `NOT_CONFIGURED` in production until the token, the desk and the pool are configured from the chain.
2. **The credit desk contract is reviewed** with the series contract. It is forty lines; it moves CURB to the published treasury and emits the key hash and the amount, and it can do nothing else. Its tests are in `contracts/test/CreditDesk.t.sol`.
3. **The token launches.** The address, decimals and supply are read from the chain and recorded; the desk is deployed from a reviewed record by `contracts/scripts/deploy-credit-desk.ts` — which refuses an unreviewed record, the wrong chain, a token that does not answer, a treasury without code on a public chain — pointing at that address and the operator multisig as treasury; the pool is recorded when it exists; `CURB_CREDITS` (one record: network, token, desk, treasury, the block, the price source) is set from those records and nothing else. From then on every tick verifies the desk's code against the build in this repository and its two immutables against the record: a desk that runs other code or pays somewhere else is a DARK condition, and the services page says so.
4. **The interviews run** with the people who arrive, under the [interview guide](INTERVIEWS.md), with the same scoring and the same comprehension test. A holder of the token is not a better interviewee than anyone else, and is never offered an allocation for choosing the product.

## What exists today

`contracts/src/CreditDesk.sol` and its fifteen tests, its build recorded for the site to verify against (`contracts/evidence/CreditDesk.build.json`), and the deployment tool with its example record (refused by design); `lib/credits/` — the price list, the rate reader, the key store, the top-up indexer, the paid-endpoint gate (admitted first, charged only when there is an answer), the webhook subscriptions (posted only to public addresses, checked when posting), the code verification and the receipts; `/services` and `/api/credits`, where the receipts — what the desk has taken in, as credited, by count and by amount — are derived from the keys' rows on every request; the desk's conditions on `/api/state` (no rate: STALE; top-ups waiting for a rate: NOTE; code or treasury not the record's: DARK); the rehearsal on a local chain, including the deployment tool. No token exists; no pool exists; nothing is configured in production; every figure on the services page that depends on a rate says so.

## Open, for the person who decides

- ~~The prices above, and the US$20 minimum.~~ Decided — the product owner, 12 September 2026: the figures in `lib/credits/prices.ts` and on the services page. A change from here on is a change of a decided price and gets the thirty days' notice.
- Whether credits should expire, and after how long, if the reviewers say open-ended credits are a liability the desk should not carry.
- The proceeds split, and whether the review comes first even if that delays everything else — this record says it does.
- Which chain the token launches on. The desk's chain profiles are locked in code; a chain not in `lib/chain/networks.ts` is a reviewed code change before anything is read from it.
