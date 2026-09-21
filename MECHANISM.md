# THE CURB — Mechanism, v1

**One company. Multiple issuers. One position.**

A proposed specification and validation plan, 12 September 2026, kept current. A CompanySeries prototype has run on local chains and Ethereum forks. No public series deployment or issuer integration is approved. The Robinhood Chain treasury Safe creation, recorded separately, establishes no Ethereum series operator, live credit desk or real-asset position pilot. Unverified addresses, fees, compositions, receipt symbols and pilot limits are labelled illustrative.

## 1. The decision

Preparation and open evidence: [the mainnet dossier](docs/mainnet/PREPARATION.md). In the latest source, operator handover is two-step (the operator proposes, the nominee accepts; authority moves on acceptance), pending independent review and the gates below.

The Curb is proposed as the place to form one company position through several stock-token issuers. **The recommended MVP:** one company, two issuers that pass verification, one network, a fixed composition in token units, in-kind deposits, per-component claims; mock tokens first. A real-asset pilot is considered only after instruments, holder rights, contract and costs are shown to hold.

First research candidate: Apple via xStocks (official non-rebasing wrapper; raw AAPLx not assumed static) and Ondo, on Ethereum; not yet ready to integrate. The MVP needs no CURB token. CURB's launchpad launch is decided for Robinhood Chain (the desk's own); the components are on Ethereum; the two never meet.

| Decision | Initial choice | Why |
| --- | --- | --- |
| Company exposure | One company per series | Comparable aim and components. |
| Number of issuers | Two, for the prototype | Bounded room for failure. |
| Network | One EVM; Ethereum is the integration candidate | The researched pair is there; availability is still a gate. |
| Composition | A fixed number of component units per lot | Rights need no price oracle. |
| Deposit | In kind: both specified components | No early swapper, RFQ or stablecoin dependency. |
| Withdrawal | Allocate every component, claim each separately | One failed transfer cancels no other. |
| Rebalancing | None in an MVP series | No automatic buying after an issuer-driven fall. |
| Receipt transfer | Not available in the early experiment | Restricted transfer needs its own eligibility design. |
| Upgrade | A new series; old components are never swapped | Holders choose to migrate. |
| Main token | Not a condition of using the MVP | Need is tested without a speculative incentive. |

## 2. Thesis and narrative

Similar symbols hide different issuers, contracts, providers, corporate-action rules and exits. The Curb lets a holder split one company position across plainly disclosed issuers, each right recorded and separately withdrawable. If one component is obstructed, the ledger shows what can move and what remains a claim. Company, issuer and contract risk remain.

**Testable promises:** a holder can know and prove their position's composition; the ledger never erases a right to a component that cannot yet be transferred; mint and exit need no decision by a model.

**Claims this product does not make:** capital is protected; it cannot be frozen; it is the same as holding the share directly; it is automatically safer; it can always be sold at the reference value; it earns more; the issuers or custodians are fully independent; it is the first of its kind.

## 3. What is known, and the limits of novelty

