# The CURB token — one function, priced in dollars, paid in CURB

**Status:** **Decided by the product owner, 12 September 2026** — the function, the prices (the US$20.00 cumulative opening minimum, retained as credit balance), the validity and cancellation terms, the governance line, the proceeds split and the order of work. The chain was decided the same day (Robinhood Chain; see *the chain*). The 13 September preparation clarification makes deployment precede a top-up to that deployment. On 15 September the implementation proposed a residual proceeds calculation (below) as one reading of the decided split and implemented it in `npm run mainnet:budget` for planning; no instruction from the product owner to choose it is on the record, so it is a proposal until the product owner confirms it. No launch, spending, funding or independent review is established by it. Prelaunch review funding, applicable launchpad terms and the reviewer's view on credit expiry remain unresolved. The mechanism's §16 asks for stated conversion and credit terms. The implemented quote has a buffer, **no enforced slippage cap or minimum credit guarantee**, and no fixed exchange rate.

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

1. The desk reads CURB's price from a pool the site can read on chain: the ratio of the pool's reserves, at a block. Market capitalisation is that price times the token's `totalSupply()`, read at the same block. The two are the same fact in two units, so *CURB for US$20 = 20 × supply ÷ market cap* at that block's price — the guard below can credit at a lower price, and then the same CURB buys less credit, never more than the block's own price gives — and the page shows both.
2. A top-up is credited at the price **at the block the top-up was mined**, read one of two ways: by state, an `eth_call` at that block, while the node still serves it; else from the pool's own last event at or before that block — a pair's `Sync`, a v3 pool's `Swap` — which the node serves far deeper than state. A v3 pool that has not swapped yet is priced from the price it was initialised with, once liquidity was added. Only if the pool definitely had no price at that block — it was created later (its creation block is in the record as `priceSource.fromBlock`, read from the chain, and the deployment tool checks it against the pool's first log), it had no price event at or before the block back to its creation, or it held no liquidity or an empty side there — is the price at the head of the chain when the top-up was indexed used instead; a node that did not answer is waited out, never priced around. The credit says which of the three it was. (On the chain decided below, the public node keeps about ten minutes of state and the tick reaches most top-ups later than that, so the pool's events are the usual way to a top-up's own block — measured, not assumed; see *the chain*.)
   **The guard.** A pool's price at one block can be set by whoever trades in it just before, so the price a top-up is credited at is the price at its block *or the lowest price the pool showed in the window before it — about an hour, by chain in blocks — whichever is lower*, read from the pool's own events — the events inside the window and the price that stood when it opened, so a quiet window hides nothing. A dump before a top-up lowers the credit received. The lookback limits credit from a short price spike, but sustained manipulation and thin liquidity remain possible; it is not a manipulation-proof oracle. The guard cuts both ways and is said so: anyone's sale that lowers the pool's price lowers what every top-up in the next hour is credited at, the payer's own or a stranger's — the payer who wants the block's own price waits an hour after a dip. The window is weighed page by page as the node serves it, so a busy hour costs pages, not memory; a window that takes more than sixty-four pages, or that the node will not serve, is a rate the desk does not state. The market capitalisation shown is the price at the block, unguarded, and is a figure about the market, not a term of the credit.
3. A quote — "US$20 is *n* CURB" — is read at a block and shown with it. Between the quote and the top-up the price moves; neither waiting less nor the quote's timestamp bounds that movement. The desk does not hold a quote open, because the contract cannot check a dollar figure and the desk will not credit a figure it did not read. The services page puts five per cent more than the quote into the bytes it prepares as a buffer. That buffer **does not guarantee US$20 of credit, cap slippage or enforce a minimum credit amount**; a payer may still need another top-up. Any credited amount above the opening minimum remains available as balance.
4. No pool the site can read means no conversion. Until the token trades in a pool the desk's chain profile can read, the price list stays in dollars and no CURB amount is quoted. The desk will not type a price in by hand: a rate that was not read from the chain is not a rate the desk states.
5. The price source is named on the page — pool address, chain, quote asset — the day it exists, from the chain, not from a launchpad's page. A launchpad's terms, curve or listing rules are not assumed here; if the token trades on a bonding curve before a pool exists, that is a period with no conversion, and it is said so.

The token itself is read the same way: address, decimals and supply from the chain, once it exists. Nothing about supply, allocation or vesting is proposed here, because the mechanism says there is no basis for it yet, and a launch does not create one.

**The treasury exists.** The operator's 2-of-3 Safe was created on Robinhood Chain on 13 September 2026 at `0x4E69723F9Ba9fA2C9842d77b240b2C0F601ac219` ([the operator policy](OPERATIONS.md), `contracts/evidence/safes/safe.4663.json`); it is the `treasury` the desk's record will name and every top-up will go to. No token exists yet.

