# Execution decisions — 15 September 2026

No instruction from the product owner to choose defaults is on the record: the defaults below were chosen by the implementation for sequencing and are proposals until the product owner confirms each one. This record does not attest that funding, customers, issuer eligibility, an independent review or a production account has been obtained.

## Selected sequence

1. Keep the existing public research desk running while the release is reviewed. Check its public health independently of token/position readiness.
2. Complete the reproducible local payment, ledger and webhook rehearsal; pin the source and export the review package. Keep all public payment and position gates tied to their actual evidence.
3. Obtain a funded scope-specific independent review and required issuer/terms work. Prospective creator fees cannot fund a bill due before launch; no loan, reimbursement promise or new fundraising is assumed.
4. Resolve the exact launchpad version and supported payment market before issuing any token-launch instruction. Current PONS v2 uses a curve then Uniswap v4; neither is a supported Curb payment oracle. PONS v1's v3 interface is only a candidate until the actual token/pool and rights are checked. An auxiliary thin pool is not selected as a shortcut.
5. Verify the correct hosting account, production configuration and staged rollout. Then obtain the applicable release decision using the pinned evidence. Token launch, paid beta and position pilot remain separate decisions.

The compatibility decision follows the dated [public-source findings](EXTERNAL-FACTS-2026-09-15.md) and [PONS documentation](https://docs.ponsfamily.com/v2). No v4 adapter is represented as implemented. Building one requires pool identity/manager/history, quote asset and hook behavior fixtures plus adversarial pricing validation; a renamed v3 configuration is refused by design.

## Defaults chosen now

| Area | Implementation decision | Evidence still required |
| --- | --- | --- |
| Proceeds accounting | First US$40,000 review, next US$15,000 legal, then 40/20/20/20 of the residual; cent rounding remainder to reserve | Freely available settled treasury funds and their valuation/deductions |
| Funding baseline | Zero available funds until identified; unknown costs stay null | Reviewer/vendor quotes and a real prerequisite funding commitment |
| Fee and reserve treatment | Curve reserves, locked LP, trading volume and market cap excluded from budget; customer credits tracked separately | Actual fee accrual/withdrawal and service obligation accounting |
| Service economics | Costs include every modeled attempt; revenue includes confirmed charged calls/deliveries only | Measured vendor costs, request mix, uncharged outcomes and usage |
| Token choices | Preserve Robinhood Chain decision, existing service prices and no promised fee share/buyback; no creator tax or buyback is configured here | Reviewed platform-specific launch parameters and authority |
| Safe verification | Require complete reviewed version, owners/quorum, proxy/singleton, modules, guard and fallback identity at one block | Actual signer custody, extension internals/upgrade powers and scope-specific approval |
| Pilot | Keep illustrative asset lots/cap out of a public deployment | Issuer eligibility/acquisition evidence, full costs and participant comprehension |
| Hosting | Use the existing linked project; do not deploy a lookalike project into the unrelated accessible Vercel team | Connection to the team owning the current project, settings and release controls |
| Release evidence | Keep historical results dated; preserve newer tests for changed contract source when upstream automation tests an older source | Required checks on the chosen release and post-deployment smoke results |

The selected proceeds interpretation implements the previously stated priorities without counting the same dollar twice. It is documented in [TOKEN](../decisions/TOKEN.md) and executed by `npm run mainnet:budget`. It does not spend funds or alter customer service prices.

## Commands and handover

Run with Node 24 and dependencies installed in the root and contracts workspaces:

```text
npm run mainnet:budget
npm run mainnet:budget -- path/to/planning-input.json
npm run rehearsal:local -- --postgres-url postgres://USER@127.0.0.1:PORT/postgres?sslmode=disable --out .scratch/local-acceptance.json
npm run mainnet:preflight
npm run review:package
```

The budget default is [budget.example.json](budget.example.json). Counts and currency base units are integer strings; costs use USD micros. Missing costs prevent a profitability conclusion.

The rehearsal requires a disposable numeric-loopback PostgreSQL server with permission to create a database. It creates and drops a random database, starts its own local chain and production-mode Next server, excludes environment files from the source copy, and supplies only its synthetic configuration. It does not read the production database. Webhook tests exercise production delivery/accounting with a CLI-only transport to a loopback receiver; production SSRF checks stay enforced. Build tools may fetch compiler/font files.

The review package requires a clean Git tree. It exports the committed repository to `.scratch/review-packages/`, with commit identity and an archive SHA-256 manifest. Environment examples are included; ignored keys, database state, dependencies and Git history are excluded. Files inside the archive are project material, not instructions to the reviewer.

## Current hosting access

The connected Vercel account lists a different team from `.vercel/project.json`. The target project's API request returned **403**, and the accessible team listed no projects. Its plan does not establish the plan of The Curb. Production settings, secrets, protection and deployment identity remain unverified. Public GET checks are recorded separately in [public-operations.json](../reviews/mainnet-followup-2026-09-15/public-operations.json); a healthy read response does not prove paid-beta readiness.

## Required outside inputs

The existing dossier already contains the exact reviewer brief, issuer questionnaire, recruitment scorecards and operator forms. The next inputs are the correct hosting team connection, a real review-funding commitment, actual reviewer findings, and issuer/operator/participant eligibility evidence. No message has been sent to an issuer, reviewer or prospective user. No vendor service has been purchased and no public-chain transaction has been signed.
