# The venue, as read

What the operator's PONS v2 tools wrote, each from the chain at a named block:

- `preflight.4663.<block>.json` — the venue's live terms at that block (`pons-preflight.ts`): whether launching is open, the launch fee, launch config 0, the hook and the PoolManager the factory names, and the `expectedEconomics` digest a launch record pins. Every term is editable by the venue's owner; the launch tool reads them again in the block it sends and refuses if the digest moved.
- `pool.4663.<token>.json` — a graduated launch's pool as the chain states it (`pons-pool.ts`): the factory's record, the key derived as the factory sorts it, the `Initialize` in the graduation block stating that key, the lens's answer now, and the `priceSource` the desk's record takes. The first of these, for token `0xd1a4…5f19`, is a **rehearsal on a third party's launch** — not The Curb's token — made on 17 September 2026 to prove the tool and the desk's v4 reader against a real pool; the desk read it by state (US$0.00000270 a token, guard and feed included, 966 ms), by events (the Swap at block 64,939,414) and refused the block before its `Initialize` as a definite no-price.
- `launch.4663.json` — The Curb's own launch, when it is sent (`pons-launch.ts --send --reviewed`): the plan, the transaction, and the token as the factory recorded it. Does not exist yet.

None of these is a term of The Curb's; the decided record is `docs/decisions/TOKEN.md`, and what the venue was found to be is `docs/mainnet/EXTERNAL-FACTS-2026-09-17-PONS-V2.md`.
