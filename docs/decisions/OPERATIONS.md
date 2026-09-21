# Operator policy — proposed

**Status:** Partly decided. Proposed 12 September 2026; awaits operations and a reviewer (blueprint O01).

- **Decided by the product owner:** the treasury signers and the Robinhood Chain Safe (13 September 2026; register A4); the incident response owner, response time and recovery objective (17 September 2026, *Who answers, and how fast*; dossier D08).
- **Still proposed:** quorum rules per action, rotation, logging, the limits on pausing, the Ethereum operator verification.
- **A Safe on the candidate Ethereum chain has not been verified.**

## The operator

- One address per series, set at construction.
- Rotation is two-step in the mainnet preparation source. `transferOperator(next)` nominates; only the nominee completes it (`acceptOperator()`). Until then the current operator keeps authority and may `cancelOperatorTransfer()`. This local change still needs independent review and a pinned release; it is not evidence of public deployment.
- Proposed for a pilot: a **multisig of at least three signers with a quorum of two**. None signs for an issuer or custodian of the components; the list is published here.
- Its whole authority is the table below. Moving backing, changing a component or units per lot, paying a claim to another address, upgrading: none of it exists in the contract ([ADR-001](ADR-001-immutable-series.md), [ADR-005](ADR-005-no-sweep-claims-to-holder.md)).

## What the operator may do, and under what rule

| Action | Contract function | When | Who decides | Record |
| --- | --- | --- | --- | --- |
| Grant a mint permit | `setMintPermit(holder, until)` | after that address's pilot access process | any signer proposes; quorum executes | on chain (`MintPermitSet`); access log |
| Grant or revoke a claim permit | `setClaimPermit(holder, permitted)` | grant with the mint permit; revoke only for a stated reason ([ADR-003](ADR-003-on-chain-access.md)) | quorum | on chain (`ClaimPermitSet`); access log with the reason |
| Stop minting | `setMintPaused(true, reason)` | at once on: DARK on a component (drift of code, implementation, admin or asset; a shortfall); a reverted mint the ledger cannot explain; an issuer notice | any signer proposes; **quorum executes** with the current contract | on chain with the reason; incident opened |
| Resume minting | `setMintPaused(false, reason)` | only once the cause is shown gone and a second signer has reviewed the evidence | quorum, on a written incident record | on chain with the reason; incident closed or held |
| Stop claims of one component | `setClaimPaused(component, true, reason)` | only for exploit risk, insufficient bookkeeping (index and contract disagree) or a defined access obligation; never because the *other* component has a problem | quorum | on chain with the reason; incident opened; holders told which component and why |
| Resume claims of a component | `setClaimPaused(component, false, reason)` | reason gone, after a second review | quorum | on chain; incident record |
| Nominate the next operator | `transferOperator(next)` | multisig address must change; next Safe verified on the series' chain | current quorum | `OperatorTransferProposed`; current operator keeps authority |
| Accept the operator role | `acceptOperator()` | nominee reviewed the series and verified it can operate it | nominee's quorum | `OperatorChanged`; pending nomination cleared |
| Cancel a nomination | `cancelOperatorTransfer()` | wrong recipient, abandoned rotation or superseded plan | current quorum | `OperatorTransferCancelled`; reason published in the rotation log |

## The treasury of the credit desk

Under [the token record](TOKEN.md), the credit desk's treasury is **the designated Safe on Robinhood Chain** below. Every top-up goes there; the site checks it, a desk immutable, against the record every tick. Its spending is under this policy. The Ethereum series operator needs its own chain-specific verification, even with the same signers.

| Action | When | Who decides | Record |
| --- | --- | --- | --- |
| Pay for the independent review or the legal read | first, per the token record's proceeds table | quorum | published with the invoice's hash and the transaction |
| Pay infrastructure and data | monthly, against the published costs | quorum | published |
| Anything else from the reserve | never without a written reason under this policy | quorum | published before it is executed |

The desk holds no balance and moves nothing; only the multisig can, by its own quorum. No signer may top up a key from the treasury. No credit is granted outside the chain's `TopUp` event; the site has no function for it.

## The multisig on the launch chain

**Created 13 September 2026:** the operator's Safe, 2-of-3, Safe 1.4.1 with the L2 singleton, at `0x4E69723F9Ba9fA2C9842d77b240b2C0F601ac219` on Robinhood Chain. Transaction `0x8f74a9ad70628a592ee624628215cd788a2f08d9b3d2b115059c015705314268`, block 61,691,826. Plan, receipt and read-back: `contracts/evidence/safes/safe.4663.json`.

- **Owners**, as the product owner named them that day and `getOwners()` answers: **thecurb 1** `0xC33DAfAC1c65a92e956519Aa73E29a0b8c39214B`, **thecurb 2** `0x5657dF9f072C536FcdE00BE2eF86c2240E4f8a53`, **thecurb 3** `0x5cc762A11b05F9cCdaE3839C56F5Beb14C40F15D`. Threshold 2, as `getThreshold()` answers. Verified independently through the public node and on the explorer.
- Recorded with the names: the product owner's confirmation that none of the three signs for an issuer or custodian of the components.
- This Safe is the designated Robinhood Chain credit-desk treasury. The candidate series is on Ethereum, where the operator address, deployed Safe code, owners and threshold must be verified before use. The Robinhood record alone establishes none of those Ethereum facts.

