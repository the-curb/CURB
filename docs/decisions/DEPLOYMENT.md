# Deployment plan — proposed, for after a gate decision

**Status:** Proposed, 12 September 2026. Not decided and not executed. Awaits engineering and operations (blueprint G02), and before that the gate decision G01 (people, not code). Nothing in this repository deploys anything on a schedule; the tool below refuses to run without a reviewed record and a key held by the operator, and the site reports `NOT_DEPLOYED` until a record is configured.

## What has to be true first

- G01 has been decided in writing: pilot, with the candidates named, or this plan is not read.
- The contract version is named by commit and has been reviewed (C09); the build record in `contracts/evidence/CompanySeries.build.json` is from that commit.
- The operator multisig exists with published signers ([the operator policy](OPERATIONS.md)); its address is the `operator` of the record.
- The lot and the cap are decided ([ADR-006](ADR-006-lots-and-cap.md)); the components are the addresses the issuers publish and the daily verification confirms.
- The participants are known: the addresses that will receive mint and claim permits after the access process ([ADR-003](ADR-003-on-chain-access.md)).

## The record

A deployment record is one JSON file, reviewed by name and date, kept beside the deployment it produces: series id, chain id, RPC endpoint, the two component addresses and their decimals, `q` per component in base units, the cap in lots, the operator, the receipt's name and symbol, `reviewedBy`, `reviewedAt`. `contracts/records/apple-s1.example.json` shows the shape with the review left empty, so the tool refuses it.

## The steps

1. **Dry run.** `node scripts/deploy-series.ts <record> --dry-run` on the target chain: the node must answer the record's chain id; both components must have code, answer `symbol()` and `decimals()` with the decimals the record expects, and differ; the constructor arguments are printed. Nothing is sent.
2. **Deploy.** The same command without `--dry-run`, with `DEPLOYER_PRIVATE_KEY` in the environment of the operator's shell (never in this repository, never in a chat), and `--reviewed` on a public chain. The tool prints the address, the block, the transaction, the constructor arguments, and the `CURB_SERIES_DEPLOYMENTS` line, and writes `contracts/evidence/deployments/<series>.<chain>.json`.
3. **Verify the code, twice.** Set `CURB_SERIES_DEPLOYMENTS` on the deployment (Vercel, then `vercel deploy --prod --yes`) and let the next tick compare the code at the address with the build in this repository, immutables included; the series page says *the contract in this repository at commit …* or a DARK condition says what differs. Independently, verify the source on the chain's explorer with the printed constructor arguments, so a reader who trusts neither this site nor the repository has a third place to look.
4. **Permits.** The multisig grants mint permits (with an expiry) and claim permits to the participants, one transaction each, under the operator policy; the events are the audit trail.
5. **Watch.** The tick indexes the series, replays the ledger, reconciles both components at the same block, and verifies the code, every five minutes; the desk's conditions and the webhook say when something moves. The Gazette prints the day's verified changes.
6. **Announce** the address, the block, the commit and the cap on the series page — by configuration, not by editing prose.

## The credit desk, the same way

[The token record](TOKEN.md) is decided, Robinhood Chain (chain id 4663, the profile `robinhood-mainnet`) included; the credit desk is deployed there by the same discipline, after the token exists:

0. **The multisig.** `node scripts/plan-safe.ts <owner> <owner> <owner> --threshold 2` plans a 2-of-3 Safe on Robinhood Chain, unsigned (the [operator policy](OPERATIONS.md)); a funded wallet sends it; the owners and the threshold are verified on the explorer. Its address is the treasury below and a series' operator.
1. **The record.** `node scripts/record-token.ts <token> --treasury <safe>` reads the token as the chain has it — name, symbol, decimals, supply, code hash, whether it sits behind a proxy and who its admin is, `owner()` and `paused()` where answered — at a stated block, and writes `contracts/records/credit-desk.4663.json` with those facts beside the record: network, chain id, RPC endpoint, the token and its decimals, the treasury, the price source (`null` until the pool exists), `reviewedBy`, `reviewedAt` — the last two empty, so the tool below refuses it until a named person has reviewed what was read. `contracts/records/credit-desk.example.json` shows the shape. Nothing is typed from a launchpad's page.
2. **Dry run.** `node scripts/deploy-credit-desk.ts <record> --dry-run`: the node answers the record's chain id (4663); the token has code and answers `symbol()`, `decimals()` and `totalSupply()` with the decimals the record expects; the treasury has code (a multisig) on any public chain; the pool, if named, has code. Nothing is sent.
3. **Deploy.** The same command without `--dry-run`, with `DEPLOYER_PRIVATE_KEY` in the operator's shell and `--reviewed`, which every chain but a local one needs. The tool prints the address, the block, the constructor arguments and the `CURB_CREDITS` line, and writes `contracts/evidence/deployments/credit-desk.<chain>.json`.
4. **Verify, twice.** Set `CURB_CREDITS` on the deployment; the next tick compares the desk's code with `contracts/evidence/CreditDesk.build.json` and its two immutables with the record's token and treasury, and the services page says *matches the build at commit …* or a DARK condition says what differs. Verify the source on the explorer with the printed constructor arguments as well.
5. **The pool.** When the token trades in a pool the reader knows — a constant-product pair (`uniswap-v2-pair`) or a concentrated-liquidity pool (`uniswap-v3-pool`) — its address goes into the record's `priceSource` from the chain, with the quote taken as dollars (USDG) or priced by a feed (ETH / USD for WETH), and the same line is set again. Until then the price list is in dollars and nothing is quoted. The public node keeps about ten minutes of state, so a top-up's own block is priced from the pool's events; nothing about that needs configuring.

## What there is no plan for

- **Upgrading.** The series is immutable ([ADR-001](ADR-001-immutable-series.md)). A wrong deployment is retired by stopping mints and letting every holder exit; a corrected one is a new series and a new record.
- **Recovering** anything sent to the wrong address, or a claim to a lost key ([RUNBOOK](RUNBOOK.md)).
- **A second series** on the same contract: the mechanism defers a factory until a second series is actually needed.

## What exists today

`contracts/scripts/deploy-series.ts`, rehearsed on a local chain with a well-known test key against mock components: the dry run passed every check, the deployment landed, and the site's code verification found the deployed series to be the build in this repository with the record's immutables. `contracts/scripts/deploy-credit-desk.ts`, rehearsed the same way against a mock token and a mock pool: the example record refused for want of a reviewer, the local record's dry run passed, the deployment landed, the site found the desk to be the build with the record's token and treasury — and, with the record naming a different treasury, found the mismatch and named the immutable. `contracts/scripts/record-token.ts`, rehearsed on the local mock and, read-only, on Robinhood Chain's USDG (a UUPS proxy, its implementation the one the desk's registry recorded). `contracts/scripts/plan-safe.ts`, rehearsed against Robinhood Chain's node with placeholder owners: the simulated and the predicted address agreed; nothing was sent. No key exists, no record has been reviewed, and nothing has been sent to a public chain.
