# The Curb — mainnet preparation dossier

Prepared 13 September 2026 from the local repository. **Status: PREPARATION; release and external signoffs pending.** This dossier turns the remaining product, reviewer, instrument and operating work into materials that can be completed and reviewed. It records no interview responses, issuer consent, independent review, funding commitment, public transaction or production verification. Blank fields mean **not supplied**, never approved by default.

Read this with [the remaining-work inventory](../reviews/REMAINING-WORK-2026-09-13.md), [the first-release evidence](../reviews/FIRST-RELEASE-2026-09-13.md), [deployment procedure](../decisions/DEPLOYMENT.md), [token decisions](../decisions/TOKEN.md) and [operator policy](../decisions/OPERATIONS.md). The inventory is a dated audit; subsequent implementation evidence belongs to the release being reviewed. This dossier is a working package, not a substitute for those evidence records.

The release evidence for this preparation belongs in [MAINNET-PREPARATION-2026-09-13.md](../reviews/MAINNET-PREPARATION-2026-09-13.md). The offline `npm run mainnet:preflight` command checks the release/evidence manifest against [readiness.example.json](readiness.example.json). It checks file digests and record completeness, leaves missing evidence HELD, and never grants deployment authorization. It does not call a live chain, authenticate a reviewer's independence or turn filled-in text into an issuer's consent.

**Source pinned during preparation:** `64870f116a02fa44fda1dfc4a67dcb9ac4aa15bf`. CompanySeries was re-recorded from this clean source (`workingTreeClean: true`, 6,693 runtime bytes); the fresh CompanySeries and CreditDesk build checks passed. See [clean-build-record.json](../reviews/mainnet-evidence/clean-build-record.json). This records source/build provenance, not reviewer acceptance or public deployment. Earlier dirty-source rehearsal evidence remains historical and must not be mistaken for the current clean build record.

**Fork evidence refreshed during preparation:** 14 fork tests passed: 13 component tests at Ethereum block **25,967,875**, plus one rerun across the historical dividend activation at blocks **25,706,679/25,706,680**. See `contracts/evidence/mainnet-prep-apple-components-fork.txt`, `apple-s1.fork.json` and `apple-s1.corporate-action.json`. This is local execution against forked state, not a public deployment. It establishes neither stock-split behaviour nor holder eligibility, acquisition/issuance access, reserves or future corporate-action behaviour. The [gas worksheet](../decisions/COSTS.md) now uses that new component run, excluding unmeasured approvals and transaction overhead.

## Release scope and decision sequence

The existing product decisions remain: positions deposit and return the component tokens; CURB pays for data services on Robinhood Chain (4663). A key opens after **US$20 cumulative funding**, retained as spendable credits; evidence-history/journal calls cost **US$0.05**, and successful chargeable webhook deliveries cost **US$0.10**. There is no position dependency on CURB, no fee sharing, no buyback and no promised recovery of lost keys. Public terms must describe the actual no-refund, notice and conversion behaviour.

The candidate position lives on **Ethereum (1)**. Its G1–G6 are not passed in the reviewed local records; G2 rights/access is NOT_STARTED. The recorded 2-of-3 Robinhood treasury is a separate chain and role. Do not copy its address into the Ethereum operator record without Ethereum evidence.

| Decision | Required evidence before the decision | Decision / owner / date / evidence |
| --- | --- | --- |
| Release the website/application changes | Reviewable diff; final source/build provenance; relevant passing checks; staging/rollback/config plan; status copy matches evidence | NOT RECORDED / — / — / — |
| Launch a token | Prelaunch review/terms scope complete; named launchpad mechanics; disclosures and allocation/vesting; funded prerequisite work; budget formula; treasury verification | NOT RECORDED / — / — / — |
| Deploy CreditDesk | Actual token facts; reviewed token transfer/admin behaviour; reviewed immutable contract/build and record; correct-chain treasury | NOT RECORDED / — / — / — |
| Invite public top-ups | Deployed verified desk; supported pool with reviewed quote/liquidity assumptions; current code/config/rate readiness; authorized small payment reconciled end to end; truthful terms | NOT RECORDED / — / — / — |
| Open paid beta | Above plus tested billing/store/webhooks, measured service budget/capacity, on-call/monitor/backup, participant scope and success/hold criteria | NOT RECORDED / — / — / — |
| Deploy/open a position pilot | G1–G6 evidence and recorded decisions; eligible participants/acquisition; approved lots/cap; reviewed contract; verified Ethereum Safe and operating policy | NOT RECORDED / — / — / — |