**Safe's contracts.** Safe's canonical 1.4.1 contracts answer at their canonical addresses on Robinhood Chain, read on 12 September 2026 (`contracts/evidence/robinhood-launch-probes.json`). Their code was copied at block 61,245,138 into `contracts/evidence/safe-1.4.1.robinhood.json`:

- proxy factory `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67`;
- L2 singleton `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762`;
- fallback handler `0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99`.

The tool recorded their code hashes but did not verify them against Safe's release; a reviewer should do that once. So the proposed multisig can be created there.

**Planning a creation.** `node scripts/plan-safe.ts <owner> <owner> <owner> [--threshold 2]` in `contracts/` builds it unsigned. It encodes `setup(owners, threshold, …)` and `createProxyWithNonce` and predicts the address by CREATE2. Checks and refusals: row 2 of [the launch checklist](LAUNCH.md#the-rows). Rehearsed on 12 September 2026 with placeholder owners (probe in the evidence file above): simulation and prediction agreed; nothing was sent. The tool takes owners as arguments and decides nothing.

**Acting without a hosted interface.** With or without a hosted Safe interface, the quorum needs nothing off chain.

- Each approving owner sends `approveHash(hash)` to the Safe from their own wallet, an ordinary transaction.
- Anyone then sends `execTransaction` with pre-validated signatures naming them.
- The Safe refuses a short quorum (GS020), a non-owner or unapproving owner (GS025), and a replay.

`node scripts/safe-tx.ts --safe <safe> --to <address> --data <hex> [--approved-by <owner>,<owner>]` prints the hash, the approval bytes, who has approved, and the execution bytes at quorum. It refuses a hash the Safe's own `getTransactionHash` disagrees with (checked read-only on Robinhood Chain; in the evidence file above).

`scripts/safe-rehearsal.ts` runs it all on a local chain with Safe's runtime code copied from Robinhood Chain (`evidence/safe-1.4.1.robinhood.json`). It creates the Safe where planned and pays 100 CURB from the treasury: two owners approve, a third party executes. Every wrong way is refused with its code. The checks workflow runs it on every push.

## The transactions, as bytes

`node scripts/operator-calldata.mjs <series> <action> …` in `contracts/` prints `to` and `data` for each action above: a permit, a stop, a resume, a rotation. The reason string goes into the transaction where the contract records it; a stop or resume without one is refused. The multisig signs what it prints. This desk sends nothing and holds no key.

## Signer rotation

- A signer is replaced through the Safe's owner management, keeping quorum and proving the new signer can co-sign. Same multisig address, same series operator address.
- A new address: verify the new Safe on the series' chain and publish the plan. The old quorum calls `transferOperator(next)`; the new Safe's quorum calls `acceptOperator()`. Verify `operator()` and a cleared `pendingOperator()`; record both transactions.
- A pending nomination does not complete rotation; the old operator can replace or cancel it.
- A lost signer key is rotated while quorum holds. Without quorum the operator cannot nominate or execute new actions. Existing holder permits and contract rules still apply.
- Two-step transfer keeps an unaccepted nomination from immediately losing authority. It cannot recover quorum or holder keys already lost.

## Decision logging

- Every operator transaction gets an incident, rotation or access log entry: date, signers, condition/request, evidence reviewed, expected effect, chain, Safe nonce, executed transaction hash.
- Stop/resume calls carry a reason string on chain. Permit and rotation events do not, so their reasons go in the log.
- Publish a suitably redacted log. Keep participants' personal data out of the public repository.
- The [mainnet dossier](../mainnet/PREPARATION.md#operating-readiness) holds the unassigned owner and signoff fields.

## Limits on pausing

- A mint pause lasts as long as its cause. One over 30 days is announced as a likely retirement of the series.
- A claim pause on a component is reviewed every 7 days, then lifted or re-justified in writing.
- A claim pause never holds one component because the other is short. A shortfall in A halts payments of A by the contract itself ([ADR-004](ADR-004-per-component-stops.md)); it needs no operator pause of B.
- A pause never changes what is owed. The ledger is the ledger.

## Who answers, and how fast

Decided by the product owner on 17 September 2026 (the dossier's D08).

- **Owner:** the product owner, first responder to the alert channel. Backup: a second signer of the operator Safe.
- **Response:** within twenty-four hours. No faster level is promised anywhere.
- **Recovery point:** up to seven days behind. The store's only off-platform copy is the weekly encrypted dump. The provider's continuous backup is off; it is the one setting that would shorten the seven days.
- **Recovery time:** about an hour, by the restore commands in DEPLOY.md.
- **Reserve budget:** none yet. The reserve is a share of proceeds, and there are none.

## What exists today

- The functions and events above, in `contracts/src/CompanySeries.sol`, with tests for the operator's limits.
- The conditions the desk raises (`/api/state` → `conditions`).
- The series-page drill. Its sixth scenario gives the operator role to a mock 2-of-3 multisig. One signer's proposal does not stop minting; a second confirmation does. The former single key can no longer act; resuming needs two again. The index carries both, with reasons.
- CompanySeries checks the operator address on every pause, with no one-signer guardian path: a 2-of-3 Safe needs quorum to stop and to resume.

The treasury record above establishes no public series operation. The Ethereum operator and remaining policy still need verification and approval.
