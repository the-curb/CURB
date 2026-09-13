# Operator policy — proposed

**Status:** Proposed, 12 September 2026. Not decided. Awaits operations and a reviewer (blueprint O01). **No signer has been appointed, no multisig exists, and no key is held by this repository or this site.** This page states what the operator would be allowed to do and how, so that the authority can be reviewed before anyone holds it.

## The operator

- The operator of a series is one address, set at construction and changeable only by the operator itself (`transferOperator`). For a pilot it is proposed to be a **multisig of at least three signers with a quorum of two**, none of whom is a signer for any issuer or custodian of the components, with the signer list published on this site.
- The operator's whole authority is the list below. Everything not on it — moving backing, changing a component, changing units per lot, paying a claim to a different address, upgrading the contract — does not exist in the contract ([ADR-001](ADR-001-immutable-series.md), [ADR-005](ADR-005-no-sweep-claims-to-holder.md)).

## What the operator may do, and under what rule

| Action | Contract function | When | Who decides | Record |
| --- | --- | --- | --- | --- |
| Grant a mint permit | `setMintPermit(holder, until)` | after the pilot's access process for that address completes | any signer proposes; quorum executes | on chain (`MintPermitSet`) and in the access log |
| Grant or revoke a claim permit | `setClaimPermit(holder, permitted)` | grant with the mint permit; revoke only for a stated reason under [ADR-003](ADR-003-on-chain-access.md) | quorum | on chain (`ClaimPermitSet`) and in the access log with the reason |
| Stop minting | `setMintPaused(true, reason)` | immediately on: a DARK condition on a component (drift of code, implementation, admin or asset; a shortfall), a reverted mint that the ledger cannot explain, or an issuer notice | **one signer**, so it is fast | on chain with the reason; incident opened |
| Resume minting | `setMintPaused(false, reason)` | only after the cause is shown to be gone and a second signer has reviewed the evidence | quorum, on a written incident record | on chain with the reason; incident closed or held |
| Stop claims of one component | `setClaimPaused(component, true, reason)` | only for exploit risk, insufficient bookkeeping (a disagreement between the index and the contract), or a defined access obligation; never because the *other* component has a problem | quorum | on chain with the reason; incident opened; holders told which component and why |
| Resume claims of a component | `setClaimPaused(component, false, reason)` | when the reason is gone, after a second review | quorum | on chain; incident record |
| Change the operator | `transferOperator(next)` | signer rotation (below) | quorum | on chain (`OperatorChanged`) and published |

## The treasury of the credit desk

[The token record](TOKEN.md) is decided; the credit desk's treasury — the address every top-up goes to, an immutable of the desk that the site verifies against the record on every tick — is **the same multisig**, and its spending is under this policy:

| Action | When | Who decides | Record |
| --- | --- | --- | --- |
| Pay for the independent review or the legal read | per the proceeds table in the token record, first | quorum | published with the invoice's hash and the transaction |
| Pay infrastructure and data | monthly, against the published costs | quorum | published |
| Anything else from the reserve | never without a written reason under this policy | quorum | published before it is executed |

The desk holds no balance and can move nothing; only the multisig can, and only by its own quorum. No signer may top up a key from the treasury, and no credit is ever granted by the desk outside the chain's `TopUp` event — the site has no function for it.

## The multisig on the launch chain

**Created 13 September 2026.** The operator's Safe — 2-of-3, Safe 1.4.1 with the L2 singleton — exists on Robinhood Chain at `0x4E69723F9Ba9fA2C9842d77b240b2C0F601ac219` (transaction `0x8f74a9ad70628a592ee624628215cd788a2f08d9b3d2b115059c015705314268`, block 61,691,826; the record with the plan, the receipt and the read-back is `contracts/evidence/safes/safe.4663.json`). Its owners, as the product owner named them that day and as the chain answers `getOwners()`: `0xC33DAfAC1c65a92e956519Aa73E29a0b8c39214B`, `0x5657dF9f072C536FcdE00BE2eF86c2240E4f8a53`, `0x5cc762A11b05F9cCdaE3839C56F5Beb14C40F15D`; threshold 2, as `getThreshold()` answers. Verified independently through the public node and on the explorer. The signers' names, and the confirmation that none is a signer for an issuer or custodian of the components, are the product owner's to write here; until they are, the register's A4 stays open on that point and closed on the multisig itself. This Safe is the treasury of the credit desk (the token record) and the operator of a series when one is deployed.