Preparation can proceed in parallel: source fixes and isolated tests; interviews; issuer/acquisition inquiries; independent-review scoping; economics and operator assignments. Public payments, contract deployment and participant permits occur only under the applicable completed decision and actual authorization. No record here supplies a signature or authorization.

### Release record to complete

```text
Release identifier:
Source commit (clean; no placeholder attribution):
Source/build hashes and compiler settings:
Website artifact/deployment identifier:
Target scope: website / token / CreditDesk / paid beta / position pilot
Reviewed configuration file + hash:
Database migration version and rollback/compatibility check:
Test evidence (environment, source, time, pass/fail/skip):
Independent review report and unresolved finding disposition:
Operator/reviewer names and actual signoff date:
Approved next action and spending/participant limit, if any:
Post-action verification owner and evidence location:
Rollback/hold criteria and responsible operator:
```

A local build recorded with a dirty-source allowance is rehearsal evidence. Regenerate the recorded production build from the selected clean source and check its provenance before public deployment. Previous passing tests are not automatically results for a later contract or compiler change.

## Product-owner decisions to complete

| ID | Concrete choice/input needed | Prepared default or constraint | Recorded answer |
| --- | --- | --- | --- |
| D01 | Which launchpad/product and official terms/version? | Public sources identify ponsfamily.com as the best match; v1/v2 must be distinguished | **Decided by the product owner, 17 September 2026: PONS v2** (ponsfamily.com, Pons Labs, LLC; factory `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` on Robinhood Chain), whose terms and mechanics were then read from primary sources and the chain — [the PONS v2 facts read on 16–17 September](EXTERNAL-FACTS-2026-09-17-PONS-V2.md): public launching open on chain (`launchEnabled()` true; `canLaunch(<the operator's Safe>)` true), launch fee 0.0005 ETH, a 1% trade fee on the curve and on the pool (30% to the venue, 70% to the creator; no creator tax, no buyback — the token record), no creator allocation (the whole supply to the curve), graduation at 4.2 ETH of net buys into a Uniswap v4 pool (fee 0, tick spacing 200, the venue's hook) with the position locked; the token is a plain ERC-20 with no mint, pause, blacklist, tax or upgrade. **Still open before a launch (the dossier's open questions):** the pairing asset (native ETH or USDG), the Terms of Use §11 and §3 reading by counsel, who signs the launch, and that the venue is unaudited by its own statement. The desk's price reader must gain a v4 source first — [the specification](V4-READER-SPEC-2026-09-17.md). |
| D02 | Who funds review/legal work needed before launch, and when? | Treat it as unfunded until a real funding commitment exists; later proceeds cannot pay an earlier prerequisite without bridge funding | **Unfunded, and said so** — the product owner, 17 September 2026, choosing among the prepared options on the recommendation put to them: the `CreditDesk` review (forty lines) is quoted first (D04) and the product owner decides its funding against that quote; the `CompanySeries` review waits for the position pilot's own gate. No proceeds of a later launch pay for either. Every phase stays HELD until a commitment is recorded here with an amount and a date. |
| D03 | What exact proceeds formula implements the decided priorities? | Residual-pool formula below; planning arithmetic, no spending authority | **Confirmed by the product owner, 17 September 2026, choosing among the prepared options on the recommendation put to them** as the reading of the split decided on 12 September: the first US$40,000 to review and the next USResidual-pool formula below; planning arithmetic, no spending authority5,000 to legal, then 40/20/20/20 of what remains, rounding down to cents with the remainder to reserve — each cent allocated once. A clarification of a decided term, not a change: no notice period starts. Code and tests in `lib/release/budget.ts`. |
| D04 | Which independent reviewers, scope, fee and delivery evidence? | Reviewer brief below; reviewer names are unassigned | — |
| D05 | Which first users, experiment budget and beta capacity? | Interview recruitment targets below are proposals, not customers or PMF | **Decided by the product owner, 17 September 2026, choosing among the prepared options on the recommendation put to them: the first users are three data integrators** — people who would pay for the desk's history and fan-out over the API — recruited before any position-holder interviews; the beta capacity is three keys, and the experiment budget is nil beyond the operator's own time until D02 is funded. The ten to fifteen position-holder conversations (R04) follow, not precede, the desk's first paying use. |
| D06 | Ethereum operator Safe, actual signers, quorum and review? | Minimum-two quorum with the policy's proposed three signers; independently verify the target chain and Safe controls | **Deferred by the product owner, 17 September 2026, choosing among the prepared options on the recommendation put to them** until the desk sells and gates G1–G6 have evidence: an Ethereum Safe is created only when a series is ready to deploy, with the three signers of the operator policy and a quorum of two. Nothing is prepared on Ethereum before then. |
| D07 | Approved position assets, qA/qB/cap and eligibility process? | Keep illustrative Mock A/B values out of a public configuration; use acquisition/rights/cost evidence | **Deferred by the product owner, 17 September 2026, choosing among the prepared options on the recommendation put to them** for the same reason as D06: no asset, unit or cap is approved until the issuers have answered on eligibility (A3) and acquisition (A7). The illustrative values stay illustrative and out of any configuration. |
| D08 | Operating owner, responders, RTO/RPO, notice and reserve budget? | Assign named people and achievable targets; no response service level is promised here | **Decided by the product owner, 17 September 2026, choosing among the prepared options on the recommendation put to them: the operating owner is the product owner**, first responder to the Discord alert channel, with a second signer of the operator Safe as backup; response target within 24 hours, no faster level promised. **RPO up to seven days** — the store's only off-platform copy is the weekly encrypted dump (DEPLOY.md §1); Railway's continuous backup is off and would shorten this when enabled. **RTO about one hour** — a restore from the artifact by the documented commands. Notice for a change of decided terms stays thirty days. **Reserve budget: none identified**; the 20% reserve of proceeds exists only once proceeds do. |
| D09 | How are reviewed terms applied to closure, unspent credits and reorg deficits? | Preserve current decided terms until a recorded change; ask reviewer to assess implementation and obligations | **Decided by the product owner, 17 September 2026, choosing among the prepared options on the recommendation put to them: the decided terms stand unchanged** — credits keep their dollar value, a closure or an expiry is a change of a decided term with thirty days' notice, and a reorg deficit is the desk's loss, never a claw-back from a key. The reviewer chosen in D04 is asked to assess whether the implementation and the operator's obligations match these words; a finding there is answered by a recorded change, not a quiet one. |

