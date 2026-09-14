# External facts for The Curb mainnet preparation

Read on **15 September 2026**. This is a public-source research record, not an issuer response, audit opinion, account approval, launch transaction or legal determination. Source statements, code observations and implementation recommendations are separated below. Pages and mutable repository branches can change. Recheck the exact deployment and governing terms before action.

## Result that changes the launch plan

**The best-supported match for the PONS mentioned in the project is the `ponsfamily.com` launchpad on Robinhood Chain. Its v2 launch path is not compatible with The Curb's current price reader.** The launchpad's documented launch restrictions and unfinished reviews also remain external dependencies. Public research resolves the likely product identity; it does not establish which platform/version the owner intended or grant access to it.

The code comparison is against `lib/credits/config.ts` and `lib/credits/rate.ts` as inspected on this date: only `uniswap-v2-pair` and `uniswap-v3-pool` are accepted. No launchpad, curve or v4 address has been installed in a production configuration by this research.

## PONS identity and versions

The [project repository](https://github.com/ponsdotdev/ponsfamily) identifies itself as the source for `ponsfamily.com`; its [README](https://raw.githubusercontent.com/ponsdotdev/ponsfamily/aa9ebe3c31573ef27a001f1de545cf96ed43c918/README.md) links that website and distinguishes two generations. V1 starts with a one-sided Uniswap v3 position and derives creator revenue from trading fees. V2 starts with a bonding curve and graduates into Uniswap v4. The README lists these factories:

| Version | Published factory address |
| --- | --- |
| V1 | `0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB` |
| V2 | `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` |

The GitHub commits API returned source revision `aa9ebe3c31573ef27a001f1de545cf96ed43c918`, committed `2026-09-14T19:51:57Z`. That pins the source references here; it does **not** attest that deployed bytecode matches. A search result initially showed an older v2 factory; the refreshed README agrees with the current docs. Search snippets are discovery aids, not configuration evidence.

Other similarly named sites appeared in search. They are not adopted as aliases or official launch interfaces in this record. The [application](https://www.ponsfamily.com/launchpad) is the destination linked from the documentation.

### Current documentation statements

The [v2 documentation](https://docs.ponsfamily.com/v2) states:

- Robinhood Chain, chain ID **4663**; v1 continues operating separately.
- V2 reviews by SB Security, Dingbats and Pashov are in progress, with no completed report yet. Public creation is closed; approved addresses may launch.
- Pairing assets require approval. Native ETH or an approved ERC-20 denominates both trading and creator payouts.
- Fees pass through accrual, sweeping and escrow withdrawal. An empty escrow alone does not establish zero earnings.
- The creator may redirect future fees; the protocol has a delayed recipient-change process. Internal-swap sweeps may require the protocol operator.
- An initial buy tax decays across five seconds; exemptions exist. Read actual launch terms, including creator tax and buyback setting.
- The current documented hook is `0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044`; escrow is `0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e`. Earlier launches retain their original stack.

These are documentation statements, not same-block chain verification. In particular, no `canLaunch` result for a designated Curb launcher has been obtained here.

### Source observations relevant to CURB

The [factory source](https://raw.githubusercontent.com/ponsdotdev/ponsfamily/aa9ebe3c31573ef27a001f1de545cf96ed43c918/contractsV2/src/v2/PonsV2LaunchFactory.sol) checks `canLaunch(originalDeployer)`, which permits the public gate or a whitelisted launcher. It checks launch-config enablement and pairing-asset approval. `previewLaunchEconomics` supplies a digest for `expectedEconomics`; passing zero waives the comparison. A Curb launch tool should require a nonzero, freshly reviewed digest and refuse a changed configuration. Do not copy launch configuration IDs or fees from examples.

The [token source](https://raw.githubusercontent.com/ponsdotdev/ponsfamily/aa9ebe3c31573ef27a001f1de545cf96ed43c918/contractsV2/src/v2/PonsV2LauncherToken.sol) inherits ERC-20 and ERC20Burnable, mints the initial supply to its curve, and records deployer attribution without granting that address token privileges. The inspected class exposes no subsequent mint, pause, blacklist or transfer-tax method. This is a source observation, not proof about a future CURB deployment. Holder burns mean that initial fixed issuance does not imply an eternally constant `totalSupply`.

The [curve source](https://raw.githubusercontent.com/ponsdotdev/ponsfamily/aa9ebe3c31573ef27a001f1de545cf96ed43c918/contractsV2/src/v2/PonsV2BondingCurve.sol) distinguishes real trading reserves, virtual quote reserves, accrued fees and reserved graduation tokens. `realQuoteReserve()` excludes pending base fees and creator tax; `getReserves()` includes the virtual quote reserve. Trading reserves fund the pool at graduation. Creator income comes through the fee distribution, not a withdrawal of the whole curve reserve. A constant-product formula does not make this curve a Uniswap v2 pair: its getters and events differ.

## Compatibility and practical defaults

| Venue | Current Curb result | Required implementation/evidence |
| --- | --- | --- |
| PONS v1 canonical v3 pool | Potential interface match, **not verified for a CURB token** | Actual token, pool, quote, initialization block, supported events, active liquidity, historical reads, code and fee controls |
| PONS v2 curve | **Unsupported** | Separate reviewed adapter if ever wanted; current product decision permits no conversion during the curve stage |
| PONS v2 graduated v4 pool | **Unsupported** | v4 pool identity, manager/state reads and indexed history, hook effects, liquidity and quote-feed checks |
| Separate v2/v3 pool for a v2 token | Possible architecture, **no such CURB market is recorded** | Independently funded liquidity and full reader/manipulation review; a thin auxiliary pool must not become an easy billing oracle |

The [Uniswap v4 pool-creation guide](https://developers.uniswap.org/docs/protocols/v4/guides/create-pool) defines pools through a PoolKey containing currencies, fee, tick spacing and hooks. The manager initializes the pool. Consequently, a v4 manager or hook address cannot be substituted for the per-pool address expected by Curb's v3 calls. This conclusion combines the upstream interface with the inspected local implementation.

**Recommended engineering choice:** retain the reader's refusal until one explicit launch version and a supported pricing path are tested. If PONS v2 is selected, implement and review v4 support before advertising usable CURB top-ups; preserve the no-conversion period before graduation. Do not select an older launch version solely to avoid integration work. These are implementation recommendations, not launch authorization.

**Recommended launch settings for review:** zero optional creator tax, buybacks disabled, creator-fee recipient bound to the reviewed Robinhood treasury, and no tokenized-stock quote asset for the first credit market. These choices keep the current no-buyback policy coherent and reduce unrelated quote/issuer dependencies. The actual available settings, quote asset, costs and source behavior still need verification; this document does not select a live launch config or assert that a stablecoin is currently approved.

### Funding consequence

Treat **curve volume, graduation reserves, market capitalization, unswept fees, escrow balances and treasury receipts as different measures**. The budget waterfall should apply only to eligible funds actually received and available to the project. Recognize a creator-fee claim separately until settlement; count only the applicable net proceeds after costs and required reserves. Do not budget locked pool liquidity as operating cash or assume unearned fees will fund a prereview invoice.

The actionable missing financial input is a funded prerequisite-review budget: actual payer, amount, source and timing. Public research cannot establish that commitment. Launchpad mechanics should be reflected in the launch budget before it is published.

## Candidate position issuers: what public documents settle

The position remains an **Ethereum** candidate holding current wrapped AAPLx and AAPLon. The Robinhood launch token is a separate product dependency; choosing a stock token as a launchpad quote would not integrate or approve this position.

### A — xStocks / Backed

The [AAPLx product page](https://assets.backed.fi/products/apple-xstock) names **Backed Assets (JE) Limited**, ISIN **CH1436219187**, and describes an Apple tracker certificate. It shows issuance/redemption fees up to **0.50%**, no current management fee with possible future annual fee up to **0.25%**. The page's own update label is **30 June 2025**; these are published terms to reconfirm, not a current executable acquisition quote.

The [legal overview](https://docs.xstocks.fi/docs/product-legal-overview) describes bearer debt instruments rather than direct equity ownership, individual Final Terms, and distribution obligations. It says licensed third-party distributors can offer under applicable EU/EEA documentation and that distribution requirements vary by jurisdiction. It does not provide a permission for Curb's specific receipt structure.

The [issuance/redemption guide](https://docs.xstocks.fi/docs/issuance-and-redemption) requires issuer onboarding, KYC/AML and whitelisted wallets for primary-market interactions. It documents separate market, atomic RFQ and in-kind flows. The [FAQ](https://docs.xstocks.fi/docs/frequently-asked-questions) currently states a **US$5,000** minimum for direct issuance/redemption, permits retail redemption subject to KYC, and distinguishes secondary venue access from issuer access. Therefore a small Curb pilot cannot assume direct issuer redemption is economically available for each individual lot.

The [wrapper guide](https://docs.xstocks.fi/developers/wrapped-xstocks) was retrieved through its [Markdown endpoint](https://docs.xstocks.fi/developers/wrapped-xstocks.md) after the HTML fetch timed out. It distinguishes the current live-multiplier wrapper from unwrap-only v1, warns that v1 exchange rates are donation-sensitive, and states that existing current-wrapper share balances change only on explicit deposits/redemptions. It requires an independent underlying price for valuation and warns that a vault conversion rate is an accounting value. It also instructs integrators to confirm wrapper identity, including `asset()`, rather than infer the current version from an address field alone.

**Still unresolved for A:** applicable participants/entity and jurisdictions, permission for contract custody plus nontransferable receipts, current-wrapper identity assurance, account-specific acquisition/withdrawal route and costs, and actual split behavior in the selected deployment. A documented method or API field is not a successful acquisition experiment.

### B — Ondo

The [eligibility page](https://docs.ondo.finance/ondo-stocks/eligibility) names **Ondo Global Markets (BVI) Limited** and lists prohibited persons/jurisdictions plus investor-status restrictions. Restrictions include U.S. persons and orders placed from the United States, with further issuer and beneficial-control conditions. Eligibility depends on the participant and entity; a country absent from one table is not an affirmative Curb approval.

The [investing/redemption guide](https://docs.ondo.finance/ondo-stocks/investing-and-redeeming) states a **US$1** minimum, primary settlement in **USDon**, and a USDC swapper whose immediate conversion depends on liquidity and whitelisting. It says smart contracts can hold the ERC-20 and restricts offering-document access to completed onboarding. These are distinct propositions: technical custody does not resolve participant eligibility or Curb's distribution/receipt terms.

The [secondary-market restrictions](https://docs.ondo.finance/ondo-stocks/secondary-market-restrictions) retain eligibility representations for secondary buyers, require KYC for issuer redemption, and describe circumstances where redemption may be refused. They do not promise secondary-market liquidity. This is direct evidence against treating a successful fork transfer as assured redemption access.

The [corporate-actions page](https://docs.ondo.finance/ondo-stocks/corporate-actions) says reinvested dividends affect token pricing and that trading can pause while corporate actions or off-hours information are processed. It says additional information about other corporate actions will follow. The page does not settle all split, merger, suspension or termination outcomes for the candidate pilot.

**Still unresolved for B:** named eligible operator and participants, governing documents obtained through the appropriate onboarding path, written application to the receipt/custody arrangement, real acquisition and redemption access, and deployment-specific corporate-action/admin behavior.

## Evidence to obtain next

1. **Launch integration:** verify the chosen official interface/version, factory source/runtime, actual launcher's `canLaunch`, launch config, quote approval, fee policy, economics digest, treasury recipient and completed relevant audit reports. This research makes no write calls.
2. **Oracle work:** select and test the venue adapter; require pool-specific identity and history, quote valuation, liquidity and failure behavior. A launchpad's displayed USD price does not replace this evidence.
3. **Funding:** record real prerequisite funding and approved spending authority. Track fees as unsettled until treasury receipt; exclude graduation liquidity from spendable proceeds.
4. **Issuer access:** complete separate E01–E12 records in [PREPARATION.md](PREPARATION.md) against the actual entity, cohort, chain, wrapper, contract and terms. Use only real issuer responses or qualified review naming the applicable rules.
5. **Acquisition:** after eligibility and authorization, record the permitted route, live sizes/costs and actual settlement/exit evidence. Local/fork preparation remains useful but cannot satisfy the account-access part.

No issuer was contacted, no application submitted, no terms accepted, no wallet signed and no funds moved while preparing this record. No release gate is passed by this document.
