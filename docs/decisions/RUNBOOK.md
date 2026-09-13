# Runbook — incidents, lost access, and what is said

**Status:** Proposed, 12 September 2026. Not decided. Awaits operations and the product owner (blueprint O03). The incident order is the one the mechanism's §11 gives; this page turns it into steps, says what a holder is told, and says what will not be done.

## The order, for every incident

1. **Identify** the operation (mint, exit allocation, claim) and the component (A, B, both, neither) affected. The desk's conditions name them; a reverted transaction names its reason.
2. **Stop what must stop** under [the operator policy](OPERATIONS.md): minting on one signer's call; a component's claims only under the policy's reasons and quorum.
3. **Preserve evidence:** the condition, the reconciliation at its block, the drift record, the issuer's page as archived, the transaction hashes. The archive keeps versions; nothing is deleted.
4. **Show a specific status** on the series page and in the API: which operation, which component, since when, and why. Not "maintenance".
5. **Reconcile** rights (the ledger from the index) against balances (the reconciliation at the same block). A `SHORTFALL` is stated as a shortfall of units of a token. It is not written up as anything about the issuer's reserves.
6. **Decide the fix, test it** — on a fork or a local chain, as the drill does — and record who decided.
7. **Announce** resume or hold, with the reason on chain and on the page.

## The incidents the drill rehearsed, and what is done

| Incident | What the contract does by itself | What the operator does | What the holder is told |
| --- | --- | --- | --- |
| The issuer freezes A (transfers revert) | Claims of A revert with `TransferFailed`; claims of B pay; mints revert | Pauses minting (one signer). Does **not** pause B. Opens an incident naming A | "Claims of A cannot be paid while the issuer's contract refuses transfers; your claim of A is recorded and waits; claims of B pay." |
| The series is short of A | `ShortfallHaltsPayment(0)` for every holder of an A claim; B pays; mints revert (`BackingShort`) | Pauses minting. Reconciles: how much, since which block. Contacts the issuer if the shortfall is on their side. Does not pause B | "The series holds less A than it owes by *n* units as of block *b*; no claim of A is paid until that is resolved so that no holder is paid ahead of another; claims of B pay." |
| The backend is down | Nothing changes: permits are on chain; claims pay | Restores the tick; the index catches up from its cursor | "The site is behind; your claims can be made from any wallet against the contract; the address is on the series page." |
| The RPC fails | Nothing on chain changes | Reads report `HEAD_UNREAD` / `UNKNOWN`; the cursor is kept; nothing is rolled back; the operator switches the endpoint | "Figures are not being read; nothing shown is guessed." |
| A source is lost | Nothing on chain changes | The archive keeps the last record; a STALE condition names the source; the operator reads the issuer's page | "The issuer's record could not be fetched since *t*; the last archived version is shown as such." |
| A stop is needed and the operator is a quorum | Nothing until the quorum executes; minting continues meanwhile | One signer proposes at once; a second confirms; the policy's one-signer stop applies to a multisig that lets one signer execute a stop, which the mock does not — a pilot's multisig should | "Minting stopped at *t* by the operator, reason *r*; resumed only after a second review." |
| The credit desk has no rate (the pool is empty, the feed answers nothing, the node cannot serve the block) | Nothing: top-ups still reach the treasury and emit their event | Nothing is credited at a guess: the top-ups wait, listed, and a STALE condition names the reason; the operator reads the pool. If the pool is gone for good, the record's price source is replaced from the chain — the new pool with the block it was created in — and the waiting top-ups, mined before that pool existed, are priced at the head when indexed, which the credit says | "No rate could be read since *t*; your top-up is recorded on chain and will be credited when a rate can be read; nothing is quoted meanwhile." |
| The desk's code or treasury is not the record's | Nothing: the contract is what it is | The DARK condition halts nothing on chain (there is nothing to halt) but the services page says the desk is not trusted; the operator finds out which changed — the record or the chain — and no top-up is invited until it is settled | "The desk at *a* is not the contract this site describes; do not pay it until this notice is withdrawn." |
| A block with a top-up is reorganised | The chain forgets the top-up | The indexer uncredits it and reads the height again; a top-up that lands again is credited again at its new block's rate | "A top-up in block *b* was removed by the chain and its credit with it; if it is mined again it is credited again." |
| The store is unreachable | Nothing on chain changes; every paid call answers 503 and charges nothing; the tick runs no agent | `/api/state` says STORE_UNREADABLE with the reason; nothing is written meanwhile, so nothing is lost but time. The operator checks the provider, then the connection string; once it answers, the next tick indexes from its cursor and the fan-out tells each subscriber its changes since | "The desk's record could not be read since *t*; nothing was charged and nothing was lost; the chain is unaffected." |
| The RPC endpoint refuses or runs out | Nothing on chain changes | The reader passes over an endpoint that does not answer — the transport, a timeout on a state read, a quota — for the public node, and asks it again after a minute; a log page that runs past its time is halved on the same endpoint, and a wrong answer is never retried elsewhere. If the public node is what fails, reads are UNREAD, the cursor is kept, and `credits:index:*` conditions say so | "Figures are not being read; nothing shown is guessed." |
| The alert webhook is gone | Nothing changes; subscribers still get their own deliveries | The tick reports alert delivery FAILED (a red run) and `/api/state` keeps the standing set; the operator replaces `CURB_ALERT_WEBHOOK` and redeploys; what changed meanwhile is posted once, as a transition | — |
| The scheduler stops | Nothing on chain changes; the site serves the last record and says how old it is | `reportingLastHour` on `/api/state` falls to zero and every age grows; the operator runs the tick by hand (`gh workflow run tick`), then finds out why — the sixty-day rule, a revoked secret, a GitHub outage | "The desk has not run since *t*; every figure carries its age." |
| The store's schema is behind the build | Nothing on chain changes; the writes that need the missing column fail and say so | The tick and `/api/state` carry `storeSchema: BEHIND` naming the column; the operator runs `npm run db:migrate` (idempotent) and the next tick writes | — |

## Lost access and lost keys

- **A holder whose claim permit is revoked** keeps every recorded claim and may still allocate remaining lots for exit. Payment resumes to the same address after the access process ([ADR-003](ADR-003-on-chain-access.md)). Nothing is moved.
- **A holder who loses the keys to their address** has lost what that address holds, exactly as with the components themselves. The series cannot reassign a claim or pay it elsewhere ([ADR-005](ADR-005-no-sweep-claims-to-holder.md)). **No recovery is promised**, and none is offered informally.
- **A signer who loses a key** is rotated under the operator policy; quorum must still hold. If it does not, the series keeps paying under existing permits and cannot be paused or extended; that is designed, and it is said so.

## What is never said

- That a reverted transaction means the issuer is bankrupt.
- That a shortfall of token units is a finding about shares in custody.
- That a claim will be paid by a date, or that a pending claim has a recovery value.
- That anyone's rights were moved to make an incident easier.

## Communication

Every incident gets a dated entry on the series page with the operation, the component, the block, the reason string on chain and the next review date; the same text goes to the alert webhook. Holders are not contacted individually, because the Curb does not hold their contact details; the access process may.

## What exists today

The conditions and the alert delivery; the drill record (`contracts/evidence/drill-local.json`) showing each row of the table above on a local chain with mock components; the series page's status blocks. No incident has happened, because nothing but the operator’s treasury is deployed.