Record who chose, date, rationale, evidence and effects on notices for every decision. An existing decided price is not reopened just because a worksheet has empty cost inputs.

### Launchpad and actual-token worksheet

Complete the prelaunch column from primary official documents and the actual contract design. Complete the post-deployment column with chain/block/hash evidence. A marketing page alone is not a code audit; a chain getter alone is not a complete description of participant terms.

| Item | Prelaunch evidence / finding / owner | Actual-chain evidence / finding / block |
| --- | --- | --- |
| Platform/product identity, official URL, terms version/date | — | — |
| Target chain and chain ID, eligibility and offering/distribution terms | — | — |
| ERC-20 implementation, supply method/cap, mint/admin powers | — | — |
| Transfer fee/tax, rebasing, pause, blacklist, proxy/upgrade controls | — | — |
| Creator allocation, beneficiaries, vesting, unlocks and control | — | — |
| Gross receipts, fee calculation, net settlement asset and recipient | — | — |
| Bonding curve and graduation conditions; pool creation mechanism | — | — |
| Pair/pool interface, fee tier, token order, quote asset and liquidity control | — | — |
| Pool creation block, quote/feed assumptions and rate-reader compatibility | — | — |
| Cancellation/failure conditions and purchaser disclosures | — | — |
| Deployed addresses, code/source verification and governance match | — | — |
| Decision: compatible / change required / hold, with reviewer rationale | — | — |

## Independent review brief

**Assignment to be commissioned:** review the selected release of CompanySeries, CreditDesk, component assumptions and the services that account for credits. Produce findings with a source reference, exploit/failure scenario, severity, remediation and retest outcome. State exclusions explicitly. No independent reviewer has been appointed in this dossier.

Inputs prepared in the repository:

- [CompanySeries](../../contracts/src/CompanySeries.sol), [CreditDesk](../../contracts/src/CreditDesk.sol), tests, invariant handler, deployment/calldata tools and recorded build provenance.
- [Historical self-review](../decisions/REVIEW.md), advisory static-analysis findings, local/fork evidence and their stated limitations.
- [Mechanism](../../MECHANISM.md), ADR-001–006, [operations](../decisions/OPERATIONS.md), [runbook](../decisions/RUNBOOK.md), [costs](../decisions/COSTS.md) and rights/acquisition worksheets below.
- `lib/credits/`, the store and paid endpoints: rate identity/freshness, conservative pricing guard, confirmation/reorg indexing, request admission, atomic debit and ambiguous-acknowledgement recovery, receipts and webhook settlement.

Review these concrete properties:

