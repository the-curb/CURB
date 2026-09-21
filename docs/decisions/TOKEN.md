# The CURB token — one function, priced in dollars, paid in CURB

**Status:** **Decided by the product owner, 12 September 2026**: the function; the prices (the US$20.00 cumulative opening minimum, kept as credit balance); validity and cancellation; governance; the proceeds split; the order of work; the chain (Robinhood Chain). Later:

- **13 September:** a preparation clarification puts deployment before a top-up to it.
- **15 September:** the implementation proposed a residual proceeds calculation (`npm run mainnet:budget`, for planning).
- **17 September 2026:** the product owner confirmed it as a clarification, not a change. They also decided the venue (PONS v2 on Robinhood Chain, terms read from primary sources) and the pairing asset (native ETH).

No launch, spending, funding or independent review is established. Unresolved: prelaunch review funding, launchpad terms, the reviewer's view on credit expiry. §16 asks for stated conversion and credit terms. The quote has a buffer but **no enforced slippage cap, no promised minimum credit** and no fixed exchange rate.

## Why the token comes up now

The desk has no marketing budget and no way to find the ten to fifteen people the interview guide needs. A launchpad launch is a marketing step: a way to be looked at. It changes nothing the mechanism says about the token. It answers none of the [assumption register's](ASSUMPTIONS.md) questions. Budgeted in advance and in public, its proceeds can pay for an independent review and a legal read, both still open in the register.

## The function

A CURB paid to the credit desk is a prepaid unit of service, nothing else. A key is credited in dollars at CURB's rate when the payment was mined. Each call is charged in dollars. Prices, decided by the product owner on 12 September 2026:

| Service | What it is | Price |
| --- | --- | --- |
| Opening a key | Minimum paid in before a key works, cumulative across top-ups | **US$20.00 — decided** |
| Evidence versions | Every archived version of one source's record for a series | **US$0.05 per call — decided** |
| Journal by day | One UTC day's verified changes, as the Gazette prints them | **US$0.05 per call — decided** |
| Alert delivery | Each change in the desk's conditions, posted to the key's webhook | **US$0.10 per delivery — decided** |

The desk does not charge for anything the site shows today: series page, latest evidence, instrument file, previews, wallet lookups, status endpoint, Gazette. Only the history and fan-out are priced; they cost the desk to keep. The position product needs no key. Forming or claiming a position needs no CURB, ever (§16: positions never depend on a CURB price).

## The conversion, stated

**Prices are in dollars; payment is in CURB; the amount of CURB changes with the market.**

1. **Price:** a pool's reserve ratio at a block. Market cap is that price times `totalSupply()` at the same block, so *CURB for US$20 = 20 × supply ÷ market cap*. The page shows both. The guard can credit lower, never higher.
2. **Block:** a top-up is credited at the price **at the block it was mined**. The desk reads it by state (`eth_call`) while the node serves the block. Otherwise it uses the pool's last event at or before it (a pair's `Sync`, a v3 pool's `Swap`). An unswapped v3 pool uses its initial price once liquidity exists. The chain-head price at indexing applies only if the pool definitely had no price then. That is, it was created later, had no price event back to creation, or had no liquidity or an empty side. Its creation block is `priceSource.fromBlock`, read from the chain and checked by the deployment tool against the first log. A silent node is waited out, never priced around. The credit names which of the three applied.
3. **Quote:** "US$20 is *n* CURB", read and shown at a block. The price can move before the top-up; neither waiting less nor the quote's timestamp bounds that. No quote is held open: the contract cannot check dollars, and the desk credits only what it read. The services page adds a five per cent buffer to the bytes it prepares. It **does not promise US$20 of credit, cap slippage or enforce a minimum credit**; another top-up may be needed. Credit above the opening minimum stays as balance.
4. **No pool, no conversion.** Without a pool the chain profile can read, prices stay in dollars and no CURB amount is quoted. A rate not read from the chain is not a rate the desk states.
5. **Named source:** pool address, chain and quote asset, read from the chain once the pool exists, never from a launchpad page. No launchpad terms, curve or listing rules are assumed. A bonding-curve period before any pool has no conversion, and the page says so.

**The guard.** Whoever trades just before a block can set its price. So credit takes the lower of the block's price and the pool's lowest price in the window before it. The window is about an hour, by chain in blocks. It is read from the pool's events and the price standing when it opened, so a quiet window hides nothing. It is weighed page by page: a busy hour costs pages, not memory.

- Any sale in that hour lowers the credit, the payer's own or a stranger's. A payer who wants the block's own price waits an hour after a dip.
- It limits short spikes only. Sustained manipulation and thin liquidity remain possible; it is not a manipulation-proof oracle.
- A window over sixty-four pages, or one the node will not serve, gives no stated rate.
- The market cap shown is unguarded: a market figure, not a credit term.

Address, decimals and supply come from the chain once the token exists. No supply, allocation or vesting is proposed: the mechanism sees no basis yet, and a launch creates none.

**The treasury exists:** the operator's 2-of-3 Safe at `0x4E69723F9Ba9fA2C9842d77b240b2C0F601ac219`, created on Robinhood Chain on 13 September 2026 ([the operator policy](OPERATIONS.md), `contracts/evidence/safes/safe.4663.json`). Every top-up goes to it; the desk's record will name it as `treasury`. No token exists yet.

## Credit validity and cancellation

- A credit is prepaid service: not a deposit, an investment, or a claim on revenue, treasury or anything else.
- No refund in dollars or CURB. The contract has no refund path; the desk offers none informally.
- Credits do not expire while their service is offered.
- A service can close on thirty days' notice, on the services page and in the journal; others keep accepting credits. If every paid service closes, remaining credits are void when the notice ends, announced beforehand.
- A price can change on thirty days' notice. Credited top-ups keep their dollar value.
- A key is its creator's secret; the desk stores only its hash. A lost key is a lost balance, like a lost private key. No recovery is promised.
- A top-up read but not yet credited (waiting for a rate, or in line) shows on the balance page with why it waits.

## Governance, if ever

Only proposals on research priorities: which issuer to file next, which candidate to verify. A vote never changes a holder's balance, takes claim reserves or replaces a series' components. It never declares an issuer safe because many tokens said so (§16). No vote is proposed for the launch; a launch is not a governance promise.

## Why CURB, and not a dollar

Asked and answered by the product owner on 20 September 2026. The desk could take a dollar stablecoin; USDG exists on the chain. It takes CURB because a launch pays for this work: review, legal read, infrastructure and a logged reserve, split as under *Proceeds*. A pool also gives a public rate read at a block. A holder is owed nothing for holding CURB: no share of fees, buyback, vote, place in line or discount. It is the prepaid credit and the funding, nothing else. Whoever finds that not worth it can still read the desk; it does not charge for what the site shows.

**The venue, for what it is.** PONS v2 (decided 17 September 2026) is a bonding-curve launchpad. It was chosen because it is on Robinhood Chain and its terms are readable from the verified contract. At block 67,311,913 (`contracts/evidence/pons/preflight.4663.67311913.json`):

- launch fee 0.0005 ETH; curve fee 1%;
- a 99% tax on buys in the first three seconds;
- graduation into a Uniswap v4 pool at 4.2 ETH raised;
- a one-week rescue delay.

Its first holders will be curve traders after a price, not credit. That changes nothing about credits or call prices; the desk reads only the pool the curve graduates into. The mismatch is stated so it is not discovered.

## What the token does not do

The desk refuses the same eight claims for the token as for the position. CURB:

- can lose what was paid for it;
- can be frozen by whoever controls its chain;
- is not equivalent to holding anything, and not automatically lower-risk;
- may not be sellable at any reference value;
- earns no extra return;
- does not make one issuer independent of another;
- claims no novelty.

Also:

- It is not a condition of forming, holding or claiming a position.
- It is no claim on series components, the treasury, fees or revenue. No fee sharing, buyback or burn is proposed.
- It covers no loss for any series, holder or issuer failure.
- Its price says nothing about the position product. A series' value comes from its components (§8), the token's from its market; the site never adds them.
- It gives the desk no admin key. The credit desk contract has no owner, pause or upgrade, and holds no balance.

## Proceeds

If a launch raises anything, the budget is published in the journal before the launch, in this order, with receipts after:

| Use | Share of net proceeds | What it buys |
| --- | --- | --- |
| Independent review and audit of `CompanySeries` and `CreditDesk` | first US$40,000, then 40% | The register's A2, the plan's first condition |
| Legal read on the position product and on the token's function | next US$15,000, then 20% | The register's A3, the plan's second condition |
| Infrastructure and data | 20% | RPC, store, hosting; costs published |
| Reserve, unallocated | 20% | Held by the operator multisig; spent only under the operator policy, logged |

Shares are of net proceeds after the launchpad's take, which is unknown and not assumed. No proceeds go to a founder allocation. Any launchpad token allocation to the creator is stated the day it exists, with its on-chain vesting.

**Execution calculation** — proposed 15 September 2026. The product owner confirmed it on 17 September 2026 as the reading of the split: a clarification, not a change, so no notice period starts.

- First US$40,000 to review, next US$15,000 to legal, then 40%/20%/20%/20% of the remainder only.
- Review, legal and infrastructure round down to cents; the remainder goes to reserve.
- `npm run mainnet:budget` does this without floating-point arithmetic, from the priorities and percentages decided on 12 September, so each cent is allocated once.
- A different split changes a decided term: thirty days' notice.
- At low proceeds infrastructure is unfunded. It needs a separate identified budget before service commitments.

Only spendable, separately documented treasury receipts count. Trading volume, market capitalization, bonding-curve reserves and locked pool liquidity are no funds available to The Curb. Credit top-ups are tracked separately against service obligations.

**PONS v2 terms**, read on 17 September 2026 from the operator's documents, the verified contracts and the chain, not assumed (the register's A12). Recorded in [the PONS v2 facts read on 16–17 September](../mainnet/EXTERNAL-FACTS-2026-09-17-PONS-V2.md):