| Finding | Design consequence | Source and limit of evidence |
| --- | --- | --- |
| AAPLx: Apple exposure, Ethereum/ERC-20. AAPLon: Ondo, Ethereum, per-network deployment on its product page. | A reasonable one-underlying, one-chain pair. | [AAPLx](https://assets.backed.fi/products/apple-xstock), [Ondo](https://ondo.finance/blog/global-markets-is-live), [AAPLon](https://app.ondo.finance/assets/aaplon). No Curb integration verified. |
| Both issuers: economic exposure; rights differ from a share. | The receipt explains its claim. | [xStocks FAQ](https://docs.xstocks.fi/docs/frequently-asked-questions), [Ondo disclaimers](https://docs.ondo.finance/legal/disclaimers). |
| xStocks balances and multipliers need their own accounting. | Components need a verifiably static unit balance. | [xStocks corporate actions](https://docs.xstocks.fi/docs/dividends-and-stock-splits). |
| xStocks: non-rebasing wrapper, older and current versions; verify address and underlying. | Never pick a wrapper by ticker or field name. | [Wrapped xStocks](https://docs.xstocks.fi/developers/wrapped-xstocks). Conversion prose must match the contract. |
| Ondo: smart contracts may hold the token; access requirements still apply. | Ability to hold does not settle product or holder eligibility. | [Investing and redeeming](https://docs.ondo.finance/ondo-stocks/investing-and-redeeming), [Eligibility](https://docs.ondo.finance/ondo-stocks/eligibility). |
| ERC-4626 is for one underlying token. | A two-component receipt is not marketed as standard ERC-4626. | [EIP-4626](https://eips.ethereum.org/EIPS/eip-4626). Components may use such wrappers individually. |
| Multi-representation baskets and per-component withdrawal have precedents. | Tested here: the package, one share through several issuers. | [mStable](https://docs.mstable.org/assets/musd), [Stax](https://www.stax-index.com/whitepaper). |

A limited search found no exact precedent; that does not prove global novelty. No patentability, financial principle or scientific finding is claimed.

## 4. Who it is for, and the baseline it must beat

Study first: holders who meet access requirements and know their issuers, and integrators needing one explicit position. Fund size is not evidence of need; behaviour must be tested. Interviews are not held, by decision (20 September 2026); observed use stands in (see §15).

| User | Job to be done | Evidence of need sought |
| --- | --- | --- |
| Holder of several representations of a share | Form, record and unwind a consistent position | Has managed one; can show today's problems and costs. |
| Eligible allocator | Pick an initial issuer mix and check its concentration | An allocation need without automatically maintained weights. |
| Integrator or wallet | Display or integrate one position with clear claims | A specific technical need and a written integration plan. |

**The baseline is holding token A and token B in one wallet**, which already splits issuer exposure. The Curb must add something measurable: consistent lots, an integrable ledger, fewer steps, or integration as one position. Collateral acceptance, DEX listing and external wallets are out of scope. If users want the split without the receipt, test a purchase-and-bookkeeping service in their own wallet: a different product, not a win for the receipt thesis.

## 5. Product shape and terms

The product stays **The Curb**; positions are named by company and series (e.g. **Apple Position — Series 1**). The symbol `cAAPL-S1` is illustrative, not an issued token or a checked name.

| Term | Meaning in the Curb |
| --- | --- |
| Company / underlying | Whose exposure the components carry. |
| Issuer | Legal entity issuing the instrument; not an exchange or a chain. |
| Component | The token the series holds, wrapper included. |
| Series | Components, units per lot, chain and rules, fixed at creation. |
| Lot / receipt | One series unit; not automatically one share or one dollar. |
| Indicative value | An estimate from a dated price source. |
| Executable value | A specific quote for a given size and time. |
| Exit allocation | Receipt burned; each component right recorded as the holder's claim. |
| Component claim | Delivery of one component to the entitled holder. |
| Unwrap | A wrapper exchanged for the token it wraps. |
| Issuer redemption | Through the issuer, on its terms, hours and mechanism. |

The last four, and a market sale, never share one label such as "withdraw to cash". The MVP ends at component delivery.

## 6. Flows and screens

- **Finding.** One position for simulation or pilot: company, two issuers, network, lot composition, access and product status. Until live: **Try the simulation**. The related-party map (issuer, broker, custodian, contract authority, wrapper, sources) marks gaps *not known*, never an invented safety score.
- **Access.** Right network; access per the approved design for the pilot's regions and user categories, not assumed for every non-US user. Holders bring the right components; raw AAPLx versus a required wrapper is explained. Never an approval for the wrong asset or a route around a third party's restriction.
- **Forming.** The review shows exact amounts, estimated value with price time, allowances, estimated gas and receipt count. It says the receipt cannot be sent or sold as one token. Deadline and input limits apply; deposits and receipt are atomic.
- **Holding.** Receipts, entitled units, value weights, open claims; pending claims never count again as backing. A 50:50 start can drift to 45:55; no rebalancing.
- **Unwinding.** Exit allocates all rights; A and B are claimed separately. A blocked A stays pending with a known reason or *cause not confirmed*; B proceeds alone. No date or recovery value is promised.

| Screen | Function | Done when |
| --- | --- | --- |
| Front | Position and product stage | Simulation / pilot / live visible before a wallet connects. |
| Company detail | Components, issuers, rights, units per lot | Contract identities and documents traceable. |
| Form position | Preview, approval, mint | No receipt if one deposit fails. |
| My position | Active receipts, open exit claims | No value counted twice. |
| Claim components | Allocation, individual claims | A failed A transfer does not block claiming B. |
| Evidence and status | Reconciliation, source status, changes | Old, partial and unavailable data told apart. |

Built (§17): front, company detail and evidence screens; "My position"; wallet signing for a deployed series, the index updating next tick. Local chain only; with no series deployed, the public site omits it. The site never holds a key.

## 7. The ledger: lots with fixed components

A **design**, not audited code. Components need unit balances proven not to change on their own; value per unit may change. Each series fixes two distinct component addresses, still to be verified as the intended issuers', and their base units per lot, for life. The receipt has `decimals = 0`: one unit is one lot, sized so a holder can take a small enough fraction of a share.

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

*Solvent* means only enough token units for the Curb's bookkeeping, not issuer backing, dollar value or saleability. Tokens sent straight to the contract are a separate surplus that changes no `q[i]`, receipt count or claim and never prices a mint. With no admin sweep, wrongly sent assets can be locked; recovery would need its own design and review.

### 7.1 Mint

Minting `k` lots takes exactly `k × q[i]` of each component. The contract checks eligibility and the mint limit, transfers both, and requires `B_after[i] ≥ (n + k) × q[i] + R[i]` before minting. Fee-on-transfer and non-conforming tokens are unsupported. Maximum inputs and a deadline bind the mint to the preview; no NAV oracle is needed. The cap, in units, counts pending claims: `(n + k) × q[i] + R[i] ≤ capLots × q[i]`. `capLots × q[i]` must not overflow from deployment.

### 7.2 Exit allocation

```text
require the caller holds k lots
burn k lots of receipt
for every component i:
    C[user,i] += k × q[i]
    R[i]      += k × q[i]
```

Only the Curb's ledger changes; no external token, oracle or model is called. `A[i]` falls as `R[i]` rises, so total liability holds and a frozen component never blocks the exit record. There is no public `burn` or `burnFrom` bypass and no admin mint; supply moves only by complete deposit or exit allocation.

### 7.3 Claiming one component

`claimComponent(i)` pays the whole claim on one component, only to the claimant's own wallet. It checks the right, recipient access, component status, and that the balance covers the whole liability. The claim is marked paid before the transfer; a failed or wrong-amount transfer reverts. Claiming A never reads or calls B; paying `x` of A lowers only `B[A]` and `R[A]`, by `x`. Only the claimant can change a recipient; alternate recipients, transferable and partial claims are deferred. Below total liability, a component's nominal payments stop; a haircut, substitution or recovery sharing would need a new specification.

### 7.4 A worked example

Units only, no Apple price or address. One lot is 10 A and 20 B; 100 lots are outstanding; Alice exits all 25 of hers.

| State | Active receipts | A active | A reserved | B active | B reserved |
| --- | ---: | ---: | ---: | ---: | ---: |
| Before Alice exits | 100 | 1,000 | 0 | 2,000 | 0 |
| After Alice's allocation | 75 | 750 | 250 | 1,500 | 500 |
| A halts; Alice claims B | 75 | 750 | 250 | 1,500 | 0 |
| Bob mints 10 lots | 85 | 850 | 250 | 1,700 | 0 |

Bob deposits 100 A and 200 B and gets none of Alice's 250 pending A. While A is halted, his whole mint fails. The [simulation](/positions/apple-s1) and `tests/positions.test.ts` reproduce the table row by row.

### 7.5 The limit of 50:50

Fixed units do not hold value weights at 50:50; fees, multipliers, dividends, prices and transaction obstacles move them. The Curb never buys a troubled token to restore the ratio. A new series may set new units after evaluation; holders choose whether to move, with no forced migration by token vote.

## 8. Corporate actions, prices, and what an exit means

Three units stay apart: component units held (these set withdrawal rights), documented underlying-equivalent exposure, estimated money value. xStocks conversion and unwrap use the verified wrapper version's contract method, never a summary's multiplier formula or a lookalike wrapper. Ondo documents dividend reinvestment in token pricing, with display that can differ by network; the Curb keeps no cash dividend balance ([Ondo corporate actions](https://docs.ondo.finance/ondo-stocks/corporate-actions)).

On a corporate action: archive source and time, match affected tokens, check conversion and indicative value, stop minting if assumptions are unconfirmed, publish status. No component is swapped quietly on a merger, ticker change or discontinuation.

Four separate statuses: transferable to a wallet; unwrappable; a market offer at the intended size; issuer redemption for an eligible holder. A wrapper transfer does not prove the underlying can be cashed; a withdrawn token keeps its issuer risk.

Live value:

```text
indicative_receipt_value = Σ q[i] × indicative_price_per_base_unit[i]
indicative_holder_value  = holder_lots × indicative_receipt_value
```

Pending claims show separately. Prices carry unit, source, effective time and read time; a wrapper conversion is not a market price. A missing price shows *total value incomplete* with known subtotals, never a zero or a complete NAV. Prices decide no mint right or claim; exits can be booked while pricing is down, if contract rules allow.

## 9. Architecture

The wallet uses the Curb interface (access status, evidence, preview), which passes transactions to the series contract. That contract holds A and B and the per-component claim ledger, so no escrow is needed; A and B claims are separate transactions. Contract events and issuer sources feed a chain index and deterministic checks, stored in Postgres and an evidence archive.

| Module | Responsibility | Limit of authority |
| --- | --- | --- |
| `CompanySeries` | Immutable components, lots, mint, burn, reserved and individual claims | No swaps, lending or strategy. |
| Series receipt | Lot balances; burn for exit allocation | No right to underlying shares or CURB revenue. |
| Access rules | Wallet or recipient against the pilot policy | Replaces no issuer requirement; every decision recorded. |
| Incident control | Stops minting or one component's claims | Cannot change a component address, move backing or rewrite a claim. |

One series contract, receipt built in; a permissionless factory and public series list wait for a second series.

On-chain access:

- Minting needs an unexpired mint permit.
- Claiming uses the holder's recorded claim permit; no fresh backend signature per withdrawal.
- Revocation is explicit, under a published policy; a revoked holder needs the pilot document's settlement process.
- Exit allocation uses the receipt right; no new external check.
- A Curb permit never overrides an issuer's contract restriction.
- A backend outage blocks no claim while the permit holds, the chain works and the component transfers.
- The MVP receipt refuses transfer, even between permitted wallets.

Stack: the existing Next.js, TypeScript, React and Postgres; Solidity and Foundry proposed. The backend never holds a holder's private key. A model may word explanations from checker-accepted facts; it decides no balance, binding price, recipient or claim amount.

**The desk's role.** Registrar: identity, authority changes. Archivist: corporate actions. Pillar and the Bell: price, session. Specialist: on-chain price versus feed. Tally and Warden: reconciliation. Counsel: document changes, for human review. Gazette: verified changes. A new chain needs new sources and tests; the MVP takes only the deterministic functions it needs. A source reading *read* does not mean safe, legal for every holder, or backed by reserves the Curb audited.

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

Proposed product API; token amounts are strings of integer base units, never floats:

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

Previews send nothing and prove nothing about success. Access-specific or identity data needs authentication; a public address opens nothing private. Proposed events `PositionMinted`, `ExitAllocated`, `ComponentClaimed`, `MintStatusChanged` and `ComponentClaimStatusChanged` carry series, holder, component, amount and any operator reason. The index is idempotent on chain id, transaction hash and log index, stores block hashes against reorgs, and separates pending, included and confirmed. The contract, not the display index, defines liability.

## 11. Operator authority and incidents

The pilot uses an operator multisig with published roles; quorum and people are decided before the pilot. The Robinhood Chain treasury has them: three signers named by address, 13 September 2026, in the operator policy. An Ethereum series needs its own operator. A per-component claim stop (exploits, balance shortfall) is allowed; it adds operator dependence, may delay withdrawal, and is shown in the series document. A mint-only stop design needs a reviewed decision first.

| Action | Proposed policy |
| --- | --- |
| Stop minting | Fast, with an event and a reason. |
| Resume minting | Evidence the problem is over; a second review. |
| Stop claims of A | A only; only on exploit risk, insufficient bookkeeping or a defined access obligation. |
| Stop claims of B because A has a problem | Not default behaviour. |
| Replace a series component | Not available; needs a new series and the holder's choice. |
| Take backing or alter a holder's rights | Not available. |
| Raise the pilot series fee | Not available in a pilot version with no fee. |
| Upgrade the series implementation | Not available (immutable initial design); a critical bug means stopping affected operations and a reviewed plan. |

Incident order: identify, stop what must stop, preserve evidence, show a specific status, reconcile, decide and test the fix, announce resume or hold. Never write *the issuer is bankrupt* from one reverted transaction. A bad price status does not stop component claims, which are in units. A core contract exploit can hit every series and needs a broader response. Separate claims remove no shared failure of chain, contract, operator keys or common providers.

## 12. Scope and what is deferred

| Stage | What is built | What must be visible |
| --- | --- | --- |
| A — product validation | Narrative, position detail, simulated flow, the two-tokens-in-a-wallet baseline | Benefit, cost and limits understood without a token incentive. |
| B — accounting prototype | Two mock tokens, one series, mint, exit allocation, separate claims, event index | Ledger right normally and under a freeze, donation, failed transfer and reordering. |
| C — compatibility evidence | Canonical addresses, access documents, fork tests of real components at a recorded block | Component assumptions match the version used. |
| D — limited pilot | Reviewed contract, participant access, lot cap, interface and incident procedure | Real funds only if every earlier gate passed. |

Deferred, with no promise of addition: single-stablecoin deposit, automatic routing; cash redemption; dynamic rebalancing; leverage, lending, insurance, bridges; uncurated stock lists; permissionless series; unrestricted receipt transfer; a market for stuck claims; reward tokens; buybacks; governance able to change an old series' backing.

## 13. Gates before real assets

| Gate | Required evidence | Where it stands |
| --- | --- | --- |
| G1 — instrument | Two issuers, one underlying, one chain, canonical identities | A's raw token, both wrappers and B's token read on Ethereum daily, matching the issuers' records; B's broker-dealer and custodian described, not named. Not passed. |
| G2 — rights and access | Review of rights, user categories, contract custody, receipt distribution, exit process | Not done. The access design is a proposed decision record; the review is a person's. Ability to hold is not enough. |
| G3 — components | Static balances, decimals, correct wrapper version, authority, real transfer and claim under test | Fork evidence for both components, including a two-component round trip and T14 (see §17). A split is not on the record. Not passed: eligibility and a reviewed decision remain. |
| G4 — contract | Invariants and adversarial tests pass; independent review; material findings closed | A prototype passes T01–T12, T17, T19, T20, T22–T25 and a fuzz run. No independent review. Not passed. |
| G5 — operations | Reconciliation, index recovery, incident drill, key management, direct claim interface | Shown on a local chain (see §17). Robinhood Chain treasury signers and Safe creation recorded; Ethereum series operator and remaining key-management policy unverified/proposed. Not passed. |
| G6 — economics | Measured formation and exit cost, and user need against the baseline | Execution gas measured on a fork with the real wrapper, no price applied. User need not validated: no interviews held. Not passed. |

Without two eligible issuers on Robinhood Chain, two tokens from one issuer do not meet the thesis; choose a chain that passes the gates or stay in simulation, with no hidden bridge plan. Receipt terms may need their own structure and distribution arrangements; nontransferable or testnet status does not settle every real-asset obligation. This is feasibility work, not a claim of regulatory approval.

## 14. The engineering test plan

| ID | Scenario | What must be shown |
| --- | --- | --- |
| T01 | Normal two-component mint | Exact amounts and receipts; liabilities never exceed balances. |
| T02 | Second component transfer fails | Whole mint reverts. |
| T03 | Exit allocation | Liability unchanged; rights move from active to reserved. |
| T04 | A cannot be transferred | A claim intact; B claimed without calling A. |
| T05 | Double claim or wrong recipient | No double payment or unconsented reassignment. |
| T06 | Mint after pending claims | New depositor gets none of the exit reserve. |
| T07 | Donation, before the first mint and later | No lot, receipt count or entitlement changes. |
| T08 | Component balance below liability | Its nominal claims fail; no race. |
| T09 | Reentrancy, or a token returning false | Rejected or rolled back; ledger right. |
| T10 | Fee-on-transfer or raw rebasing token | Rejected, or the integration gate fails. |
| T11 | Zero supply, reserves still open | A new mint adopts no old claim assets. |
| T12 | Different decimals and integer limits | No overflow, unit mix-up or small-component loss. |
| T13 | Missing or stale price | Rights unchanged; no false complete total. |
| T14 | Corporate action on a real component | Matches the chosen version; no double multiplier. |
| T15 | Upstream implementation or authority change | Detected, re-reviewed; minting can stop. |
| T16 | Reorg, duplicate event, RPC outage | No double balance; index recovers; limitation shown. |
| T17 | Eligibility or recipient change | Receipt transfer refused; claims only to an owner the claim policy admits. |
| T18 | Website or backend down | Contract path works while chain and contract work. |
| T19 | Two components, same address | Deployment refused. |
| T20 | `balanceOf(A)` reverts | Exit allocation and B claims never call A. |
| T21 | Wrapper transfers but unwrap fails | Never shown as a cash exit or underlying recovery. |
| T22 | Repeated burn and mint, reserves unclaimed | Whole-liability cap holds. |
| T23 | Exact deposit over an old shortfall | Backing check refuses. |
| T24 | Alternative mint or burn paths | No admin mint; no public burn bypassing two-component bookkeeping. |
| T25 | Backend down, mint permit expired, claim permit active or revoked | Claims follow on-chain state, no new backend signature; restrictions shown exactly. |

Fuzz and invariant tests vary holders, operation order, the failing component and lot count. The minimum lot must make every `q[i]` a positive integer. Mocks come first; forks check real code, not every future condition.

Status, 12 September 2026: the ledger model runs T01–T08, T11, T12, T19, T22, T23 and T24. The `contracts/` prototype runs T01–T12, T17, T19, T20, T22–T25 and a recorded fuzz run.

- T13: the site's valuation; a missing or stale price is a stated reason, never a zero.
- T14: two Ethereum forks, component A (see §17).
- T15: the daily drift check (code hash, symbol, decimals, `asset()`, EIP-1967 slots), raised as DARK.
- T16: index idempotency and reorg-rollback tests, the local rehearsal, the drill's dead-RPC scenario; T18: its backend-down scenario.
- T21: an Ethereum fork, component A; the wrapper unwraps for an arbitrary holder; its whole reserve was about ten tokens at the block read.

None of this is a review or a public deployment: only a local chain, forks and mocks.

## 15. Validation and the measure of success

**Decided by the product owner, 20 September 2026: the interviews below are not held.** They stay on record for the stop rule and comprehension test. Observed use stands in: desk readers and alert subscriptions paid once the desk is configured. It also shows whether holders keep two tokens once a receipt's cost and risk are in view. The stop rule is read against that use. The risk is carried openly: the position proceeds without asking a prospective user ([the interview guide](docs/decisions/INTERVIEWS.md)).

The plan (**proposed experiment targets**, not benchmarks or research done):

- 10–15 relevant prospective users, holders and a few integrators, asked about past issuer exposure, not about the idea; no token allocation for choosing the product.
- Three costed options in rotated order: one share representation, two in their own wallet, one Curb receipt exactly as the MVP. A tradable or collateralisable receipt is a separate hypothesis.
- Record reasons, task time, misunderstandings, willingness to pay and recurring needs.
- Signals to continue, not proof of product-market fit: at least five show a real operational problem; at least three retest after seeing the added cost and risk; at least one integrator needs the receipt, if integrators are the primary customer.
- Required comprehension test: the share can still fall; a component can get stuck; a brand split does not prove separate custody; the MVP receipt cannot be sent or sold as one token; the Curb promises no cash redemption. Systematic misunderstanding means revising copy and flow before a pilot.

Stop or change the receipt thesis if informed people hold the two tokens themselves. Do the same if added cost and contract risk bring no measurable benefit, or if access rules make the segment too narrow for the chosen business.

## 16. Revenue and the CURB token

The prototype and an early technical pilot may charge no product fee; gas is paid as the flow requires. No fee logic before basic demand is shown; a paid release states its cost in the preview and series document.

| Revenue | Source of value | Condition before it applies |
| --- | --- | --- |
| Position formation fee | Automated component acquisition and forming | A real purchase path; a benefit over doing it yourself. |
| Integration / API fee | Position data, rights, evidence, reconciliation for other applications | Active integrators with recurring need. |
| Operational subscription | Reporting and management of several positions | Tested willingness to pay. |

Assets under management are never equated with transaction volume. Hypothetically, US$1 million of paid volume a month at 0.10% is US$1,000 gross revenue before costs: not a projection, final rate or promise of scale. Spread, gas and issuer fees are not all Curb revenue.

**Three instruments stay apart:** the issuer component (held) and the company receipt (a proportional right to a series' components). The third, CURB, is a candidate token whose need must be proven on its own.

Governance, if ever used, may take proposals on research priorities or new series. No vote changes a balance, takes claim reserves, replaces an old series' components or declares an issuer safe. No basis exists yet for supply, allocation, vesting, buybacks, fee sharing or CURB covering losses, launchpad or not. Positions never depend on a CURB price or a bridge.

CURB's one function is decided (the product owner, 12 September 2026): payment for data services that actually exist, with stated prices, a stated conversion, slippage limits, credit validity and a cancellation policy. It is built (§17; [the token record](/mechanism/decisions/token), [the services page](/services)):

- Dollar prices for the history and fan-out the site keeps; a US$20 opening minimum.
- The credit desk contract moves CURB to a published treasury, emitting the key hash and amount.
- The rate is the pool's own price at a block: a pair's reserves, a v3 square-root price, or v4 state via the StateView. The last is the kind the decided venue produces after graduation. Market capitalisation is price times supply; CURB per dollar is never typed in.
- A top-up gets the lower of its block's rate and the pool's lowest rate in the prior hour. The block rate comes from node state while served, else the pool's events at that block. For a pool that did not yet exist, it is the head, when indexed only. This limits short-spike credit; it is no defence against sustained manipulation or a thin pool.
- Credits do not expire while a service is offered; closure takes thirty days' notice; nothing is refunded.

No token exists; nothing is configured (launch venue: §1). The services and gate were built first.

## 17. First work, and what exists today

Startable now without a token or launch: the instrument candidate file; testing the narrative against the two-tokens-in-a-wallet baseline, begun by the [simulation](/positions/apple-s1); proving the accounting with mocks, begun by the ledger model.

Implemented in this repository as of 12 September 2026, and not:

| Piece | Status | Where to check |
| --- | --- | --- |
| Ledger model (§7) and test cases | Implemented, tested | `lib/positions/ledger.ts`, `tests/positions.test.ts`, the simulation |
| Issuer evidence archive: daily, as received, versioned by canonical fields (D02) | Implemented, on the tick | `/api/positions/apple-s1/evidence` |
| On-chain checks of every evidence address (incl. EIP-1967 slots, multiplier, wrapper conversion); corporate actions seen on activation day; a changed address is DARK drift | Implemented, on the tick | the series page, `/api/positions/apple-s1/evidence` |
| Product network profile, own RPC override; chain id confirmed before any read (D05) | Implemented | `lib/chain/networks.ts`, `lib/chain/rpc.ts` |
| Event codec, idempotent index, reorg rollback, ledger replay (D03) | Implemented, tested against fixtures; no contract to index | `lib/positions/index.ts`, `tests/positions-backend.test.ts` |
| Units owed reconciled against `balanceOf` (D04) | Implemented; only for a configured deployment | `lib/positions/reconcile.ts` |
| Deployed code checked against this repository's build outside the immutable slots (G02's verification procedure) | Implemented; every tick for a configured deployment; a mismatch is DARK; rehearsed locally | `lib/positions/code.ts`, `contracts/evidence/CompanySeries.build.json` |
| Product API (§10) with dated indicative value (§8): A from the wrapper's conversion at a recorded block, B from the issuer page's shares-per-token, against the desk's AAPL / USD sample | Implemented | `/api/positions`, `/api/wallets/…`, `/api/status` |
| Series contract prototype (§7, §9, §11); tests as in §14; seed, results, commit recorded (C07) | Implemented in `contracts/`; unaudited, unreviewed, undeployed | `contracts/src/CompanySeries.sol`, `contracts/test/CompanySeries.t.sol` |
| Ethereum fork tests (C08, G3): A's identity, transfer, round trip, unwrap (T21), derived raw balance, wrapper size; B's (issuer-page address) identity, transfer, round trip with both; authority behind each address (EIP-1967 implementation, admin, beacon, `owner()`, `paused()`) | Implemented; block not pinned (public node); findings shown dated | `contracts/test/fork/`, `contracts/evidence/apple-s1.fork.json`, the series page |
| End-to-end rehearsal: two mock components, the worked example, five events in order, A and B `MATCHED` (T16, T18 in part) | Implemented, repeatable; a local chain, not a public one | `contracts/scripts/rehearsal.ts`, `tests/positions-rehearsal.test.ts` |
| Wallet calls as bytes in previews, once a deployment is configured | Implemented; simulated locally against the real contract; the site holds no key, sends nothing | `lib/positions/calldata.ts`, `/api/positions/apple-s1/preview-mint` |
| "My position" (§6): read-only lookup by address; claims kept apart from receipts | Implemented | the series page, `/api/wallets/<address>/…` |
| "Form position" and "Claim components" (§6, U03, U04): one wallet transaction per step, wrong chain refused, receipt read after mining | Implemented for a deployed series; rehearsed locally with a stand-in wallet (approve, approve, mint, allocate, claim A, claim B) | `app/components/wallet-sign.tsx`, the series page when `CURB_SERIES_DEPLOYMENTS` is set |
| The Gazette: verified changes by day (§9), never a second record | Implemented | `/gazette/<day>`, `lib/positions/journal.ts` |
| Operational drill (O02): freeze of A, shortfall of A, backend down, RPC failure, lost source; 2-of-3 quorum (stop and resume each need two signatures; the former single key refused); nobody paged, nothing recovered | Implemented, repeatable; a local chain with mock components | `contracts/scripts/drill.ts`, `tests/positions-drill.test.ts`, `contracts/evidence/drill-local.json`, the series page |
| Execution gas per operation, real wrapper as A (B01's input; no price applied) | Implemented, dated with the fork block | `contracts/evidence/apple-s1.fork.json`, the series page |
| T14 (see §14): forks before and at the multiplier activation, block 25,706,680 (8 August 2026 00:30 UTC; found by binary search of `multiplier()`); multiplier +0.0603%, wrapper shares unchanged, raw balance moved, conversion rate equal to the multiplier on both sides | Implemented, recorded in `contracts/evidence/apple-s1.corporate-action.json`; a split is not on the record | `contracts/test/fork/AppleCorporateActionFork.t.sol`, the series page |
| T13 on the site side (see §8); T18 against a public chain | T13 covered by the valuation and its tests; T18 needs a deployment | `tests/positions-valuation.test.ts` |
| Independent review and audit of the contract | Not started | — |
| Drift and evidence changes as conditions and alerts (T15) | Implemented | `/api/state` → `conditions`, the webhook |
| Instrument file from archive and chain (R01, the automatable half) | Implemented | `/api/positions/apple-s1/file` |
| Issuer documents watched by visible-text hash (13 pages) | Implemented, on the tick | the series page, `/api/positions/apple-s1/evidence` |
| Related-party map (R02), each line sourced and dated; unnamed roles left empty; no party under both components; no independence claimed | Implemented from the issuers' documents as read on 12 September 2026; pages watched | the series page, `lib/positions/dependencies.ts`, `/api/positions/apple-s1/file` |
| Decision records (R03, R05, R06): immutable series, nontransferable receipt, on-chain access, per-component stops, no sweep and claims to the holder, lots and cap; operator policy (O01), runbook (O03) | Series ADRs and remaining operator policy proposed; treasury signers recorded separately; each names who decides | [/mechanism/decisions](/mechanism/decisions), `docs/decisions/` |
| Cost comparison against the baseline (B01): round-trip gas with both real components; gas and ETH prices left variable | A proposal with measured inputs; no price applied | [/mechanism/decisions/costs](/mechanism/decisions/costs) |
| Deployment plan (G02); its tool refuses an unreviewed record, the wrong chain or a missing key | A proposal; the tool exists and refuses; rehearsed locally, nothing sent to a public chain | [/mechanism/decisions/deployment](/mechanism/decisions/deployment), `contracts/scripts/deploy-series.ts` |
| Invariant tests: five invariants over 256 sequences of depth 64; seed, runs, results recorded | Implemented | `contracts/test/CompanySeries.invariant.t.sol`, `contracts/evidence/unit-tests.json` |
| Assumption register (§19), a self-review that is not a review (C09), interview guide and comprehension test (R04, B02) | Written; conservative assumptions, none stated as fact | [/mechanism/decisions](/mechanism/decisions) |
| The token's one function (§16): credit desk contract (nothing held, no admin; fifteen tests); pool-event pricing once node state is gone (Robinhood Chain's public node keeps ten minutes, measured); keys by hash; paid endpoints (evidence versions, journal by day, webhook delivery) admitted, answered, then charged; code and treasury verified every tick; receipts, conditions, deployment tool, services page, the Gazette's daily receipts; the operator's Safe planned unsigned and simulated on Robinhood Chain, quorum (approve the hash, execute) rehearsed with Safe's own code; plain ERC-20 as launch condition. Local rehearsal: mock token and pool, two top-ups at two prices | Implemented; the record decided by the product owner on 12 September 2026 (prices, terms, proceeds, order of work, Robinhood Chain); no token exists; NOT_CONFIGURED in production | [/services](/services), [/mechanism/decisions/token](/mechanism/decisions/token), `contracts/src/CreditDesk.sol`, `lib/credits/` |
| User interviews (R04), comprehension tests (B02), the gate decision (G01), the independent review (C09) | Interviews: not held, by decision (20 September 2026); observed use stands in — see §15. The rest: not done — people; the assumption register says what is assumed meanwhile | [/mechanism/decisions/assumptions](/mechanism/decisions/assumptions) |
| Any deployment, any real asset | None. `/api/status` says NOT_DEPLOYED | — |

The Ondo API source records `ACCESS_DENIED`: its documented endpoint needs an API key the desk lacks, archived as the finding. B's candidate address comes from the issuer's own product page, which publishes per-network deployments and is archived and verified on chain daily. The example address in Ondo's API specification is never a source.

## 18. Questions people ask

**Is one receipt one share?** No; it is one lot of the series' components (§5).

**Do I receive cash dividends?** None is promised (§8).

**Are the weights always 50:50?** No; units are fixed, value weights move (§7).

**Can the early receipt be sold or sent?** Not in the proposed MVP; transfer and other integrations are not available.

**What happens when one token halts?** The other component can still be claimed; recovery of the halted one is not promised (§6).

**Why not hold the two tokens myself?** A valid alternative; the Curb must prove it is worth the added cost and contract risk (§4).

**Do I have to buy CURB?** Not for the proposed MVP; positions never need it (§16).

## 19. Assumptions and open decisions

| ID | Assumption or decision | How it is settled | If it fails |
| --- | --- | --- | --- |
| A01 | Two compatible components for Apple on one chain | Verify addresses, code, rights; integration tests | Change candidate or do not pilot. |
| A02 | An issuer split that users find useful | Dependency map and observed use (interviews not held, by decision of 20 September 2026 — see §15) | Reduce the claimed benefit or change the proposition. |
| A03 | A receipt adds value over two tokens in a wallet | Cost and task experiments | Stop the receipt thesis, or test a no-custody position service. |
| A04 | Component units are static | Code and version review; fork tests of corporate actions | Exclude the component; never patch with an assumed formula. |
| A05 | Vault and receipt use fits the intended access | Instrument and distribution review | Stay on mocks, forks and a local chain until clear. |
| A06 | Costs are acceptable | Measure gas, spread, issuer fees and willingness to pay | Change segment, flow, or stop. |
| A07 | A pilot can run with enough control | Independent review, drills, key management, gates | Do not run a real-funds pilot. |
| A08 | The main token has a service need | Test real service customers | Never make the token a condition of the product. |

Status on 12 September 2026 and interim assumptions: [the assumption register](/mechanism/decisions/assumptions). A01: rights not reviewed (see G1, G3). A04: one dividend activation, no split. A06: willingness to pay not measured. A02, A03, A05, A07, A08: open, on the conservative assumption (hold, unreviewed, not eligible until an issuer says so, no configured token/credit desk). Treasury signers: see §11; the Ethereum series operator: see G5.

Production decisions left blank on purpose:

- final component pair, wrapper version and hash, final chain;
- `q[i]`, minimum lot, total pilot lot cap;
- participants and eligibility, operator quorum, auditor or reviewer;
- deployment addresses, fees, launch date. With results, each gate gets a commit link, contract version, test block, results, review date and decision owner.

Public copy separates the position prototype and simulation from the treasury mainnet record, and calls nothing available before it is. The stage moved to *mainnet* on 13 September 2026 because the treasury is on chain; copy says in the same breath that the token, the desk and the series are not.