1. **Position accounting:** fixed integer units, cap including reserved claims, exact transfer deltas, component independence, shortfall fairness, permits, pause scope, nontransferable receipts, no sweep/reassignment, abnormal token behaviour and reentrancy.
2. **Operator changes:** nomination retains current authority; only nominee accepts; cancellation/replacement clears the intended pending state; Safe-to-Safe acceptance works; old authority ends only on acceptance; required events/index behaviour are accounted for.
3. **Deployment identity:** correct chain, reviewed source/build, constructor/immutable values, component identity, Safe proxy/singleton/owners/quorum; review modules, guards, fallback handler and ability of actual signers to execute. The checker does not prove all governance properties merely by reading a Safe-looking interface.
4. **Component dependencies:** proxy implementations/admins, wrapper asset and units, issuance/redemption and corporate-action assumptions. Fork transfer/unwrap observations do not establish eligibility, acquisition, reserves or complete corporate-action coverage.
5. **CreditDesk/token:** exact treasury balance delta, malicious token paths, immutable routing, absence of refund/pause, mutable-token risks and distinction between removing a UI invitation and stopping direct top-ups.
6. **Price/index/ledger:** stale or unread evidence fails closed; current code and config identity agree; quote limitations are disclosed; manipulated/thin-liquidity/quiet-window pricing; historical-block availability; reorg rollback; concurrency/idempotency; UNKNOWN commit settlement; isolation of one user's credit records.
7. **Web surfaces and operation:** key secrecy, logging/redaction, auth, webhook SSRF and delivery acknowledgement, store failures, scheduler/monitor independence, backups/restores, migrations and production release controls.

### Finding register

The initial rows describe tasks/risks, not externally assigned audit severities. Replace `UNASSESSED` only with the reviewer's actual assessment. A remediation marked local remains open for independent retest and release acceptance.

| ID | Finding / question | Current disposition | Severity | Owner / report / retest / accepted by |
| --- | --- | --- | --- | --- |
| RV01 | One-step operator transfer could immediately lose authority | Local two-step remediation prepared; independent retest pending | UNASSESSED | — |
| RV02 | Public series operator requires target-chain Safe evidence | Local checker prepared; actual Ethereum record absent | UNASSESSED | — |
| RV03 | Candidate issuer eligibility and receipt structure unresolved | Requires named issuer/legal evidence; G2 stays unpassed | UNASSESSED | — |
| RV04 | Acquisition/current-wrapper issuance and split behaviour unproven | Fork observations retained with limits; complete worksheet below | UNASSESSED | — |
| RV05 | Short-window pool guard cannot establish manipulation immunity | Review actual liquidity/quote model and choose acceptable operating limits | UNASSESSED | — |
| RV06 | Credit/store partial failures and uncertain debit settlement | Include final source regressions, Postgres and full HTTP rehearsal evidence | UNASSESSED | — |
| RV07 | Safe and token can have controls beyond obvious getters | Review source/config/modules/admin powers and signer control | UNASSESSED | — |
| RV08 | Terms, unfunded prerequisite review and proceeds accounting | Product/legal/finance decisions required; no invented approval | UNASSESSED | — |

Reviewer deliverable fields: reviewer identity/independence; exact source and configuration; methods and execution environment; exclusions; complete issue list; material finding closure evidence; residual risks; permitted release scope if any; signature/date. The product and gate owners record their own decision after receiving the report.

## Issuer eligibility and acquisition questionnaire

Prepare **separate answers for A's current wrapper/raw issuer and B's issuer**. These are questions for verified issuer documentation and qualified review, not legal conclusions. Keep original response/source, publication or response date, terms version, reviewer and applicable jurisdiction/account type with every answer. Do not put participant personal documents in this repository.

### Structure to describe consistently

One immutable Ethereum contract holds fixed quantities of two candidate tokens for each whole, nontransferable receipt lot. A participant deposits both tokens in kind. Exit burns lots and records separate component claims; each component pays to the holder's own address only. Mint and claim permissions are on chain. The operator can pause defined actions; it cannot swap components, sweep backing or redirect a holder's claim. A permit revocation does not erase existing claims or prevent allocation for exit. A lost private key cannot be recovered by this contract. Provide the actual reviewed addresses and q/cap when decided; the Mock A/B simulator is not the production configuration.

### Questions and requested evidence

