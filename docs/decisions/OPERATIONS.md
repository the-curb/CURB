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

If [the token record](TOKEN.md) is decided, the credit desk's treasury — the address every top-up goes to, an immutable of the desk that the site verifies against the record on every tick — is **the same multisig**, and its spending is under this policy:

| Action | When | Who decides | Record |
| --- | --- | --- | --- |
| Pay for the independent review or the legal read | per the proceeds table in the token record, first | quorum | published with the invoice's hash and the transaction |
| Pay infrastructure and data | monthly, against the published costs | quorum | published |
| Anything else from the reserve | never without a written reason under this policy | quorum | published before it is executed |

The desk holds no balance and can move nothing; only the multisig can, and only by its own quorum. No signer may top up a key from the treasury, and no credit is ever granted by the desk outside the chain's `TopUp` event — the site has no function for it.

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

The functions and events named above, in `contracts/src/CompanySeries.sol`, with tests for the operator's limits; the conditions the desk raises (`/api/state` → `conditions`); the drill on the series page, whose sixth scenario hands the operator role to a 2-of-3 multisig (a mock, for the rehearsal) and shows that one signer's proposal does not stop minting, a second confirmation does, the former single key can no longer act, and the resume needs two again — the index carrying both with their reasons. No signers, no real multisig, no logs — because there is nothing to operate yet.
