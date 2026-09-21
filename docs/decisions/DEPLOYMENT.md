# Deployment plan — proposed, for after a gate decision

**Status:** Proposed, 12 September 2026; not decided, not executed. It awaits engineering and operations (blueprint G02), after the gate decision G01 (people, not code). Nothing deploys on a schedule. The tool refuses without a reviewed record and an operator-held key. The site shows `NOT_DEPLOYED` until a record is configured.

## What has to be true first

- G01 decided in writing: pilot, candidates named. Otherwise this plan is not read.
- The contract version named by commit and reviewed (C09); `contracts/evidence/CompanySeries.build.json` from that commit.
- The operator multisig on the **series' target chain**, signers published ([the operator policy](OPERATIONS.md)), as the record's `operator`.
- A reviewed `operatorSafe` expectation recording that chain, owners, quorum, proxy runtime and singleton identity/code hashes.
- For the candidate Ethereum series, the Robinhood Chain treasury record is no evidence of Ethereum deployment or authority.
- Lot and cap decided ([ADR-006](ADR-006-lots-and-cap.md)). Components: the addresses the issuers publish and the daily verification confirms.
- Participants known: the addresses getting mint and claim permits after the access process ([ADR-003](ADR-003-on-chain-access.md)).

## The record

One JSON file per deployment, reviewed by name and date. Fields: series id, chain id, RPC endpoint, component addresses and decimals, `q` per component in base units, cap in lots, operator, public-chain `operatorSafe` expectation (with its own review attribution), receipt name and symbol, `reviewedBy`, `reviewedAt`.

`contracts/records/apple-s1.example.json` shows the shape with the review empty, so the tool refuses it. A name in JSON proves no review. Link the signed-off evidence and commit in the [mainnet dossier](../mainnet/PREPARATION.md).

## The steps

1. **Dry run:** `node scripts/deploy-series.ts <record> --dry-run --reviewed` on the public target chain. It checks the node's chain id. Both components must have code, answer `symbol()` and `decimals()` as recorded, and differ. On a public chain the operator must match the reviewed Safe expectation at one block: proxy runtime hash, singleton address/runtime hash, exact owner set, threshold of at least two. It prints constructor arguments and verification evidence, and sends nothing. `--reviewed` is required on a public chain even for the dry run; it is optional on the isolated local chain. Matching code does not prove that Safe modules, guards, fallback handlers or the signers' actual control meet the policy. Independent review must cover those.
2. **Deploy:** the same command without `--dry-run`. It needs `DEPLOYER_PRIVATE_KEY` in the operator's shell (never in this repository or a chat) and `--reviewed` on a public chain. It prints address, block, transaction, constructor arguments and the `CURB_SERIES_DEPLOYMENTS` line. It writes `contracts/evidence/deployments/<series>.<chain>.json`.
3. **Verify the code, twice:** set `CURB_SERIES_DEPLOYMENTS` on the deployment (Railway; a variable change redeploys). The next tick compares the deployed code, immutables included, with this repository's build. The series page says *the contract in this repository at commit …*, or a DARK condition says what differs. Also verify the source on the chain's explorer with the printed constructor arguments.
4. **Permits:** the multisig grants mint permits (with an expiry) and claim permits, one transaction each, under the operator policy. The events are the audit trail.
5. **Watch:** every five minutes the tick indexes the series, replays the ledger, reconciles both components at one block and verifies the code. Conditions and the webhook flag changes. The Gazette prints each day's verified changes.
6. **Announce** address, block, commit and cap on the series page, by configuration, not edited prose.

## The credit desk, the same way

[The token record](TOKEN.md) is decided, Robinhood Chain (chain id 4663, the profile `robinhood-mainnet`) included. After the token exists, the desk is deployed there by the same discipline. The steps are rows 2 and 4–14 of [the launch checklist](LAUNCH.md#the-rows): dry run with `node scripts/deploy-credit-desk.ts <record> --dry-run --reviewed`, then deploy without `--dry-run`. What the checklist does not state:

- The treasury creation is recorded in `contracts/evidence/safes/safe.4663.json`; re-read its identity, owners and quorum for this release.
- `node scripts/plan-safe.ts <owner> <owner> <owner> --threshold 2` is an unsigned creation tool, not an instruction to duplicate the treasury. A new creation or change needs its own reviewed record and authorization.
- The Safe acts without a hosted interface, through `node scripts/safe-tx.ts --safe … --to … --data …` ([the operator policy](OPERATIONS.md#the-multisig-on-the-launch-chain)).
- `node scripts/record-token.ts <token> --treasury <safe>` writes `contracts/records/credit-desk.4663.json`; `contracts/records/credit-desk.example.json` shows the shape. Nothing is typed from a launchpad's page.
- Deployment evidence goes to `contracts/evidence/deployments/credit-desk.<chain>.json`; the tick verifies the desk against `contracts/evidence/CreditDesk.build.json`.
- The record names the build by `sourceCommit`, the commit that last changed `contracts/src/CreditDesk.sol`. Re-running the recorder does not move it.
- The public node's state-retention figure is dated in [the chain](TOKEN.md#the-chain). Verify current state/log availability before relying on it.
- Rehearse an unpriced top-up on an isolated chain. Do not ask a public payer to fund a no-rate experiment.

## What there is no plan for

- **Upgrading.** The series is immutable ([ADR-001](ADR-001-immutable-series.md)). A wrong deployment is retired by stopping mints and letting every holder exit. A corrected one is a new series and record.
- **Recovering** anything sent to the wrong address, or a claim to a lost key ([RUNBOOK](RUNBOOK.md)).
- **A second series** on the same contract: the mechanism defers a factory until one is actually needed.

## What exists today

Local deployment rehearsals and read-only probes only:

- `contracts/scripts/deploy-series.ts`: local chain, well-known test key, mock components. The dry run passed; the deployment landed; code verification matched this repository's build and the record's immutables.
- `contracts/scripts/deploy-credit-desk.ts`: likewise, with a mock token and pool. The example record was refused for want of a reviewer. The local dry run passed, and the deployment matched the build, token and treasury. With a different treasury in the record, the site found the mismatch and named the immutable.
- `contracts/scripts/record-token.ts`: on the local mock and, read-only, on Robinhood Chain's USDG (a UUPS proxy, its implementation the one the desk's registry recorded).
- `contracts/scripts/plan-safe.ts`: against Robinhood Chain's node with placeholder owners. Simulated and predicted addresses agreed; nothing was sent.

Probes: `contracts/evidence/robinhood-launch-probes.json`. A treasury Safe creation was later recorded on Robinhood Chain on 13 September 2026 ([the operator policy](OPERATIONS.md#the-multisig-on-the-launch-chain)). These rehearsals establish no approved public CompanySeries or CreditDesk deployment.