| ID | Question to answer for each issuer | Evidence needed / answer |
| --- | --- | --- |
| E01 | What legal instrument does the exact token represent; which entity owes which rights to whom? | Terms/version, named entity and applicable rights — |
| E02 | Who may acquire, hold, transfer and redeem it, by jurisdiction/investor/account category? | Rule and effective date; acquisition and secondary holding may differ — |
| E03 | May this described series contract hold it, and who is treated as holder/beneficial owner? | Written application of the rules to this structure — |
| E04 | Do nontransferable receipt issuance and per-component claims create additional permission or distribution requirements? | Scope-specific written answer/review — |
| E05 | Are each participant and receiving address eligible for both deposit and eventual claim? | Verification process, expiry, renewal and consent requirements — |
| E06 | Can an issuer/admin freeze the contract or a holder, seize, blacklist or upgrade token behaviour? | Relevant controls, decision authority, notices and exit implications — |
| E07 | What happens when a previously eligible participant loses access or a claim permit is revoked? | Process for remediation/payment; no invented alternate recipient or recovery — |
| E08 | What is the permitted path to acquire raw A, wrap through the current wrapper, and acquire B at pilot size? | Venue/issuer/account route, limits, settlement, minimums and fees — |
| E09 | What exact role do issuer, custodian, broker/dealer, trustee and administrator have? Are parties shared? | Names and sourced dependency map; leave undisclosed names unknown — |
| E10 | How do dividends, splits, mergers, delistings, redemption suspension and wrapper migration affect units and rights? | Rule plus available historical events; simulation labelled separately — |
| E11 | What termination/redemption routes remain if primary access or this series closes? | Holder-specific route, limits and rights; distinguish transfer, unwrap, market sale and issuer redemption — |
| E12 | Can the answer be relied upon for the chosen entity, participant cohort, contract version and date? | Scope, contact role, expiry/reverification triggers and reviewer finding — |

Record conclusion separately for A and B: `UNANSWERED / ALLOWED WITH CONDITIONS / NOT ALLOWED / INSUFFICIENT EVIDENCE`, with exact conditions and supporting source. Those are worksheet labels, not automatic gate outcomes.

### Acquisition experiment record

Begin with read-only chain/source checks and an isolated fork. A fork balance staged by storage is useful for transfer tests and must be recorded as such. It does not demonstrate purchasing access or new issuance. Any real acquisition/payment requires its own permitted account and authorization.

```text
Experiment ID / date / engineer / reviewer:
Mode: read-only / isolated fork / local mock / authorized public transaction
Chain and block; RPC/archive capability (no secret URL in public evidence):
Raw A / current wrapper A / B addresses; issuer publication references:
Proxy/implementation/admin/beacon facts and source-review scope:
asset(), decimals(), share conversion at requested quantity:
Existing inventory and supply (dated; not treated as issuance capacity):
maxDeposit/maxMint or actual equivalent limits; receiver/account queried:
Eligible source of raw A and B; venue/issuer route; required account access:
Amount quoted / available / actually acquired; settlement and expiry:
Wrapper deposit/mint simulation or authorized tx; rounding and shares received:
B acquisition simulation or authorized tx; exact units received:
Costs: approvals, trade/spread, wrapping, network fees, issuer-route fees:
Minimum viable lot and sustainable pilot capacity implied by evidence:
Independent transfer, unwind and exit-route evidence:
Failures/unknowns, what was staged, and what this experiment does not prove:
Evidence links/hashes and recommended G1/G3/G6 decision:
```

## Interview scorecards

### Position users — target 10–15 original interviews

Use [INTERVIEWS.md](../decisions/INTERVIEWS.md)'s sequence with existing stock-token holders. Show the baseline of two tokens in a wallet, then the **Mock A/B** simulator with example quantities explicitly labelled. Show dated measured costs with missing inputs stated. Keep the stimulus/version constant within a cohort; record any change before interpreting results. Do not reward favorable answers or treat token ownership as stronger evidence of need.

Copy this record per participant using a private participant ID; keep consent/contact data separately:

```text
Participant ID / interview date / interviewer / consent reference:
Segment; actual tokens, chains and issuer routes used:
Latest real task/halt/exit example (original words):
Baseline currently used; actual cost/time and source of the estimate:
Problem identified before seeing The Curb; frequency and consequence:
Stimulus version; Mock labels and dated cost inputs shown:
Receipt explanation: correct / partly / incorrect; verbatim answer:
A halts, B claim: correct / incorrect; answer and caveats understood:
Receipt transferability: correct / incorrect:
Unassisted written test: deposit / lot / transfer / exit / one-component halt:
Score __ / 5; assistance or ambiguity, if any:
Choice after costs/constraints: baseline / Curb / neither / undecided:
Concrete reason; willingness to retry and task they would use it for:
Willingness to pay (amount, unit, conditions), without a leading prompt:
Objections, misunderstanding, failure points and requested changes:
Follow-up commitment observed (not only stated enthusiasm):
Evidence location; interviewer interpretation labelled separately:
```

Preserve both positive and negative responses. The existing early-signal proposal is at least five people with a real problem and three willing to try again after understanding costs/constraints; if integrators are the target, at least one concrete integrator use case. These are exploratory thresholds, not PMF. The guide's comprehension pass is five of five; report the denominator and failures. Before the cohort begins, record the sample, test version and continue/change/hold thresholds so they are not adjusted after results arrive.

