# THE CURB — Mechanism, v1

**One company. Multiple issuers. One position.**

This is a proposed specification and a validation plan, written 12 September 2026. A CompanySeries prototype now exists and has been exercised on local chains and Ethereum forks. No public series deployment or issuer integration is approved. The Robinhood Chain treasury Safe creation is recorded separately; it does not establish an Ethereum series operator or a live credit desk. Addresses, fees, compositions, receipt symbols and pilot limits that have not been verified are not production configuration and are labelled illustrative wherever they appear. Public copy distinguishes the position prototype and simulation from the treasury mainnet record; a treasury creation does not establish a real-asset position pilot.

## 1. The decision

Implementation preparation and outstanding evidence are collected in
[the mainnet dossier](docs/mainnet/PREPARATION.md). The latest source uses a
two-step operator handover: the existing operator proposes, the nominee accepts,
and authority changes only on acceptance. This implementation remains subject to
the independent review and production gate decisions described below.

The Curb is proposed as the place to form a position on one company through several stock-token issuers, with a composition anyone can inspect and an exit that books the holder's right to every component separately.

**The recommended MVP:** one company, two issuers that pass verification, one network, a fixed composition in token units, deposits of both components in kind, and withdrawal per component. The first experiment runs on mock tokens. A pilot with real assets is considered only after the instruments, the holder's rights, the contract and the costs have been shown to hold.

The first research candidate is Apple, through the xStocks representation and the Ondo representation on Ethereum. Candidate status does not mean ready to integrate. For xStocks the unit under study is the official non-rebasing wrapper, not an assumption that raw AAPLx behaves like an ERC-20 with a static balance.

A CURB token is not required by the MVP's accounting. A position receipt and a CURB token would have different functions. A launch of CURB on a launchpad — decided for Robinhood Chain, the desk's own — is separate work and does not prove that the position's components are available on the same network; they are on Ethereum, and the two never meet.

| Decision | Initial choice | Why |
| --- | --- | --- |
| Company exposure | One company per series | Keeps the economic aim and the components comparable. |
| Number of issuers | Two, for the prototype | Tests the core mechanism with bounded room for failure. |
| Network | One EVM; Ethereum is the integration candidate | The researched pair is documented there. Actual availability is still a gate. |
| Composition | A fixed number of component units per lot | A holder's rights can be computed with no price oracle. |
| Deposit | In kind: both specified components | Avoids an early dependency on swappers, RFQ and stablecoin liquidity. |
| Withdrawal | Allocate every component, claim each separately | One failed transfer does not cancel the others. |
| Rebalancing | None in an MVP series | A price fall caused by an issuer problem does not trigger automatic buying. |
| Receipt transfer | Not available in the early experiment | Narrows scope. Restricted transfer would need its own eligibility design. |
| Upgrade | A new series; old components are never swapped | Holders see the change and choose to migrate explicitly. |
| Main token | Not a condition of using the MVP | The product's need can be tested without a speculative incentive. |

## 2. Thesis and narrative

A stock-token holder chooses a company, and in the same act accepts a particular way of getting exposure to it. Behind similar symbols sit different issuers, contracts, service providers, corporate-action rules and exits.

The Curb gives the holder a way to manage that second choice: keep the company, split the position across issuers that are disclosed plainly.

The longer form:

A view on a company can be held through several stock tokens, each carrying its own issuance structure and terms. The Curb helps a holder form one company position from several issuers. The composition can be inspected, the right to every component is recorded, and every component has its own withdrawal. When one component is obstructed, the ledger still shows what can be transferred and what remains a claim. Every position still carries the risk of the company, the issuers and the contracts used. The Curb makes that structure something a holder can choose and check.

**Testable promises:** a holder can know and prove the composition of their position; the ledger never erases a right to a component that cannot yet be transferred; mint and exit need no decision by a model.

**Claims this product does not make:** capital is protected; it cannot be frozen; it is the same as holding the share directly; it is automatically safer; it can always be sold at the reference value; it earns more; the issuers or custodians are fully independent; it is the first of its kind.

## 3. What is known, and the limits of novelty