## Credit validity and cancellation

- A credit is a prepaid unit of service. It is not a deposit, not an investment, not a claim on the desk's revenue, treasury or anything else, and it is not refundable in dollars or in CURB: the contract has no refund path and the desk offers none informally.
- Credits do not expire while the service they can buy is offered.
- The desk may close a service with thirty days' notice on the services page and in the journal; the remaining services keep accepting credits. If every paid service closes, the remaining credits are void at the end of the notice period, and that is said before it happens, not after.
- The desk may change a price with thirty days' notice; a top-up already credited keeps its dollar value.
- A key is a secret held by whoever created it. The desk stores only its hash; a lost key is a lost balance, exactly as with a lost private key, and no recovery is promised.
- A top-up the desk has read but not yet credited — waiting for a rate, or next in line — is shown on the balance page as read, with why it waits, so a payer can see it landed.

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

**Execution calculation proposed, 15 September 2026 — not yet confirmed by the product owner:** allocate the first US$40,000 to review and the next US$15,000 to legal. Apply 40%/20%/20%/20% only to the amount remaining after those priorities. Round review, legal and infrastructure down to cents; put the rounding remainder in reserve. `npm run mainnet:budget` implements this without floating-point arithmetic. It is offered as a reading of the priorities and percentages decided on 12 September, allocating each cent once; if the product owner reads them differently, the decided split stands and this paragraph goes — and a different split from here on is a change of a decided term, with the thirty days' notice. At low proceeds, infrastructure is unfunded and requires a separate identified budget before service commitments.