### Data integrators — proposed target 3–5 task-based sessions

Test paid evidence versions, daily journal and webhook delivery as their own offer. A desire for the position product does not establish demand for these services. Let the integrator attempt one genuine application task on isolated test data, using the current documented API; do not require a live token payment just to test demand.

```text
Integrator ID / role / existing application / date / consent reference:
Current data source and actual task the service would replace or enable:
Required endpoint/history range/schema/freshness/delivery semantics:
Test task and definition of success before the session:
Time to first correct response or webhook; errors and assistance required:
Output used by their application; evidence of a completed integration:
Expected monthly calls/deliveries and acceptable reliability:
Response to decided $0.05/call, $0.10/successful delivery, $20 retained minimum:
CURB conversion/key/no-refund/notice constraints understood; objections:
Repeat-use evidence or scheduled next task (with permission to follow up):
Alternative chosen if rejected and reason:
Result: completed / incomplete / rejected; evidence; next decision:
```

Recruitment, outreach and follow-up messages are not sent by this dossier. Record only actual sessions and consented follow-ups.

## Economics and proceeds

### Service unit economics worksheet

Use dated bills, metering or reproducible isolated-load measurements. The low/base/high columns are **scenarios to fill**, not forecasts. Record vendor tier, included usage, marginal charges, currency, conversion date and whether tax/support costs are included. Account status and current vendor terms have not been checked by this package.

| Input/output per month | Low volume | Base volume | High volume | Source / date / owner |
| --- | ---: | ---: | ---: | --- |
| Successful chargeable history/journal calls H | — | — | — | — |
| Successful chargeable webhook deliveries W | — | — | — | — |
| RPC requests/compute and archive/log paging | — | — | — | — |
| Database writes/reads/storage/egress | — | — | — | — |
| Hosting execution, logging, monitoring and backup | — | — | — | — |
| Webhook attempts/retries, compute and bandwidth | — | — | — | — |
| Shared operations/support/reviewer allocation | — | — | — | — |
| Cost of failed/uncharged requests and retries | — | — | — | — |
| Credit usage value: 0.05 × H + 0.10 × W USD | — | — | — | Calculated from recorded usage |
| Measured service cost USD | — | — | — | Sum without double-counting shared cost |
| Contribution before separately stated overhead | — | — | — | Usage value less included delivery costs |
| Peak latency/error rate/backlog/capacity | — | — | — | Measurement, not a volume extrapolation |

Track prepaid credits separately from token inventory and earned service usage. Operational reconciliation: `opening unspent credits + credited top-ups − charged service use − credits reversed for reorg = closing ledger balance`, with each component sourced from the ledger and any negative balance/deficit shown explicitly. Legal/accounting classification of customer obligations requires the relevant review; a token transfer is not automatically earned service revenue.

Cash/asset resilience worksheet: treasury CURB units and other assets by chain; dated realizable value and liquidity assumptions; remaining service obligation; budget to serve outstanding credits; costs due before new receipts; service capacity and reserve. Stress **hypothetical** CURB price falls of 50%, 90% and 100%, as well as no new top-ups, higher RPC prices and a prolonged rate outage. Do not treat market capitalization as spendable treasury funds, assume all inventory can be sold at spot, or change old credited dollars because CURB falls.

Record the beta's approved participant count, per-key/use limits, monthly operating budget, minimum reserve, hold triggers and person authorized to pause invitations. Those fields remain unset; no arbitrary capacity or service-level promise is established here.

### Position complete-cost worksheet

Use [COSTS.md](../decisions/COSTS.md)'s dated fork subtotal only as a starting input. For the chosen lot and participant route, measure: acquiring A/B, two approvals if needed, current-wrapper mint/deposit, series mint, allocation, independent claims, optional unwrap/sale/issuer redemption, gas base/calldata/cold-access costs, spreads, issuer/venue fees, time and failed/replaced transaction costs. Compare the identical start/end holdings with the two-token-wallet baseline. Record ETH/gas and any token-value inputs at a dated block; label estimates and include what cannot be priced. No cost claim or production lot/cap is approved by the simulator.

### Selected planning proceeds waterfall — decision D03

This residual interpretation was selected on **15 September 2026** under the owner's instruction to choose reasonable implementation details and is recorded in TOKEN. Let **N** be non-negative, freely available treasury proceeds actually settled, valued in USD under a recorded conversion convention, after documented deductions. Exclude bonding-curve reserves, locked liquidity, market capitalization, trading volume and customer credit funding. List each deduction once; actual tax, gas, fees and settlement treatment still require evidence. No proceeds amount or funding commitment is predicted.