| Finding | Design consequence | Source and limit of evidence |
| --- | --- | --- |
| AAPLx documents Apple exposure and an Ethereum/ERC-20 deployment; Ondo documents AAPLon and an Ethereum launch, and its product page publishes the deployment per network. | A reasonable pair for one underlying on one chain. | [AAPLx](https://assets.backed.fi/products/apple-xstock), [Ondo](https://ondo.finance/blog/global-markets-is-live), [AAPLon](https://app.ondo.finance/assets/aaplon). No Curb integration verified. |
| Both issuers describe instruments of economic exposure whose rights are not identical to a share. | The receipt must explain its claim on its components. | [xStocks FAQ](https://docs.xstocks.fi/docs/frequently-asked-questions), [Ondo disclaimers](https://docs.ondo.finance/legal/disclaimers). |
| xStocks balances and multipliers need their own accounting. | An MVP component must have a unit balance that is verifiably static. | [xStocks corporate actions](https://docs.xstocks.fi/docs/dividends-and-stock-splits). |
| xStocks offers a non-rebasing wrapper, distinguishes an older and a current version, and asks that address and underlying be verified. | Never choose a wrapper from a ticker or a field name. | [Wrapped xStocks](https://docs.xstocks.fi/developers/wrapped-xstocks). Its conversion prose must be matched against the contract. |
| Ondo documents that smart contracts may hold the token, with access requirements still applying. | Technical ability to hold does not settle product or holder eligibility. | [Investing and redeeming](https://docs.ondo.finance/ondo-stocks/investing-and-redeeming), [Eligibility](https://docs.ondo.finance/ondo-stocks/eligibility). |
| ERC-4626 is for one underlying token. | A two-component receipt is not marketed as standard ERC-4626. | [EIP-4626](https://eips.ethereum.org/EIPS/eip-4626). Components may use such wrappers individually. |
| Baskets of several representations of one target, and per-component withdrawal, both have precedents. | What is tested is the product package: one share, several issuers. | [mStable](https://docs.mstable.org/assets/musd), [Stax](https://www.stax-index.com/whitepaper). |

A limited search found no exact precedent for the proposition. That does not prove global novelty. No claim of patentability, of a financial principle discovered, or of a scientific finding is made.

## 4. Who it is for, and the baseline it must beat

The users worth studying first are stock-token holders who meet the access requirements and already understand their issuers, and integrators who need one position with an explicit composition. Size of funds is not evidence of need; interviews must test actual behaviour.

| User | Job to be done | Evidence of need sought |
| --- | --- | --- |
| Holder of several representations of a share | Form, record and unwind a position with a consistent composition | Has managed such a position; can show today's problems and costs. |
| Eligible allocator | Choose an initial issuer mix and check how its concentration changes | Has an allocation need that does not require weights to be maintained automatically. |
| Integrator or wallet | Display or integrate one position with clear claims | Has a specific technical need and a written integration plan. |

**The baseline is holding token A and token B in one wallet.** That already splits issuer exposure without a Curb receipt contract. Issuer diversification alone therefore does not prove the need for a receipt. The Curb has to add something measurable: consistent lot formation, an integrable ledger, fewer operational steps, or an integration that can accept one position. Acceptance as collateral, DEX listing and external wallet support are not in this blueprint.

If users like the issuer split but reject the receipt layer and its cost, test a purchase-and-bookkeeping service that leaves the position in the user's wallet. That is a change of product; do not announce success of the receipt thesis on the strength of a different service.

## 5. Product shape and terms

The product name stays **The Curb**. A position is named for its company and series, for example **Apple Position — Series 1**. The symbol `cAAPL-S1` is illustrative for the specification; it is not an issued token or a checked name.

| Term | Meaning in the Curb |
| --- | --- |
| Company / underlying | The company whose exposure the components carry. |
| Issuer | The legal entity issuing a stock-token instrument. Not an exchange, not a chain. |
| Component | The token the series contract actually holds, including a wrapper where one is used. |
| Series | A package of components, units per lot, chain and rules, fixed when made. |
| Lot / receipt | One unit of a series position; not automatically one share or one dollar. |
| Indicative value | An estimate from a dated price source. |
| Executable value | The result of a specific quote, for a specific size at a specific time. |
| Exit allocation | The receipt is burned and the right to every component is recorded as the holder's claim. |
| Component claim | Delivery of one component from the Curb to the entitled holder. |
| Unwrap | Exchange of a wrapper for the stock token it wraps. |
| Issuer redemption | Redemption through the issuer, on its terms, hours and mechanism. |

The last four are never collapsed into one label such as "withdraw to cash". The MVP ends at delivery of components. Unwrapping, selling on a market and redeeming with the issuer are different operations.

## 6. Flows and screens

**Finding a position.** The front page shows one position available for simulation or pilot: the company, two issuers, the network, the composition per lot, access status and product status. Before anything is live the primary action is **Try the simulation**. A holder can open the map of related parties — issuer, broker, custodian, contract authority, wrapper, sources — with unknown dependencies marked *not known*, never replaced by an invented safety score.

**Checking access and components.** The holder connects a wallet on the right network. Access is checked against the approved design for the pilot's regions and user categories; there is no assumption that every non-US user is eligible. In the in-kind MVP the holder must already hold the right components; if they hold raw AAPLx while the series asks for a specific wrapper, the interface explains the difference. The system never requests approval for the wrong asset and never routes anyone around a third party's restriction.

**Forming a position.** The holder chooses a number of lots. The review screen shows the exact amount of each component, an estimated value with the time of its price, the allowances, an estimated gas cost and the number of receipts. It states that the receipt cannot be sent or sold as one token; exit is by component claim. The preview has a deadline and input limits. Both deposits and the receipt issue in one atomic transaction; if either component fails to arrive, the whole mint reverts.

**Holding a position.** The position page shows receipts held, the component units they are entitled to, the current value weights, and any exit claims still open. Pending claims are never counted again as active backing. A 50:50 starting weight, if used to pick the units per lot, is indicative at one time; the market can make it 45:55. The series does not rebalance.

**Unwinding.** The holder chooses lots to exit. All component rights are allocated. After that transaction, the holder claims component A and component B separately; a batch is a convenience, the single-component function always exists. If A cannot be transferred, A stays pending with a known reason or *cause not confirmed*, and B can be tried on its own. A pending claim is promised no date and no recovery value.

| Screen | Function | Done when |
| --- | --- | --- |
| Front | Explains the position and the product's stage | Simulation / pilot / live is visible before a wallet is connected. |
| Company detail | Components, issuers, rights, units per lot | Contract identities and documents can be traced. |
| Form position | Preview, approval, mint | No receipt issues if one deposit fails. |
| My position | Active receipts and open exit claims | No value is counted twice. |
| Claim components | Allocation and individual claims | A failed A transfer is not a precondition of claiming B. |
| Evidence and status | Reconciliation, source status, changes | Old, partial and unavailable data are told apart. |

Today the front, the company detail (with the map of related parties as the issuers' documents name them), and the evidence screens exist as described; "My position" is a read-only lookup of the index by address; and for a deployed series, "Form position" and "Claim components" run with the holder's own wallet — the site prepares the approvals, the mint, the exit allocation and the claims as bytes, the wallet signs and sends each step, the receipt is read back from the chain only after the mint is mined, and the index catches up on the next tick and is shown as the index. Rehearsed end to end on a local chain; no series is deployed, so on the public site the section does not appear. The site never holds a key.

## 7. The ledger: lots with fixed components

This section is a **design**, not audited contract code. The main simplification: the MVP only accepts components whose unit balance is proven not to change on its own. Economic value per unit may change.

Each series stores exactly two distinct component addresses and the base units of each needed for one lot; those numbers never change for the life of the series. The receipt has `decimals = 0`: one unit of receipt is one whole lot, sized so a holder can still take a small enough fraction of a share. The interface explains the lot's indicative value as it moves with the market. Two distinct addresses must still be verified to come from the two intended issuers.

```text
n       = lots of receipt outstanding
q[i]    = base units of component i per lot; positive integer, immutable
A[i]    = active liability of component i        = n × q[i]
R[i]    = base units of component i allocated for exit, not yet paid
C[u,i]  = unpaid claim of holder u on component i
B[i]    = real balance of component i held by the series
L[i]    = total liability of component i        = A[i] + R[i]

R[i] = Σ C[u,i] over all holders
B[i] ≥ L[i] while the component is solvent, in token units
```

*Solvent* here means only: enough token units for the Curb's own bookkeeping. It says nothing about the issuer's share backing, a dollar value, or whether the token can be sold.

A surplus from tokens sent straight to the contract changes no `q[i]`, no receipt count and no claim. The MVP never uses a donated raw balance to price a mint. The surplus is recorded separately and has no admin sweep in this version — so a wrongly sent asset can be locked; the interface tells holders to use the deposit function. A recovery policy would need its own design and review.

### 7.1 Mint

To mint `k` lots the holder deposits exactly `k × q[i]` of every component. Check eligibility and the mint limit, record the opening balances, transfer both components, then verify the correct increase. The receipt is minted only after both deposits are valid. Fee-on-transfer tokens and transfers that do not follow the specification are not supported.

After the deposit the contract must check `B_after[i] ≥ (n + k) × q[i] + R[i]` for every component. A correct increase alone is not enough when there was already a backing shortfall. Maximum inputs and a deadline protect the holder from parameters that differ from the preview. An in-kind mint needs no NAV oracle: the composition per lot is fixed.

The pilot cap counts every liability, including pending claims: `(n + k) × q[i] + R[i] ≤ capLots × q[i]` for every component. The cap is not merely outstanding receipts, so burning and re-minting cannot hide a build-up of claim reserves. The cap limits units; their dollar value still moves. `capLots × q[i]` must be valid without overflow from deployment.

### 7.2 Exit allocation

```text
require the caller holds k lots
burn k lots of receipt
for every component i:
    C[user,i] += k × q[i]
    R[i]      += k × q[i]
```

Only the Curb's ledger changes. No external token, oracle or model is called. The fall in `A[i]` is matched by the rise in `R[i]`; total liability is unchanged. So a freeze on one component's transfers never has to stop the exit right from being recorded. There is no public `burn` or `burnFrom` that bypasses allocation of every component, and no admin mint. Supply changes only through a complete deposit or an exit allocation.

### 7.3 Claiming one component

`claimComponent(i)` pays the holder's whole claim on one component, to the claimant's own wallet only. It checks the right, the access status that applies to that recipient, the component's status, and that the balance covers the component's whole liability. The claim is marked paid before the transfer call; if the transfer fails or returns the wrong amount, the transaction reverts and the claim stays whole. Alternate recipients, transferable claims and partial claims are deferred.

Claiming A never reads or calls B. After `x` units of A are paid, `B[A]` and `R[A]` fall by `x`; nobody else's liability changes. A recipient cannot be changed by anyone but the claimant.

If a component's real balance is below its total liability, nominal payment from that component stops. This keeps the fastest holder from taking what remains before the shortfall is acknowledged. The MVP has no haircut, no automatic substitution, no sharing of recoveries. Those need a new specification; they are not improvised during an incident.

### 7.4 A worked example

The numbers are units only; no Apple price or address is used. One lot holds 10 units of A and 20 units of B. 100 lots are outstanding. Alice holds 25 lots and allocates all of them for exit.

| State | Active receipts | A active | A reserved | B active | B reserved |
| --- | ---: | ---: | ---: | ---: | ---: |
| Before Alice exits | 100 | 1,000 | 0 | 2,000 | 0 |
| After Alice's allocation | 75 | 750 | 250 | 1,500 | 500 |
| A halts; Alice claims B | 75 | 750 | 250 | 1,500 | 0 |
| Bob mints 10 lots | 85 | 850 | 250 | 1,700 | 0 |

In the last row Bob deposits 100 new A and 200 new B. He receives no part of Alice's 250 pending A; Alice keeps that claim. If A transfers are halted so that Bob cannot deposit A, his mint must fail entirely — the last row applies only once A can be deposited again. The [simulation](/positions/apple-s1) runs exactly this table, and the tests in `tests/positions.test.ts` reproduce it row by row.

### 7.5 The limit of 50:50

A fixed unit composition does not keep the value weights at 50:50. Issuer fees, multipliers, dividends, token market prices and transaction obstacles all move the relative value. Once a series exists, the Curb does not buy more of a troubled token to restore the starting ratio. A new series may choose new units per lot after evaluation; existing holders decide for themselves whether to unwind, obtain the needed components and enter it. There is no forced migration by token vote.

## 8. Corporate actions, prices, and what an exit means

Three units are kept apart: component units held by the Curb; underlying-equivalent exposure computed from documentation; estimated money value. The MVP's withdrawal rights are set in the first.

For an xStocks wrapper, the verified version and its contract method are used for display conversion and unwrap. No multiplier formula is copied from a summary, and no wrapper with a similar name is assumed to behave the same. For Ondo, the documentation describes dividend reinvestment in token pricing and display treatment that can differ across networks; that produces no separate cash dividend balance in the Curb. [Ondo corporate actions](https://docs.ondo.finance/ondo-stocks/corporate-actions).

When a corporate action happens: archive the source and its time; match the affected tokens; check the conversion change and the indicative value; stop minting if the component assumptions are unconfirmed; publish the status. A component's identity in a series is never swapped quietly on a merger, a ticker change or a product discontinuation.

Four statuses of a component stand on their own:

- It can be transferred from the Curb contract to a wallet.
- It can be unwrapped, if it is a wrapper.
- There is a market offer to sell the intended size.
- The holder is eligible and the service is available for redemption through the issuer.

A successful wrapper transfer does not prove the underlying can be cashed. A stock token that has left for a wallet still carries its issuer's risk.

For live value:

```text
indicative_receipt_value = Σ q[i] × indicative_price_per_base_unit[i]
indicative_holder_value  = holder_lots × indicative_receipt_value
```

Pending claims are shown separately. Every price has a unit, a source, an effective time and a read time. A wrapper conversion is not a market price. When one price is unavailable, the page says *total value incomplete* and shows the subtotals it knows; a missing price is never replaced by zero, and a subtotal is never presented as a complete NAV. In the MVP, prices assist review and display; they decide no mint right and no claim. The contract can book an exit while the price interface is down, as long as its own rules allow it.

## 9. Architecture

Conceptually: the holder's wallet talks to the Curb interface; the interface shows access status and evidence, previews a composition, and hands the series contract the transaction. The series contract holds component A and component B and keeps the per-component claim ledger; claims of A and claims of B are separate transactions back to the holder. Contract events feed a chain index; issuer sources and prices feed deterministic checks; both land in Postgres and an evidence archive that the interface reads. Claims can live in the series contract itself; no separate escrow is required.

| Module | Responsibility | Limit of authority |
| --- | --- | --- |
| `CompanySeries` | Immutable components, lots, mint, burn, reserved claims, individual claims | Swaps no asset, lends nothing, runs no strategy. |
| Series receipt | Lot balances and the right to burn for exit allocation | Asserts no right to underlying shares or to CURB revenue. |
| Access rules | Checks wallet or recipient against the pilot policy | Replaces no issuer requirement; every access decision is recorded. |
| Incident control | Stops minting or a specific component's claims when needed | Cannot change a component address, move backing or rewrite a claim. |

The MVP uses one series contract with the receipt built in, and no permissionless factory. A factory and a public series list are added only when a second series is actually needed. Access decisions are stored on chain: minting needs an unexpired mint permit; claiming uses a claim permit recorded for the holder, with no fresh backend signature per withdrawal; permits can be revoked explicitly under a published policy. Exit allocation uses the internal receipt right and needs no new external access check. A Curb permit never overrides an issuer's contract restriction. A backend that is down does not block claims while the on-chain permit holds, the chain works and the component transfers; a holder whose permit is revoked needs the settlement process set out in the pilot document. The MVP receipt refuses transfer to another wallet even when both wallets hold permits.

The interface and data services keep the existing Next.js, TypeScript, React and Postgres stack; Solidity and Foundry are the proposed choices for the contract and its tests. The backend never holds a holder's private key. A model may compose explanations from facts the checker has already accepted; it decides no balance, no binding price, no recipient and no claim amount.

**The desk's role.** The Registrar supplies component identity and authority changes; the Archivist, corporate-action context; Pillar and the Bell, price and session context; the Tally and the Warden, reconciliation; Counsel archives document changes for a human to review; the Gazette publishes verified changes. Those agents need new sources and tests for a new chain. A source reading *read* does not mean safe, legal for every holder, or backed by reserves the Curb has audited. The MVP takes the deterministic functions it needs; nine agents do not have to become nine new services.

## 10. Data, API and events

| Entity | Minimum fields |
| --- | --- |
| Issuer | Internal id, legal entity name, documents, stated jurisdictions, review time. |
| Instrument | Underlying id/ISIN, issuer ticker, chain id, token address, decimals, wrapper and version, verification status. |
| Dependency | Party type, name, relationship, source, known/unknown, effective time. |
| Series | Contract address, two instruments, `q[i]`, lot denominator, mint status, series document, code version. |
| ReceiptBalance | Wallet, series, lots, block number and hash, confirmation status. |
| ComponentClaim | Wallet, series, component, reserved and claimed amounts, related transactions. |
| Observation | Source, effective time, read time, payload hash, raw data, parsed result. |
| Valuation | Input unit, price, amount, source, timestamp, completeness, reason if unavailable. |
| Incident | Component, affected operation, evidence, time, operator action, resolution. |
| AccessDecision | Wallet or recipient, policy version, status, validity, audit trail; no personal identity data published. |

Proposed product API — every token amount is a string of integer base units, never a float:

```text
GET  /api/positions
GET  /api/positions/{seriesId}
GET  /api/positions/{seriesId}/evidence
GET  /api/positions/{seriesId}/preview-mint?lots=...
GET  /api/positions/{seriesId}/preview-exit?lots=...
GET  /api/wallets/{address}/positions
GET  /api/wallets/{address}/claims
GET  /api/status
```

A preview sends no transaction and proves nothing about whether one would succeed. Access-specific or identity data needs authentication; a public address is not permission to open private data. Proposed contract events: `PositionMinted`, `ExitAllocated`, `ComponentClaimed`, `MintStatusChanged`, `ComponentClaimStatusChanged`, each carrying the series, the holder, the relevant component and amount, and the operator's reason where there is one. The chain index is idempotent on chain id, transaction hash and log index; it stores block hashes to detect reorgs; the interface tells pending, included and confirmed apart. The database is an index for display, never a source of liability that outranks the contract.

## 11. Operator authority and incidents

The pilot uses an operator multisig with published roles; quorum and people are decided before the pilot — for the treasury on Robinhood Chain they are (three signers named by address, 13 September 2026, in the operator policy); a series on Ethereum needs its own operator there. The current design allows a per-component stop on claims for exploit handling or a balance shortfall. That adds dependence on the operator and can delay withdrawal; the authority is shown in the series document. A design that can only stop minting has different trade-offs and is not mixed in without a reviewed decision.

| Action | Proposed policy |
| --- | --- |
| Stop minting | Fast, with an event and a reason. |
| Resume minting | Needs evidence the problem is over and a second review. |
| Stop claims of A | A only, and only on exploit risk, insufficient bookkeeping, or a defined access obligation. |
| Stop claims of B because A has a problem | Not default behaviour. |
| Replace a series component | Not available. Needs a new series and the holder's choice. |
| Take backing or alter a holder's rights | Not available. |
| Raise the pilot series fee | Not available in a fee-free pilot version. |
| Upgrade the series implementation | Not available in the immutable initial design. A critical bug means stopping the affected operations and a reviewed plan. |

Incident order: identify the affected operation and component; stop what must stop; preserve evidence; show a specific status; reconcile rights and balances; decide the fix; test it; announce whether to resume or hold. Never write *the issuer is bankrupt* from one reverted transaction. A bad price status does not stop component claims, because claims are in units. An exploit of the core contract can affect every series and needs a broader response; separating claims removes none of the shared failures of the chain, the Curb contract, operator keys or common service providers.

## 12. Scope and what is deferred

| Stage | What is built | What must be visible |
| --- | --- | --- |
| A — product validation | Narrative, position detail, simulated flow, the two-tokens-in-a-wallet baseline | Users understand the benefit, cost and limits without a token incentive. |
| B — accounting prototype | Two mock tokens, one series, mint, exit allocation, separate claims, event index | The ledger is right in the normal case, under a freeze, a donation, a failed transfer and a reordering. |
| C — compatibility evidence | Canonical addresses, access documents, fork tests of real components at a recorded block | Every assumption about component behaviour matches the version to be used. |
| D — limited pilot | Reviewed contract, participant access, lot cap, interface and incident procedure | Real funds only if every earlier gate passed. |

Deferred: single-stablecoin deposit and automatic routing; cash redemption; dynamic rebalancing; leverage, lending, insurance, bridges; uncurated stock lists; permissionless series; free receipt transfer; a market for stuck claims; reward tokens; buybacks; governance able to change the backing of an old series. Deferral keeps the prototype small enough to prove the mechanism; it is not a promise that any of these will be added.

## 13. Gates before real assets

| Gate | Required evidence | Where it stands |
| --- | --- | --- |
| G1 — instrument | Two issuers, one underlying, one chain, canonical identities | A's raw token and both wrappers, and B's token as the issuer's product page publishes it, are read on Ethereum daily and match the issuers' records. Related parties mapped from the documents; B's broker-dealer and custodian described but not named. Not passed. |
| G2 — rights and access | Review of rights, user categories, contract custody, receipt distribution, exit process | Not done. The access design is written as a proposed decision record; the review is a person's. Technical ability to hold is not enough. |
| G3 — components | Static balances, decimals, correct wrapper version, authority, real transfer and claim under test | On a fork of Ethereum: identity, transfer, unwrap and who stands behind each address for A; identity, transfer and authority for B; one series took both real components in and paid both out; across the issuer's dividend activation of 8 August 2026 the wrapper's shares did not move while the raw balance did (T14). A split is not on the record. Not passed: eligibility and a reviewed decision remain. |
| G4 — contract | Invariants and adversarial tests pass; independent review; material findings closed | A prototype passes T01–T12, T17, T19, T20, T22–T25 and a fuzz run. No independent review. Not passed. |
| G5 — operations | Reconciliation, index recovery, incident drill, key management, direct claim interface | Reconciliation, index recovery and the drill shown on a local chain; the direct claim interface exists — a holder's own wallet claims from the series page — rehearsed on that chain. Robinhood Chain treasury signers and the Safe creation are recorded. The Ethereum series operator and remaining key-management policy are unverified/proposed. Not passed. |
| G6 — economics | Measured formation and exit cost, and user need against the baseline | Execution gas measured on a fork with the real wrapper, no price applied. User need not validated: no interviews held. Not passed. |

If two eligible issuers are not available on Robinhood Chain, the thesis cannot be met by wrapping two tokens from the same issuer. Choose a chain that passes the gates or stay in simulation. There is no hidden bridge plan to cover the gap. Receipt terms may need their own structure and distribution arrangements; nontransferable or testnet status does not settle every obligation for a real-asset pilot. That is specific feasibility work, not a claim of regulatory approval.

## 14. The engineering test plan

| ID | Scenario | What must be shown |
| --- | --- | --- |
| T01 | Normal mint of two components | Both amounts right; receipts exact; liabilities never exceed balances. |
| T02 | Second component transfer fails | Whole mint reverts; no receipt, no partial deposit becomes final. |
| T03 | Exit allocation | Total liability per component unchanged; rights move from active to reserved. |
| T04 | A cannot be transferred | A claim intact; B claim proceeds without calling A. |
| T05 | Double claim or wrong recipient | No double payment; no reassignment of rights without consent. |
| T06 | Mint after pending claims | New depositor gets no part of the exit reserve. |
| T07 | Donation before the first mint and later | Changes no lot, no receipt count, no existing entitlement. |
| T08 | Component balance below liability | Nominal claims of that component fail; no race for the remainder. |
| T09 | Reentrancy callback or a token returning false | Rejected or rolled back with the ledger still right. |
| T10 | Fee-on-transfer or raw rebasing token supplied | Rejected as an MVP component, or the integration gate fails. |
| T11 | Zero supply with reserves still open | A new mint does not adopt old holders' claim assets. |
| T12 | Different decimals and integer limits | No overflow, no unit mix-up, no loss of small components. |
| T13 | Missing or stale price | Mint and exit rights unchanged; no false complete total. |
| T14 | Corporate action on a real component | Unit balance and conversion behave as the chosen version says; no double multiplier. |
| T15 | Upstream implementation or authority change | Detected; verification status re-reviewed; minting can be stopped. |
| T16 | Reorg, duplicate event, RPC outage | No double balance; index recovers from chain; interface shows the limitation. |
| T17 | Eligibility or recipient change | MVP receipt transfer always refused; claims only to an owner the claim policy admits. |
| T18 | Website or backend down | The documented contract path still works for the entitled party while chain and contract work. |
| T19 | Two components with the same address | Deployment refused; one balance is not counted as backing for two liabilities. |
| T20 | `balanceOf(A)` reverts | Exit allocation and B claims still never call A. |
| T21 | Wrapper transfers but unwrap fails | The interface never calls a wrapper transfer a cash exit or a recovery of the underlying. |
| T22 | Repeated burn and mint while reserves are unclaimed | The whole-liability cap cannot be passed by lowering active supply. |
| T23 | Exact deposit while an old shortfall exists | The total backing check refuses; the old loss is not covered quietly by a new depositor. |
| T24 | Alternative mint or burn paths | No admin mint, no public burn that bypasses two-component bookkeeping. |
| T25 | Backend down, mint permit expired, claim permit active or revoked | Claims follow on-chain state without a new backend signature; live restrictions shown exactly. |

Fuzz and invariant tests vary the number of holders, the order of mint, allocation and claim, which component fails, and the lot count. The minimum lot must make every `q[i]` a positive integer. Mock tests come first; fork tests check real code but do not prove every future operating condition. Where each case stands, as of 12 September 2026: T01–T08, T11, T12, T19, T22, T23 and T24 run against the ledger model in this repository; T01–T12, T17, T19, T20, T22–T25 run against the prototype contract in `contracts/`, with a fuzz run over sequences of mints, exits and claims whose seed and result are recorded; T13 is the site's valuation — a missing or stale price is a stated reason, never a zero, and a lot is never totalled while a component has no price; T14 is answered on two forks of Ethereum across the issuer's dividend activation of 8 August 2026 for component A (a split is not on the record); T15 is the daily drift check of code hash, symbol, decimals, `asset()` and the EIP-1967 slots, raised as a DARK condition; T16 is answered by the index's idempotency and reorg-rollback tests, the rehearsal on a local chain, and the drill's dead-RPC scenario; T18 by the drill's backend-down scenario; T21 on a fork of Ethereum for component A — the wrapper unwraps for an arbitrary holder, and its whole reserve was about ten tokens at the block read. None of this is a review, and none of it is on a public deployment: the local chain, the forks and the mocks are what the cases have been shown on.

## 15. Validation and the measure of success

Figures here are **proposed experiment targets**, not industry benchmarks or research already done. Start with 10–15 relevant prospective users, holders and a few integrators. Ask them to describe their last experience managing issuer exposure; do not ask whether the idea sounds interesting. Never offer a token allocation in exchange for choosing the product.

Show three options with disclosed costs: one representation of a share; two representations in the user's own wallet; one Curb receipt. The Curb offer tested is exactly the MVP: direct component deposit, fixed lot, nontransferable receipt, per-component exit. Interest in a future tradable or collateralisable receipt is recorded as a separate hypothesis. Rotate the order so the Curb never gets the position advantage. Record reasons, task time, misunderstandings, willingness to pay and recurring needs.

Suggested decision targets: at least five participants can show a real operational problem; at least three want to test again after seeing the added cost and risk; at least one integrator has a specific need for the receipt if integrators are the primary customer. These are early signals to continue, not proof of product-market fit.

Required comprehension test: participants can explain that the share can still fall, a component can get stuck, a brand split does not prove separate custody, the MVP receipt cannot be sent or sold as one token, and the Curb guarantees no cash redemption. Systematic misunderstanding means revising copy and flow before a pilot.

Stop or change the receipt thesis if people choose to hold the two tokens themselves after full information, if the added cost and contract risk have no measurable benefit, or if access requirements make the user segment too narrow for the chosen business.

## 16. Revenue and the CURB token

The prototype and an early technical pilot may charge no product fee, with gas paid as the flow requires. No fee logic goes into the contract before basic demand is shown. A paid release explains its cost in the preview and the series document.

| Revenue | Source of value | Condition before it applies |
| --- | --- | --- |
| Position formation fee | Automation of acquiring components and forming the position | A real purchase path, and a benefit over doing it yourself. |
| Integration / API fee | Position data, component rights, evidence, reconciliation for other applications | Active integrators with recurring need. |
| Operational subscription | Reporting and management of several positions for relevant users | Tested willingness to pay. |

A revenue model never equates assets under management with transaction volume. A hypothetical: US$1 million of paid volume a month at 0.10% is US$1,000 of gross revenue before costs — not a projection, a final rate, or a promise of scale. Spread, gas and issuer fees are not all Curb revenue.

**Three instruments to keep apart:** the issuer component is the asset held; the company receipt is the proportional right to a series' components; CURB is a candidate ecosystem token whose need has to be proven on its own. If CURB is ever launched, the most sensible function to test is payment for data and integration services that actually exist, with stated prices, a stated conversion, slippage limits, credit validity and a cancellation policy. Governance, if ever used, may take proposals on research priorities or new series; a vote never changes a holder's balance, takes claim reserves, replaces an old series' components, or declares an issuer safe because many tokens said so. There is no basis yet for supply, allocation, vesting, buybacks, fee sharing or CURB as a loss guarantor; a launch on a launchpad does not change that. Positions never depend on a CURB price or a bridge.

That function is decided — the product owner, 12 September 2026 — and exists with working parts ([the token record](/mechanism/decisions/token), [the services page](/services)): a price list in dollars for the history and the fan-out the site already keeps, a US$20 opening minimum, a credit desk contract that moves CURB to a published treasury and emits the key hash and the amount, and a rate read from a pool at a block — the price as the pool's own (a pair's reserves, a v3 pool's square-root price), the market capitalisation as price times supply — so the CURB a dollar is moves with the market and is never typed in. A top-up is credited at the rate at the block it was mined — by state while the node serves it, else from the pool's own events at that block, and at the head when indexed only for a pool that did not exist at that block — or at the lowest rate the pool showed in the hour before, whichever is lower. This limits credit from a short price spike; it does not guarantee resistance to sustained manipulation or a thin pool. Credits do not expire while a service is offered; a service closes with thirty days' notice; nothing is refunded. The launch is on Robinhood Chain, the desk's own; the position's candidates are on Ethereum, and the two never meet. No token exists and nothing is configured; the services and the gate were built first so that a launch, when it comes, sells something that already works.

## 17. First work, and what exists today

Three things can start now without a token or a public launch: complete the instrument candidate file; test the narrative against the two-tokens-in-a-wallet baseline; and prove the accounting with mocks. The ledger model and its tests in this repository are the beginning of the third; the [simulation](/positions/apple-s1) is the beginning of the second.

What is implemented in this repository, as of 12 September 2026, and what is not:

| Piece | Status | Where to check |
| --- | --- | --- |
| Ledger model (§7) with the blueprint's test cases | Implemented, tested | `lib/positions/ledger.ts`, `tests/positions.test.ts`, the simulation |
| Issuer evidence archive: fetched daily, kept as received, versioned by the identity of the record — its parsed fields in canonical order, so a trading-session field or a reordered list is not a change (D02) | Implemented, running on the tick | `/api/positions/apple-s1/evidence` |
| On-chain verification of every address the evidence names — code, symbol, decimals, `asset()` against the claimed raw token, the EIP-1967 slots behind a proxy (an upgrade the code hash cannot see), the raw token's corporate-action multiplier and the wrapper's conversion (a corporate action seen the day it activates, and a record that names a different address seen as a DARK drift) | Implemented, running on the tick | the series page, `/api/positions/apple-s1/evidence` |
| Separate network profile for the product, with its own RPC override; chain id confirmed before any read (D05) | Implemented | `lib/chain/networks.ts`, `lib/chain/rpc.ts` |
| Event codec, idempotent index with reorg rollback, replay to the ledger (D03) | Implemented, tested against fixtures; no contract to index | `lib/positions/index.ts`, `tests/positions-backend.test.ts` |
| Reconciliation of units owed against `balanceOf` per component (D04) | Implemented; runs only for a configured deployment | `lib/positions/reconcile.ts` |
| Verification of a deployed series' code against the build in this repository — bytecode equal outside the immutable slots, the slots holding the record's components, units and cap (the contract verification procedure of G02) | Implemented; runs every tick for a configured deployment, shown on the series page, a mismatch is DARK; rehearsed against the local deployment | `lib/positions/code.ts`, `contracts/evidence/CompanySeries.build.json` |
| Product API (§10) with string amounts, previews that send nothing, and an indicative value (§8) from dated sources — A from the wrapper's conversion at a recorded block, B from the shares-per-token figure the issuer's product page publishes, both against the desk's AAPL / USD sample — never totalled while a component has no price | Implemented | `/api/positions`, `/api/wallets/…`, `/api/status` |
| Series contract prototype (§7, §9.1, §11) with Solidity tests T01–T12, T17, T19, T20, T22–T25 and a fuzz run; the seed, the results and the commit recorded (C07) | Implemented in `contracts/`; unaudited, unreviewed, undeployed | `contracts/src/CompanySeries.sol`, `contracts/test/CompanySeries.t.sol` |
| Fork tests of the real components on Ethereum (C08, G3): for A identity, transfer, a series round trip, unwrap (T21), the raw token's derived balance and the wrapper's size; for B — the address the issuer's product page publishes — identity, transfer, and one series taking both real components in and paying both out; who stands behind each address (EIP-1967 implementation, admin and beacon, `owner()`, `paused()`) — findings written to `contracts/evidence/apple-s1.fork.json` and shown dated | Implemented; block not pinned (public node) | `contracts/test/fork/`, the series page |
| Index, ledger replay, reconciliation and the wallet endpoints rehearsed end to end on a local chain: the prototype deployed with two mock components, the worked example sent as transactions, the five events read back in order, A and B `MATCHED` (T16, T18 in the part a local chain can show) | Implemented, repeatable; a local chain, not a public one | `contracts/scripts/rehearsal.ts`, `tests/positions-rehearsal.test.ts` |
| The calls a wallet would sign — approvals and the series call as bytes, selectors derived from the contract's ABI — returned by the previews once a deployment is configured; the site holds no key and sends nothing | Implemented; simulated by the local node against the real contract | `lib/positions/calldata.ts`, `/api/positions/apple-s1/preview-mint` |
| "My position" (§6) as a read-only lookup of the index by address — receipts, entitled units, open claims per component, claims apart from receipts | Implemented | the series page, `/api/wallets/<address>/…` |
| "Form position" and "Claim components" (§6, U03, U04) with the holder's own wallet: prepared bytes, one wallet transaction per step, the wrong chain refused, the receipt read from the chain after mining, the index shown as the index | Implemented for a deployed series; rehearsed end to end on a local chain with a stand-in wallet — approve, approve, mint, then allocate, claim A, claim B, all mined, the index and reconciliation caught up | `app/components/wallet-sign.tsx`, the series page when `CURB_SERIES_DEPLOYMENTS` is set |
| The Gazette prints the product's verified changes by day (§9): issuer bodies first archived or changed, candidate addresses that moved between verification runs — derived from the archive's version rows and the drift rows, never a second record | Implemented | `/gazette/<day>`, `lib/positions/journal.ts` |
| The operational drill (O02) on a local chain: the issuer freezes A, the series is short of A, the backend is down, the RPC fails, a source is lost, and the operator as a 2-of-3 quorum (a stop and a resume each need two signatures; the former single key is refused) — chain half as transactions, site half as the index, reconciliation and conditions; every hash and revert kept; nobody paged, nothing recovered | Implemented, repeatable; a local chain with mock components | `contracts/scripts/drill.ts`, `tests/positions-drill.test.ts`, `contracts/evidence/drill-local.json`, the series page |
| Execution gas of each operation with the real wrapper as A, measured on the fork (B01's cost input; no price applied) | Implemented, dated with the fork block | `contracts/evidence/apple-s1.fork.json`, the series page |
| T14, a corporate action across a recorded block: two forks of Ethereum at the block before and at the issuer's multiplier activation (block 25,706,680, 8 August 2026 00:30 UTC, found by a binary search of `multiplier()` over archive state) — the multiplier moved +0.0603%, the wrapper's shares did not, the wrapper's raw balance did, the conversion rate equalled the multiplier on both sides | Implemented, recorded in `contracts/evidence/apple-s1.corporate-action.json`; a split is not on the record | `contracts/test/fork/AppleCorporateActionFork.t.sol`, the series page |
| T13 (a missing price is never a zero; every price dated twice) on the site side; T18 against a public chain | T13 covered by the valuation and its tests; T18 needs a deployment | `tests/positions-valuation.test.ts` |
| Independent review and audit of the contract | Not started | — |
| Drift between daily verification runs and changes in the evidence raised as conditions and alerted (T15) | Implemented | `/api/state` → `conditions`, the webhook |
| Instrument file compiled from the archive and the chain (R01, the automatable half) | Implemented | `/api/positions/apple-s1/file` |
| Issuer documents watched for change by the hash of their visible text (13 pages) | Implemented, running on the tick | the series page, `/api/positions/apple-s1/evidence` |
| The map of related parties (R02): issuer, tokenizer, brokers, custodians, security agent, underlying, settlement asset, bridge and contract authority for each component, every line with its source and date; a role the documents describe without naming is left empty; no party is named under both components and no independence is claimed | Implemented from the issuers' documents as read on 12 September 2026; the pages are watched for change | the series page, `lib/positions/dependencies.ts`, `/api/positions/apple-s1/file` |
| Decision records for the immutable series, the nontransferable receipt, on-chain access (with R03's answers on holders, revocation and lost access), per-component stops, no sweep and claims to the holder, and lots and the cap (R03, R05, R06); the operator policy (O01) and the runbook (O03) | Series ADRs and remaining operator policy proposed; treasury signers recorded separately; each names who decides | [/mechanism/decisions](/mechanism/decisions), `docs/decisions/` |
| The cost comparison against the baseline (B01): a round trip's gas with both real components measured on the fork, the method with gas price and ETH price left as variables, the issuers' fees placed where they belong | Written as a proposal with measured inputs; no price applied | [/mechanism/decisions/costs](/mechanism/decisions/costs) |
| The deployment plan (G02): the reviewed record, the operator's tool that refuses an unreviewed record, the wrong chain or a missing key, and the two verifications after — rehearsed on a local chain; nothing sent to a public chain | Written as a proposal; the tool exists and refuses | [/mechanism/decisions/deployment](/mechanism/decisions/deployment), `contracts/scripts/deploy-series.ts` |
| Invariant tests: a handler the fuzzer drives through mint, exit, claim, donation, halts, seizure, stops and receipt transfers, with five invariants held over 256 sequences of depth 64; the seed, the runs and the results recorded | Implemented | `contracts/test/CompanySeries.invariant.t.sol`, `contracts/evidence/unit-tests.json` |
| The assumption register (§19), a self-review that is not a review (C09), and the interview guide and comprehension test ready to run (R04, B02) | Written; the assumptions are the conservative ones, and the site states none of them as fact | [/mechanism/decisions](/mechanism/decisions) |
| The token's one function (§16): the credit desk contract (top-up to a published treasury, an event, nothing held, no admin) with fifteen tests and its build recorded; the price list in dollars; the rate read from a pool at a block with the market capitalisation it implies; top-ups indexed and credited at the rate at their own block; keys by hash, opened at US$20; the paid endpoints (evidence versions, journal by day, webhook delivery) admitted, answered, then charged; the desk's code and treasury verified against the build every tick; the receipts derived from the keys' rows; the desk's conditions; the deployment tool that refuses an unreviewed record; the token read from the chain into the record; the operator's Safe planned unsigned and simulated on Robinhood Chain, and its quorum acting with ordinary transactions (approve the hash, execute) rehearsed with Safe's own code; the launch condition that the token be a plain ERC-20; a top-up's own block priced from the pool's events where the node's state has gone (Robinhood Chain's public node keeps ten minutes of it, measured); the services page with the order of work as the site can see it; the Gazette's daily receipts — rehearsed on a local chain with a mock token and a mock pool, two top-ups at two prices priced each at its own block by state and by events, the deployment tool included | Implemented; the record decided by the product owner on 12 September 2026 (prices, terms, proceeds, order of work, Robinhood Chain); no token exists; NOT_CONFIGURED in production | [/services](/services), [/mechanism/decisions/token](/mechanism/decisions/token), `contracts/src/CreditDesk.sol`, `lib/credits/` |
| User interviews (R04), comprehension tests (B02), the gate decision (G01), the independent review (C09) | Not done — people; the assumption register says what is assumed meanwhile | [/mechanism/decisions/assumptions](/mechanism/decisions/assumptions) |
| Any deployment, any real asset | None. `/api/status` says NOT_DEPLOYED | — |

The Ondo API source records `ACCESS_DENIED`: its documented endpoint requires an API key this desk does not hold, and that stays archived as the finding. Component B's candidate address is taken from the issuer's own product page for the asset, which publishes the deployment per network and is archived and verified on chain daily; the example address in Ondo's API specification is never used as a source, whatever it happens to equal.

## 18. Questions people ask

**Is one receipt one share?** No. One receipt is one lot of the components the series describes. Its value and exposure depend on those components.

**Do I receive cash dividends?** The MVP promises no cash dividend. A dividend's effect follows each component's own mechanism and shows in the economic right that component carries.

**Are the weights always 50:50?** No. The unit composition per lot is fixed; the value weights move.

**Can the early receipt be sold or sent?** Not in the proposed MVP. To exit, allocate the rights and claim the components. Transfer and other integrations are not available.

**What happens when one token halts?** The Curb is designed to record every component's claim separately. The other component can be withdrawn if its transfer still works. Recovery of the halted component is not guaranteed.

**Why not hold the two tokens myself?** That is a valid alternative. The Curb has to prove that lot formation, bookkeeping or integration is worth the added cost and contract risk.

**Do I have to buy CURB?** Not for the proposed MVP. The position receipt and the CURB token have separate functions: the only function of CURB, decided, is paying for the desk's data services — the archive's history and the alert fan-out — at prices in dollars ([/services](/services)); forming, holding and claiming a position never need it.

## 19. Assumptions and open decisions

| ID | Assumption or decision | How it is settled | If it fails |
| --- | --- | --- | --- |
| A01 | Two compatible components for Apple on one chain | Verify addresses, code, rights; integration tests | Change candidate or do not pilot. |
| A02 | An issuer split that users find useful | Dependency map and experience-based interviews | Reduce the claimed benefit or change the proposition. |
| A03 | A receipt adds value over two tokens in a wallet | Cost and task experiments | Stop the receipt thesis, or test a no-custody position service. |
| A04 | Component units are static | Code and version review; fork tests of corporate actions | Exclude the component; never patch with an assumed formula. |
| A05 | Vault and receipt use fits the intended access | Instrument and distribution review | Stay on mocks and testnet until clear. |
| A06 | Costs are acceptable | Measure gas, spread, issuer fees and willingness to pay | Change segment, flow, or stop. |
| A07 | A pilot can run with enough control | Independent review, drills, key management, gates | Do not run a real-funds pilot. |
| A08 | The main token has a service need | Test real service customers | Never make the token a condition of the product. |

Where each stands on 12 September 2026, and what is assumed while it is open, is kept in [the assumption register](/mechanism/decisions/assumptions): A01 — both components read on chain daily and tested on forks, rights not reviewed; A04 — shown for one dividend activation, not a split; A06 — gas measured, willingness to pay not; A02, A03, A05, A07, A08 — open, with the conservative assumption taken: hold, unreviewed, not eligible until an issuer says so, and no configured token/credit desk. The Robinhood Chain treasury signers were recorded on 13 September; the candidate Ethereum series operator remains unverified.

Production decisions left blank on purpose: the final component pair, wrapper version and hash, final chain, `q[i]`, minimum lot, total pilot lot cap, participants and eligibility, operator quorum, auditor or reviewer, deployment addresses, fees and launch date. They stay blank so nobody mistakes an illustrative figure for an approved configuration. Once implementation results exist, each gate is updated with a commit link, contract version, test block, results, review date and decision owner. Public copy says a function is available only once it actually is: the stage moved to *mainnet* on 13 September 2026 because the treasury is on chain, and it says in the same breath what is not — the token, the desk, the series.
