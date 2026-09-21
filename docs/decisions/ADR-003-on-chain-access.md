# ADR-003 — Access is a permit on chain, not a signature from a backend

**Status:** Proposed, 12 September 2026. Not decided. Awaits the product owner and the reviewer of instruments and distribution (blueprint R03) and the engineering lead (R06). It also proposes R03's answers: who may hold, who the pilot is for, revocation, and a holder who loses access.

## Context

Both candidate issuers restrict acquisition and redemption (see related parties on the series page): no U.S. persons; qualified or professional investors in named jurisdictions; one names a KYC onboarding. The series must not bypass that, and holders must not need the Curb's backend to get their assets out.

## Decision

1. **Minting needs a mint permit**: a per-address expiry (`mintPermitUntil`), granted after the pilot's off-chain access process. The contract records the decision, not the evidence.
2. **Claiming needs a claim permit** (`claimPermitted`). Claims pay only the caller, so the permit covers the receiving wallet.
3. **No fresh signature per operation**: with a permit on chain, nothing is needed from the backend; the series page's drill claims with the backend down.
4. **Revocation is explicit and on chain**: a permit set to false or a past time, with an event and a stated reason, under [the operator policy](OPERATIONS.md). A revoked holder's claims stay under their own address.
5. **A Curb permit never overrides an issuer's restriction**: if a component refuses the transfer, the claim reverts and the right stays.
6. **Exit allocation needs no new check**: burning one's own receipt into claims is always available, even while a permit is under review.

### Who may hold, and who the pilot is for (R03, proposed)

- **Pilot participants:** wallets that passed the pilot's access process and are eligible holders of *both* components under each issuer's rules. The Curb does not determine eligibility for the issuers; it records a person's attestation and that the pilot's checks passed.
- **Contract custody:** whether the series may hold the components is each issuer's question, not settled by technical ability. Ondo's documents: smart contracts may hold the token, eligibility still applies. xStocks' documents: freely transferable; the wrapper a standard ERC-20 vault. Gate G2: not passed.
- **Receipt distribution:** to the minter only, never transferable ([ADR-002](ADR-002-nontransferable-receipt.md)).

### A holder who loses access (R03, proposed)

- Keeps every recorded claim (nothing moved or forfeited) and may allocate remaining lots for exit at any time, without a permit.
- Is paid again only once a claim permit is restored to the *same* address after the pilot's process; never to another address on anyone's say-so.
- Lost keys are lost: no claim can be reassigned ([RUNBOOK.md](RUNBOOK.md)); no recovery is promised.

## Consequences

- The operator can stop a wallet minting or being paid (shown in the series document, §11), but cannot take or redirect a claim.
- The off-chain access process must be documented and logged; contract events are the audit trail.
- A wallet compromised after its permit can still claim to itself, as if holding the components directly.

## What exists today

`mintPermitUntil`, `claimPermitted`, `setMintPermit`, `setClaimPermit` with events, `MintPermitMissing`, `ClaimPermitMissing` in `CompanySeries.sol`; tests T19 and the operator-limit cases; the drill's "backend down" scenario; the series page's wallet flow, where a permitted wallet mints and claims with no site signature (rehearsed on a local chain). The off-chain access process, participant list and attestations do not exist.

## Open

- Should a claim permit expire like a mint permit? (Today: until revoked.)
- May the operator grant a mint permit to a contract address? (Today: nothing prevents it; the pilot policy should say.)