1. Priority review bucket `P1 = min(N, 40,000)`.
2. Priority legal bucket `P2 = min(max(N − P1, 0), 15,000)`.
3. Residual pool `R = N − P1 − P2`.
4. Planning budgets: review `P1 + 0.40R`; legal `P2 + 0.20R`; infrastructure/data `0.20R`; unallocated reserve `0.20R`.

| Illustrative N (USD) | Review budget | Legal budget | Infrastructure/data | Reserve | Total |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 0 | 0 | 0 | 0 | 0 |
| 10,000 | 10,000 | 0 | 0 | 0 | 10,000 |
| 55,000 | 40,000 | 15,000 | 0 | 0 | 55,000 |
| 100,000 | 58,000 | 24,000 | 9,000 | 9,000 | 100,000 |

Each dollar belongs to one bucket. Low proceeds leave operations unfunded; a separately evidenced operating budget is required before paid-service commitments. A budget is not proof of payment or adequate reviewer scope. The implementation rounds the first three buckets down to cents and puts the rounding remainder in reserve. Run `npm run mainnet:budget -- path/to/input.json`; [budget.example.json](budget.example.json) defaults to zero funds and unknown costs. USD micros permit sub-cent unit costs; all attempts incur the supplied unit cost, while only calls and deliveries with confirmed charges contribute usage revenue. A successful delivery whose debit failed is not revenue. These are input scenarios, not observed costs or users.

### Unfunded prelaunch review decision — D02

The current sequence requires review before launch; future launch proceeds do not supply cash before they exist. Prepare these alternatives for a real decision: owner/other bridge funding under disclosed terms; a separately funded scoped prerequisite review with later broader work clearly gated; or hold launch until funding is available. A narrower review cannot be relabelled as a complete audit or used to bypass a prerequisite. No funder, quote, reimbursement right or commitment is supplied here.

```text
Review/legal scope required before each milestone:
Actual reviewer quote, currency, payment dates and deliverables:
Named funding source, amount available and evidence (private where needed):
Funding terms; whether reimbursement is allowed and from which approved bucket:
Conflicts/disclosures and reviewer independence:
Decision: funded and proceed to commissioning / hold / revise scope and gate:
Product owner / finance reviewer / date / evidence:
```

### Treasury and proceeds ledger template

Keep launch receipts, credit top-ups, service usage and treasury spending as different entry kinds. The site's credited-top-up receipts do not establish review invoices paid or compliance with the launch budget. Prepare a CSV/database ledger with these fields:

```text
entry_id,entry_kind,occurred_at,chain_id,tx_hash,block,asset_address,
asset_decimals,amount_base_units,valuation_usd,valuation_source,valuation_at,
launch_gross_reference,fee_reference,net_proceeds_reference,budget_bucket,
invoice_hash,private_invoice_reference,approval_record,safe_nonce,
approved_by,executed_by,public_evidence,notes
```

Use exact base units and currency minor units for reconciliations; do not sum different assets as if their units were dollars. Approval records and invoice hashes belong to actual reviewed documents, never placeholders published as approvals. Publish redacted budget-versus-actual plus unspent-credit totals at an agreed cadence; keep key hashes, participant identities and invoices private where appropriate. Owner/cadence/location: **UNASSIGNED / UNDECIDED / UNASSIGNED**.

## Operating readiness

The functions, backups and historical rehearsals already exist; the work here assigns people and records that the selected environment/release can be operated. A GitHub watcher shares a platform with GitHub tick; an independent scheduler monitor needs a different failure domain. No current vendor account, production database or secret was read for this dossier.

| Responsibility | Primary / backup | Agreed response or recovery target | Evidence / actual drill / signoff |
| --- | --- | --- | --- |
| Release/configuration/migration owner | UNASSIGNED / UNASSIGNED | UNDECIDED | — |
| Ethereum operator quorum availability and rotation | UNASSIGNED / UNASSIGNED | UNDECIDED | — |
| Robinhood treasury monitoring and payment approval | UNASSIGNED / UNASSIGNED | UNDECIDED | — |
| External scheduler monitor and alert receipt | UNASSIGNED / UNASSIGNED | UNDECIDED | — |
| RPC/rate/quote incident and pending top-ups | UNASSIGNED / UNASSIGNED | UNDECIDED | — |
| Store/billing UNKNOWN reconciliation and support | UNASSIGNED / UNASSIGNED | UNDECIDED | — |
| Webhook failures and subscriber delivery backlog | UNASSIGNED / UNASSIGNED | UNDECIDED | — |
| Durable logs, secret redaction and credential rotation | UNASSIGNED / UNASSIGNED | UNDECIDED | — |
| Encrypted off-provider backups and isolated restores | UNASSIGNED / UNASSIGNED | RPO/RTO UNDECIDED | — |
| Status notices, service-price/closure notices and terms | UNASSIGNED / UNASSIGNED | UNDECIDED | — |
| Participant eligibility/access and private records | UNASSIGNED / UNASSIGNED | UNDECIDED | — |