- The 1% trading fee applies on the curve and, through the venue's hook, on the pool. 30% goes to the venue, 70% to the creator's fee recipient: the operator's Safe.
- That fee is the only proceeds a launch yields to The Curb. The whole supply is minted to the curve (no creator allocation). The 4.2 ETH that graduates it is locked in the pool with the tokens it seeds.
- Creator tax is zero and buybacks are off, as decided above.
- Token allocation/vesting and launchpad charges must be disclosed from reviewed terms before a sale, then matched against chain evidence.

Default planning input: zero available proceeds, unmeasured operating costs.

## The order of work

1. **The services and the gate exist first:** paid endpoints, key store, top-up indexer, price reader, tested on a local chain with a mock token and pool. Done in this repository. Production shows `NOT_CONFIGURED` until token, desk and pool are configured from the chain.
2. **The credit desk contract is reviewed** with the series contract. Forty lines: it moves CURB to the published treasury and emits the key hash and amount, nothing else. Tests: `contracts/test/CreditDesk.t.sol`.
3. **Resolve funding and the launch decision.** Before a sale, record the prelaunch review/terms funding source, reviewed launchpad mechanics and the approved budget. Later launch proceeds are not an existing source of payment for step 2's review. **No funding source or launch approval is recorded by this document.**
4. **After an authorized launch, record the actual token** with `contracts/scripts/record-token.ts`, review fields left empty. Check it against reviewed terms and behaviour; verify the recorded Robinhood Chain Safe as treasury. A transfer test needs its own authorization and is not a top-up to an undeployed desk.
5. **Deploy and verify the CreditDesk** from the reviewed record with `contracts/scripts/deploy-credit-desk.ts`, when authorized. Set `CURB_CREDITS`, publish explorer verification, and get a fresh tick matching runtime code and both immutables. A configured pool is not evidence until its identity, liquidity, quote assumptions and current rate are readable. No public top-up is invited while readiness is held.
6. **Record the pool and test a small top-up** to the operator's own key, from a funded wallet other than the treasury. One transfer proves only itself, not that a mutable token can never levy a fee, rebase, pause or change.
7. **Decide public top-up invitations and the paid beta separately**, with the price and cancellation notice visible. The desk has no pause or refund path; removing an invitation cannot prevent direct transfers.
8. **The interviews run** with whoever arrives, under the [interview guide](INTERVIEWS.md), with the same scoring and comprehension test. A token holder is not a better interviewee and is never offered an allocation for choosing the product. Recruiting and preparation can start before launch. Findings are never inferred from token-holder counts.