Only freely available, separately documented treasury receipts enter this calculation. Trading volume, market capitalization, bonding-curve reserves and locked pool liquidity are excluded. Credit top-ups are tracked separately against service obligations. No launchpad has been selected (the register's A12: its terms are not known and not assumed). Research on candidates is kept as research, not as a term, in [the external facts](../mainnet/EXTERNAL-FACTS-2026-09-15.md); a venue's curve reserves or fee distributions establish no funds available to The Curb. Expected token allocation/vesting and launchpad charges must be disclosed from reviewed terms before a sale, then matched against chain evidence. The default planning input is zero available proceeds and unmeasured operating costs.

## The order of work

1. **The services and the gate exist first.** The paid endpoints, the key store, the top-up indexer and the price reader ship, tested on a local chain with a mock token and a mock pool, before the token exists. Done in this repository; `NOT_CONFIGURED` in production until the token, the desk and the pool are configured from the chain.
2. **The credit desk contract is reviewed** with the series contract. It is forty lines; it moves CURB to the published treasury and emits the key hash and the amount, and it can do nothing else. Its tests are in `contracts/test/CreditDesk.t.sol`.
3. **Resolve funding and the launch decision.** Record the prelaunch review/terms funding source, reviewed launchpad mechanics and the approved budget before a sale. Review is required in step 2; proceeds from a later launch are not an existing source of payment for that prerequisite. No funding source or launch approval is recorded by this document.
4. **After an authorized launch, record the actual token.** `contracts/scripts/record-token.ts` reads address, decimals, supply and available authority facts from the chain and leaves review fields empty. Check them against reviewed terms and contract behaviour. The designated treasury is the recorded Robinhood Chain Safe; verify its current code, owners and threshold for the release. A separate test of the token's transfer behaviour can be made only when authorized, and is not a top-up to an undeployed desk.
5. **Deploy and verify the CreditDesk.** Review the exact record, run `contracts/scripts/deploy-credit-desk.ts` in dry-run mode, then deploy the reviewed build when authorized. Set `CURB_CREDITS` from the actual deployment and token/treasury record; publish explorer source verification and obtain a fresh tick matching runtime code and both immutables. A configured pool is not evidence until its identity, liquidity, quote assumptions and current rate can be read. No public top-up is invited while readiness is held.
6. **Record the pool and test a small top-up.** When a supported pool exists, record its token order, quote, creation block and rate evidence. Once the desk is deployed and verified, the operator can make an authorized top-up to their own key using a funded wallet other than the treasury. Verify transaction, treasury balance delta, index confirmation, credited dollars, an actual paid HTTP request and webhook settlement. A successful observed transfer establishes that transaction's behaviour; it does not prove that a mutable token can never levy a fee, rebase, pause or change. Keep these authority risks explicit before inviting users.
7. **Decide public top-up invitations and the paid beta separately.** Use the current code/config/rate checks and operating evidence, with the price and cancellation notice visible. The desk has no pause or refund path; removing an invitation cannot prevent direct transfers to it.
8. **The interviews run** with the people who arrive, under the [interview guide](INTERVIEWS.md), with the same scoring and the same comprehension test. A holder of the token is not a better interviewee than anyone else, and is never offered an allocation for choosing the product. Recruiting and preparing interviews can also proceed before launch; their findings are never inferred from token-holder counts.

## What exists today

`contracts/src/CreditDesk.sol` and its fifteen tests, its build recorded for the site to verify against (`contracts/evidence/CreditDesk.build.json`), and the deployment tool with its example record (refused by design); `lib/credits/` — the price list, the rate reader, the key store, the top-up indexer, the paid-endpoint gate (admitted first, charged only when there is an answer), the webhook subscriptions (posted only to public addresses, checked when posting), the code verification and the receipts; `/services` and `/api/credits`, where the receipts — what the desk has taken in, as credited, by count and by amount — are derived from the keys' rows on every request; the desk's conditions on `/api/state` (no rate: STALE; top-ups waiting for a rate: NOTE; code or treasury not the record's: DARK); the rehearsal on a local chain, including the deployment tool. No token exists; no pool exists; nothing is configured in production; every figure on the services page that depends on a rate says so.

## Decided, and what stays open

Decided by the product owner on 12 September 2026, in this order: the US$20.00 opening minimum; the per-unit prices (US$0.05 a call for evidence versions and the journal, US$0.10 an alert delivery); then the rest of the record as written — the validity and cancellation terms, the governance line, the proceeds split with the review first, and the order of work. The figures are the ones in `lib/credits/prices.ts` and on the services page. A change from here on is a change of a decided term and gets the thirty days' notice.

## The chain

**Decided — the product owner, 12 September 2026: the token launches on Robinhood Chain** (chain id 4663), the desk's own chain, read through the profile `robinhood-mainnet` in `lib/chain/networks.ts` (RPC `rpc.mainnet.chain.robinhood.com`, overridable by `CURB_RPC_URL`; explorer `robinhoodchain.blockscout.com`). No new profile is needed. The position product's candidate components live on Ethereum; the token and the position never meet, and the mechanism's §1 line holds: a launch proves nothing about the components' availability on any network.

What the desk measured on that chain's public node on 12 September 2026 (recorded in `contracts/evidence/robinhood-launch-probes.json`), and what follows from it:

| Measured | Figure | Consequence |
| --- | --- | --- |
| Block time | 0.103 s (10,000 blocks in 1,028 s) | Fifteen minutes is about 9,000 blocks; `MAX_BLOCKS_PER_SYNC` of 100,000 (about three hours) lets the indexer catch up after a missed tick, at most fifty top-ups priced per run and ten waiting ones retried after them; the guard's window of 35,000 blocks is about an hour. |
| State the node serves | about 6,200 blocks behind the head — ten and a half minutes | A top-up is usually older than that when a tick reaches it, so its own block is priced from the pool's events, not by `eth_call`. |
| Log range the node serves | any width, the whole chain included, as long as few logs match; a query matching more than 10,000 logs is refused with "logs matched by query exceeds limit of 10000" | The pool's last event before a block is found in the first window looked at; a refused query is halved until the node answers. |
| Dollar assets and feeds the desk already knows there | USDG (Global Dollar, 6 decimals, from the chain's official contracts page); Chainlink ETH / USD and USDG / USD feeds in the desk's feed directory | A CURB / USDG pool is the natural price source, with the quote taken as dollars or priced by the USDG / USD feed; a CURB / WETH pool would be priced by the ETH / USD feed. Which pool exists is read from the chain the day it does. |

**A condition on the token itself, checked before the desk is trusted:** the token must support exact-amount ERC-20 transfers without transfer fees or rebasing. The desk checks that the treasury's balance rose by exactly the amount and refuses otherwise (`DeltaWrong`). Review source, admin powers and documented mechanics; the small top-up after deployment tests one actual transfer path and amount. A static getter or one successful top-up does not establish all future behaviour. `record-token.ts` writes down what it can read — a proxy, an owner, a pause flag — and a token behind a proxy is identified as changeable under its admin. Unresolved transfer/rebase/authority risks must be dispositioned before public top-up invitations.

Still open:

- **Prelaunch review funding and launchpad verification.** The residual formula above is proposed for planning; actual funding and launch access remain unverified. No launchpad has been selected. The price reader supports Uniswap v2 pairs and v3 pools only, so a venue whose market is neither — a bonding curve, a v4 pool — gives the desk no rate, and no conversion is enabled by relabelling one as a v2/v3 pool; the dated [external facts](../mainnet/EXTERNAL-FACTS-2026-09-15.md) hold what was researched about candidates.
- **A reviewer's view on credit expiry.** If the independent review says open-ended credits are a liability the desk should not carry, an expiry is a change of a decided term: thirty days' notice, and credits already held keep their dollar value until it.