### Rehearsal acceptance worksheet

For every row, record source/build, isolated environment, who ran it, timestamps, expected/actual outcome, logs/transaction hashes, recovery, and reviewer acceptance. Existing historical evidence may inform the plan but does not populate a final-release result automatically.

| Scenario | Required observation | Latest release evidence / result |
| --- | --- | --- |
| Database schema and conformance | Isolated Postgres assertions; TLS/certificate setup as selected; no user database used as fixture | — |
| Credits lifecycle via wallet and HTTP | Key, quote, approval/top-up, confirmations, ledger, paid response, receipt, webhook, exhaustion agree end to end | — |
| Stale/unread/wrong code or rate | New payment invitation held; no guessed quote; observed balances and unread pending state distinguished | — |
| Debit acknowledgement lost / retry / concurrency | Existing settlement identifier reconciles; no blind second debit; UNKNOWN not presented as free | — |
| Reorg and index recovery | Removed credits reconciled, cursor recovered, deficits disclosed, no double credit | — |
| Operator nomination/accept/cancel | Current authority retained pending; only nominee accepts; Safe quorum applies to both handoff steps | — |
| Freeze or shortfall in A | A claims remain recorded; B independently claimable if its own checks permit; pause request/execution times distinct | — |
| Backend, source or RPC unavailable | Direct existing claims tested; unread status and cursor preserved; no false zero or invented recovery | — |
| Quorum unavailable | Pending stop is identified; no one-signer execution claim; escalation uses actual contacts | — |
| Tick/watch platform unavailable | Monitor outside that platform detects failure and actual responder receives the alert | — |
| Backup restore and compatibility | Restore into isolation, reconcile counts/checksums, meet chosen RPO/RTO, preserve spend/index idempotency | — |
| Wallet replacement/cancel and account/chain switch | No blind retry; original/replacement receipt reconciled or uncertainty shown; wrong account/chain refused | — |
| Website release and rollback | Serving artifact maps to approved source; smoke checks; old/new schema compatibility or explicit migration plan | — |

For CreditDesk incidents, removing top-up invitations affects the application only: the immutable contract has no pause. Preserve on-chain events, show pending or unpriced payments honestly, restore/reconcile the service and publish the applicable notice. Never promise a refund path or reverse a transfer through an admin action the contract does not have.

Incident record:

```text
Incident ID / opened at / reporter / current owner / next update due:
Scope: operation / component / chain / service / environment:
Detected condition and evidence block/time:
Impact known / unknown; charges: NO / UNKNOWN / confirmed amount:
Containment requested at / executed at / transaction or config evidence:
Quorum available? Required signers and approval status (no private keys):
Affected request/settlement identifiers (private), preserved evidence:
User-facing statement; what remains uncertain:
Recovery action, isolated verification and executed result:
Reconciliation outcome; outstanding claims/top-ups/debits/backlog:
Resume/hold decision, reviewer, next review time and evidence:
```

## Paid beta and position pilot scoreboards

Before inviting a cohort, record its size, task, duration, budget, support coverage and continue/hold thresholds. Keep denominators, timestamps and source queries with every metric. Proposed measurements: funded-key activation, time to confirmed credit, successful paid requests/deliveries, repeat task usage, retention over the agreed interval, failed or uncertain settlements, complaints, latency, queue age and measured cost per served user. Token holders, traffic and narrative feedback do not fill these measurements.

For the position pilot, record separate decisions and evidence for **G1 instrument**, **G2 rights/access**, **G3 component behaviour/acquisition**, **G4 contract review**, **G5 operations** and **G6 economics/user need**. Copy this row per gate:

```text
Gate / decision: IN_RESEARCH, NOT_STARTED, PASSED or HELD as applicable
Candidate and release/configuration covered:
Evidence examined, remaining limitations and conditions:
Decision owner / independent contributor or reviewer / date:
Reason to pass, hold or change candidate:
Expiry/revalidation trigger and next review:
```

No gate becomes PASSED because this dossier exists, tests pass, a token launches or a contract can be deployed. The final completed package is a traceable release plus actual scoped decisions and evidence from the people and systems named in these worksheets.