Steps 4–7 run as rows 3–15 of [the launch checklist](LAUNCH.md#the-rows), with each check and refusal.

## What exists today

- `contracts/src/CreditDesk.sol`, its fifteen tests and recorded build (`contracts/evidence/CreditDesk.build.json`); the deployment tool and its example record (refused by design).
- `lib/credits/`: price list, rate reader, key store, top-up indexer, paid-endpoint gate (admitted first, charged only when there is an answer), webhook subscriptions (public addresses only, checked when posting), code verification, receipts.
- `/services` and `/api/credits`. Receipts (taken in, as credited, by count and amount) are derived from the keys' rows on every request.
- Conditions on `/api/state`: no rate, STALE; top-ups waiting for a rate, NOTE; code or treasury not the record's, DARK.
- The local-chain rehearsal, deployment tool included.

No token, no pool, nothing configured in production. Every rate-dependent figure on the services page says so.

## Decided, and what stays open

Decided by the product owner on 12 September 2026, in this order: the US$20.00 opening minimum; the per-unit prices (*the function*); then validity and cancellation, the governance line, the proceeds split with review first, and the order of work. The figures are in `lib/credits/prices.ts` and on the services page. Any change now changes a decided term: thirty days' notice. What stays open is under *the chain*.

## The chain

**Decided — the product owner, 12 September 2026: the token launches on Robinhood Chain** (chain id 4663), the desk's own.

- Profile `robinhood-mainnet` in `lib/chain/networks.ts`; no new profile is needed.
- RPC `rpc.mainnet.chain.robinhood.com`, overridable by `CURB_RPC_URL`; explorer `robinhoodchain.blockscout.com`.
- The position's candidate components are on Ethereum; token and position never meet. The mechanism's §1 line holds: a launch proves nothing about the components' availability on any network.

Measured on the public node, 12 September 2026 (`contracts/evidence/robinhood-launch-probes.json`):

| Measured | Figure | Consequence |
| --- | --- | --- |
| Block time | 0.103 s (10,000 blocks in 1,028 s) | Fifteen minutes ≈ 9,000 blocks. `MAX_BLOCKS_PER_SYNC` 100,000 (about three hours) covers a missed tick: at most fifty top-ups priced per run, then ten waiting ones retried. Guard window: 35,000 blocks, about an hour |
| State the node serves | about 6,200 blocks behind the head — ten and a half minutes | Most top-ups are older when indexed: priced from pool events, not `eth_call` |
| Log range the node serves | any width, the whole chain included, if few logs match; a query matching more than 10,000 logs is refused with "logs matched by query exceeds limit of 10000" | Last pool event before a block found in the first window; a refused query is halved until answered |
| Dollar assets and feeds the desk already knows there | USDG (Global Dollar, 6 decimals, from the chain's official contracts page); Chainlink ETH / USD and USDG / USD feeds in the desk's feed directory | Pool: CURB / ETH (the venue's native-ETH launch config, decided 17 September 2026), priced by the ETH / USD feed. Alternative was CURB / USDG, quoted as dollars. Which pool exists is read from the chain |

**A condition on the token, checked before the desk is trusted:** exact-amount ERC-20 transfers, no transfer fees, no rebasing.

- The desk refuses unless the treasury balance rose by exactly the amount (`DeltaWrong`).
- Review source, admin powers and documented mechanics.
- The small top-up after deployment tests one path and amount. Neither a static getter nor one success establishes all future behaviour.
- `record-token.ts` records a proxy, owner or pause flag where readable, and marks a proxied token as changeable under its admin.
- Unresolved transfer, rebase and authority risks must be dispositioned before public top-up invitations.

Still open:

- **Prelaunch review funding and launchpad verification.** Actual funding is unrecorded (D02). PONS v2 graduates into a Uniswap **v4** pool.
  The price reader reads those since 17 September 2026 (`uniswap-v4-pool`). It names the pool by its key inside the PoolManager and reads state through the StateView, history from the manager's events by id. The guard works as for v3.
  It was built to [the specification of that day](../mainnet/V4-READER-SPEC-2026-09-17.md) and tested against a stand-in node (`tests/credits.test.ts`, two live pool ids reproduced from their keys).
  The first read of a real v4 pool is the deployment tool's dry run, row 12. During the curve there is no conversion (rule 5).
  **The pairing asset — decided by the product owner, 17 September 2026: native ETH** (launch config 0). The graduated pool is CURB / ETH, quoted through the Chainlink ETH / USD feed already known here (`0x78F3…d3A9`): `chainlink-feed`, never `usd-stable`.
- **A reviewer's view on credit expiry.** The independent review may call open-ended credits a liability the desk should not carry. An expiry would then change a decided term: thirty days' notice, with credits already held keeping their dollar value until then.

Before the launch transaction, the product owner still decides three things:

- counsel's reading of the venue's Terms of Use §11 (no capital raise, revenue participation or investment interest) and §3 (UK and EU users excluded from its interface) against this token's function;
- who signs the launch: the Safe, or the deployer with the Safe as fee recipient;
- whether to launch on a venue whose own documents say it is unaudited.
