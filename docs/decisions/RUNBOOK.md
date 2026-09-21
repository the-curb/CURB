# Runbook — incidents, lost access, and what is said

**Status:** Proposed, 12 September 2026. Not decided. Awaits operations and the product owner (blueprint O03). It turns the mechanism's §11 incident order into steps, what a holder is told, and what will not be done.

## The order, for every incident

1. **Identify** the operation (mint, exit allocation, claim) and component (A, B, both, neither). Conditions name them; a reverted transaction names its reason.
2. **Stop what must stop** under [the operator policy](OPERATIONS.md): any signer proposes a mint stop; the configured operator quorum executes it. Claims of a component stop only for the policy's reasons, by quorum. CompanySeries has no one-signer guardian.
3. **Preserve evidence:** the condition, the reconciliation at its block, the drift record, the archived issuer page, the transaction hashes. The archive keeps versions; nothing is deleted.
4. **Show a specific status** on the series page and in the API: operation, component, since when, why. Not "maintenance".
5. **Reconcile** rights (the ledger from the index) against balances (the reconciliation at the same block). A `SHORTFALL` is a shortfall of token units, never a statement about the issuer's reserves.
6. **Decide the fix and test it** on a fork or local chain, as the drill does. Record who decided.
7. **Announce** resume or hold, with the reason on chain and on the page.

## Incident procedures and their evidence

The historical local drill covers six position scenarios: issuer freeze, shortfall, backend down, RPC down, source lost, operator quorum. The credits, scheduler and store rows are operating procedures; the drill is no evidence that every row was rehearsed. Record each exercise's release, environment and actual outcome in the [mainnet preparation dossier](../mainnet/PREPARATION.md).