Safe's canonical 1.4.1 contracts answer at their canonical addresses on Robinhood Chain — read on 12 September 2026 (`contracts/evidence/robinhood-launch-probes.json`; their code copied at block 61,245,138 into `contracts/evidence/safe-1.4.1.robinhood.json`): the proxy factory at `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67`, the L2 singleton at `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762`, the fallback handler at `0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99`; their code hashes were recorded by the tool, not verified against Safe's release, which a reviewer should do once. So the multisig this policy proposes can be created there.

`node scripts/plan-safe.ts <owner> <owner> <owner> [--threshold 2]` in `contracts/` builds that creation, unsigned: it checks the three contracts have code, encodes `setup(owners, threshold, …)` and `createProxyWithNonce`, predicts the Safe's address by CREATE2, has the node simulate the call and refuses if the two differ, and prints `to`, `data` and the address for any funded wallet to send. Rehearsed against Robinhood Chain's node with placeholder owners on 12 September 2026 — the simulation and the prediction agreed; nothing was sent; the probe is in the evidence file above. The owners are the register's open question A4; the tool takes them as arguments and decides nothing.

**Acting without a hosted interface.** Whether or not a hosted Safe interface supports this chain, the quorum can act with nothing off chain: each approving owner sends `approveHash(hash)` to the Safe from their own wallet — an ordinary transaction — and anyone then sends `execTransaction` with pre-validated signatures naming the owners that approved; the Safe checks the approvals itself and refuses a short quorum (GS020), a non-owner or an unapproving owner (GS025), and a replay. `node scripts/safe-tx.ts --safe <safe> --to <address> --data <hex> [--approved-by <owner>,<owner>]` prints the hash (refused unless the Safe's own `getTransactionHash` agrees — checked read-only against a Safe on Robinhood Chain, recorded in the evidence file above), the approval bytes, who has approved so far, and the execution bytes once the quorum has. `scripts/safe-rehearsal.ts` does the whole thing on a local chain with Safe's runtime code copied from Robinhood Chain (`evidence/safe-1.4.1.robinhood.json`): the Safe created where the plan said, a 100 CURB payment from the treasury approved by two owners and executed by a third party, every wrong way refused with its code. The checks workflow runs it on every push.

## The transactions, as bytes

`node scripts/operator-calldata.mjs <series> <action> …` in `contracts/` prints `to` and `data` for each action above — a permit, a stop, a resume, a rotation — with the reason string carried into the transaction where the contract records it; a stop or a resume without a reason is refused. The multisig signs what it prints. This desk sends nothing and holds no key.

## Signer rotation

A signer is replaced by adding the new signer to the multisig, confirming the new signer can co-sign a harmless transaction (a permit for a test address on a local chain, or a no-op), then removing the old one. The series contract is not touched unless the multisig address itself changes, in which case `transferOperator` is executed by the old quorum to the new multisig and the change is published here before it is executed. A lost signer key is a rotation, not an incident, as long as quorum still holds; if quorum cannot be reached, the series continues to pay claims under existing permits and can neither pause nor grant — that is the designed failure mode.

## Decision logging

Every operator transaction has a reason string on chain and an entry in the incident or access log with: the date, the signers, the condition or request that triggered it, the evidence looked at (a link to the desk's condition, the reconciliation, the drift record, the issuer notice), and the expected effect on holders. The log is published, with the access log's personal data left out.

## Limits on pausing

- A mint pause may last as long as the cause lasts. A mint pause of more than 30 days is announced as a likely retirement of the series.
- A claim pause on a component is reviewed every 7 days and either lifted or re-justified in writing. It is never used to hold one component because the other is short: a shortfall in A halts payments of A by the contract itself ([ADR-004](ADR-004-per-component-stops.md)) and needs no operator pause of B.
- A pause is never a reason to change what is owed. The ledger is the ledger.

## What exists today

The functions and events named above, in `contracts/src/CompanySeries.sol`, with tests for the operator's limits; the conditions the desk raises (`/api/state` → `conditions`); the drill on the series page, whose sixth scenario hands the operator role to a 2-of-3 multisig (a mock, for the rehearsal) and shows that one signer's proposal does not stop minting, a second confirmation does, the former single key can no longer act, and the resume needs two again — the index carrying both with their reasons. No signers, no real multisig, no logs — because there is nothing to operate yet; the multisig's creation is planned and rehearsed, unsigned, for the day the signers are named.
