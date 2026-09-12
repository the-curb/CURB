# ADR-003 — Access is a permit on chain, not a signature from a backend

**Status:** Proposed, 12 September 2026. Not decided. Awaits the product owner and the reviewer of instruments and distribution (blueprint R03) and the engineering lead (R06). This record also proposes the answers R03 asks for: who may hold, who the pilot is for, how a permit is revoked, and what happens to a holder who loses access.

## Context

Both candidate issuers restrict who may acquire and redeem their tokens (see the related parties on the series page: neither issuer offers to U.S. persons; both restrict to qualified or professional investors in named jurisdictions; one names a KYC onboarding). A series contract that holds those tokens must not become a way around those restrictions, and the Curb must not become a second gatekeeper whose backend has to be up for a holder to get their own assets out.

## Decision

1. **Minting needs a mint permit.** The operator records, per address, a time until which that address may mint (`mintPermitUntil`). A mint with no unexpired permit reverts. The permit is granted only after the pilot's access process for that address has completed off chain; the contract records the decision, not the evidence.
2. **Claiming needs a claim permit.** The operator records, per address, whether that address may claim (`claimPermitted`). A claim is paid only to the caller — never to a third address — so a permit is a statement about the wallet that will receive the components.
3. **No fresh signature per operation.** Once a permit is on chain, minting and claiming need nothing from the Curb's backend. A backend that is down does not block a claim; the drill on the series page shows a claim made with no backend involved.
4. **Revocation is explicit and on chain.** Setting a permit to false (or to a past time) is a transaction with an event. It is done under [the operator policy](OPERATIONS.md), which requires a stated reason, and is never done to move a holder's rights: a revoked holder's claims stay on the ledger under their own address.
5. **A Curb permit never overrides an issuer's restriction.** If a component's contract refuses a transfer to a permitted wallet, the claim reverts and the right stays; the series does not route around it.
6. **Exit allocation needs no new check.** Burning one's own receipt to record claims is an internal right and is always available, so a holder can always convert a position into claims even while a permit is under review.

### Who may hold, and who the pilot is for (R03, proposed)

- **Pilot participants:** wallets that have completed the pilot's access process and are eligible holders of *both* components under each issuer's own rules. The Curb does not determine eligibility for the issuers; it records that a person attested to it and that the pilot's own checks passed.
- **Contract custody:** the series contract holds the components. Whether an issuer regards that as a permitted holding is a question for each issuer and is not settled by the contract's technical ability to hold (the Ondo documents say smart contracts may hold the token with eligibility still applying; the xStocks documents say xStocks are freely transferable and describe the wrapper as a standard ERC-20 vault). This is gate G2 and is not passed.
- **Receipt distribution:** receipts are minted only to the minter and cannot be transferred ([ADR-002](ADR-002-nontransferable-receipt.md)); there is no distribution to anyone else.

### A holder who loses access (R03, proposed)

- A holder whose permit is revoked keeps every recorded claim; nothing is moved and nothing is forfeited.
- The holder may allocate remaining lots for exit at any time (no permit needed), turning receipts into claims.
- Payment of those claims resumes when a claim permit is restored to the *same* address after the pilot's process; the Curb does not pay to a different address on anyone's say-so.
- A holder who has lost the keys to the address has lost the keys: the series cannot reassign a claim, and the runbook says so ([RUNBOOK.md](RUNBOOK.md)). No recovery is promised.

## Consequences

- The operator can stop a specific wallet from minting or being paid, which is an authority the series document shows (§11). It cannot take or redirect a claim.
- The pilot's access process is off chain and must be documented and logged; the contract's events are the audit trail of what was granted and revoked.
- A wallet compromised after a permit was granted can still claim to itself; that is the same exposure as holding the components directly.

## What exists today

`mintPermitUntil`, `claimPermitted`, `setMintPermit`, `setClaimPermit` with events, `MintPermitMissing` and `ClaimPermitMissing` in `CompanySeries.sol`; tests T19 and the operator-limit cases; the drill's "backend down" scenario. The off-chain access process, the participant list and the attestations do not exist.

## Open

- Whether a claim permit should expire like a mint permit, or stay until revoked (today: until revoked).
- Whether the operator may grant a mint permit to a contract address (today: nothing prevents it; the pilot policy should say).