| Incident | What the contract does by itself | What the operator does | What the holder is told |
| --- | --- | --- | --- |
| The issuer freezes A (transfers revert) | A claims revert (`TransferFailed`); B pays; mints revert | Signer proposes a mint pause, quorum executes; B **not** paused; incident naming A | "A claims wait, recorded, while the issuer's contract refuses transfers. B claims pay." |
| The series is short of A | `ShortfallHaltsPayment(0)` for every A claim; B pays; mints revert (`BackingShort`) | Pause minting; reconcile amount and since-block; contact the issuer if the shortfall is theirs; B not paused | "Short *n* units of A at block *b*. No A claim is paid until resolved, so none is paid ahead of another. B pays." |
| The backend is down | Nothing: permits on chain; claims pay | Restore the tick; the index catches up from its cursor | "The site is behind. Claim from any wallet at the contract address on the series page." |
| The RPC fails | Nothing on chain | Reads report `HEAD_UNREAD` / `UNKNOWN`; cursor kept; no rollback; switch endpoint | "Figures are not being read; nothing shown is guessed." |
| A source is lost | Nothing on chain | Archive keeps the last record; STALE names the source; read the issuer's page | "Issuer record unfetched since *t*; last archived version shown as such." |
| A stop is needed and the operator is a quorum | Nothing until the quorum executes; minting continues if other checks allow | One signer proposes at once, a second confirms (2-of-3 Safe). Record proposal time apart from the executed stop. Without quorum: escalate, show the pause as pending; no single signer can force it | "Stop requested at *t1*; minting stopped when the operator transaction executed at block *b*, time *t2*, reason *r*." |
| The credit desk has no rate (the pool is empty, the feed answers nothing, the node cannot serve the block) | Nothing: top-ups still reach the treasury and emit their event | No credit at a guess: top-ups wait, listed; STALE names why; read the pool. Pool gone for good: replace the price source from the chain (new pool, its creation block); waiting top-ups mined before it are priced at the head when indexed, and the credit says so | "No rate since *t*. Your top-up is on chain and is credited once a rate is read. Nothing is quoted meanwhile." |
| The desk's code or treasury is not the record's | Nothing: the contract is what it is | DARK halts nothing on chain (nothing to halt); services page marks the desk untrusted. Find which changed, record or chain; no top-up invited until settled | "The desk at *a* is not the contract this site describes; do not pay it until this notice is withdrawn." |
| A block with a top-up is reorganised | The chain forgets the top-up | Indexer uncredits it and rereads the height; a top-up that lands again is credited at its new block's rate | "A top-up in block *b* was removed by the chain, with its credit; if mined again, it is credited again." |
| The store is unreachable | Nothing on chain. An unadmitted paid call fails without a debit; a debit whose commit acknowledgement was lost may report `charged: UNKNOWN` | `/api/state`: STORE_UNREADABLE, with reason. Keep request/settlement identifiers and logs; restore access; reconcile an uncertain debit by its existing identifier, never with a second debit; resume indexing from the preserved cursor | "Record unreadable since *t*. Your charge: [NO / UNKNOWN / confirmed amount], as recorded. UNKNOWN is being reconciled; it does not mean nothing was charged. The chain is unaffected." |
| The RPC endpoint refuses or runs out | Nothing on chain | A non-answering endpoint (transport, state-read timeout, quota, spent balance) is passed over for the other, retried after a minute. With the paid endpoint out of balance, head reads carry on from the public node; logs and past-block state fall to it too, within its limits (ten thousand logs a query, about ten minutes of state). Fix: top up, or unset `CURB_RPC_URL`. An overlong log page is halved on the same endpoint; a wrong answer is never retried elsewhere. Public node down: reads UNREAD, cursor kept, `credits:index:*` conditions say so | "Figures are not being read; nothing shown is guessed." |
| The alert webhook is gone | Nothing; subscribers still get their own deliveries | Tick reports alert delivery FAILED (a red run); `/api/state` keeps the standing set. Replace `CURB_ALERT_WEBHOOK`, redeploy; changes meanwhile post once, as a transition | — |
| The scheduler stops | Nothing on chain; the site serves the last record with its age | `reportingLastHour` on `/api/state` falls to zero; ages grow. Run the tick by hand (`gh workflow run tick`), then find why: the sixty-day rule, a revoked secret, a GitHub outage | "The desk has not run since *t*; every figure carries its age." |
| The store's schema is behind the build | Nothing on chain; writes needing the missing column fail and say so | Tick and `/api/state` show `storeSchema: BEHIND`, naming the column. Run `npm run db:migrate` (idempotent); the next tick writes | — |

## Lost access and lost keys

- **A holder whose claim permit is revoked** keeps every recorded claim and may still allocate remaining lots for exit. Payment resumes to the same address after the access process ([ADR-003](ADR-003-on-chain-access.md)). Nothing is moved.
- **A holder who loses their keys** loses what that address holds, as with the components themselves. The series cannot reassign a claim or pay it elsewhere ([ADR-005](ADR-005-no-sweep-claims-to-holder.md)). **No recovery is promised**, and none is offered informally.
- **A signer who loses a key** is rotated under [the operator policy](OPERATIONS.md#signer-rotation); quorum must still hold. If it does not, the series keeps paying under existing permits and cannot be paused or extended. That is by design, and said.

## What is never said

- That a reverted transaction means the issuer is bankrupt.
- That a shortfall of token units is a finding about shares in custody.
- That a claim will be paid by a date, or that a pending claim has a recovery value.
- That anyone's rights were moved to make an incident easier.

## Communication

Each incident gets a dated series-page entry: operation, component, block, the on-chain reason string, next review date. The same text goes to the alert webhook. Holders are not contacted individually: the Curb does not hold their contact details, though the access process may.

## What exists today

The conditions, alert delivery and series status blocks exist. `contracts/evidence/drill-local.json` records the six local position scenarios above, with mock components. It does not establish public operator readiness or all credits procedures. The Robinhood Chain treasury creation is recorded separately. These local records establish no approved public CompanySeries or CreditDesk deployment; current production incidents need their own dated evidence.
