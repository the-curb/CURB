# THE CURB — the series contract, as a prototype

`src/CompanySeries.sol` is the mechanism's §7, §9.1 and §11 written down as
a contract: two distinct components, fixed units per lot, in-kind mint with
balance-delta and whole-liability checks, exit allocation that touches no
token, a claim per component that never reads the other, on-chain mint and
claim permits, per-operation and per-component stops, and nothing that
sweeps, mints without a deposit, swaps a component, or transfers a receipt.

**A design under test.** Unaudited. Undeployed. No address exists for it
anywhere, and the site says NOT_DEPLOYED until a reviewed deployment record
is configured. Passing tests are not a claim that it is safe.

## Run

```bash
cd contracts
npm install
npm run build
npm test          # hardhat test solidity
```

Hardhat 3 runs the Solidity tests in `test/` with forge-std cheatcodes; the
fuzz case runs 256 sequences of mints, exits and claims and holds the
invariants after every step. The mocks in `src/mocks/` switch on each
misbehaviour the blueprint names — an issuer halt, a transfer that returns
false, a fee on transfer, a reentrant callback, a `balanceOf` that reverts.

## The fork tests

`test/fork/AppleComponentsFork.t.sol` runs against a fork of Ethereum at
the latest block (`ETH_RPC_URL`, or the public node) and asks the candidate
component the questions of gate G3: does the wrapper answer as the issuer
documents, can an arbitrary address move it, can a series contract take it
in and pay it out, does it unwrap, what size is it, and who stands behind
each address (the EIP-1967 implementation and admin slots read from
storage, `owner()` and `paused()` where answered). Balances are set by
storage, so no holder is impersonated. The last test writes what it found
to `evidence/apple-s1.fork.json`, which is committed with the block it ran
at and shown on the series page.

```bash
npm run test:fork
```

A public node serves recent state only, so the block is not pinned; an
archive endpoint in `ETH_RPC_URL` pins one. Component B is a mock here:
Ondo's record is behind an API key this desk does not hold.

## Rehearsal on a local node

The site's index, ledger replay, reconciliation and wallet endpoints can be
run against this contract on a Hardhat node on this machine, with the
blueprint's worked example sent as real transactions — Alice mints 25,
others 75, Alice allocates 25 for exit, the issuer halts A, her A claim
reverts and her B claim pays, A resumes, Bob mints 10.

```bash
npx hardhat node                 # one terminal: chain id 31337, unlocked accounts
node scripts/rehearsal.ts        # another: deploys mocks + the series, runs the example, prints one JSON line
```

Copy the printed line into the site's test run from the repository root:

```bash
CURB_REHEARSAL_DEPLOYMENTS='<that line>' npm test
```

`tests/positions-rehearsal.test.ts` then reads the five events back in the
order the chain emitted them, replays them through the ledger (85 lots,
250 A reserved), syncs a second time without applying anything twice,
reconciles A and B against `balanceOf` (both `MATCHED`), and has the node
simulate the bytes the previews prepare for a wallet from the holders' own
addresses — accepted where the contract should accept them, reverted where
it should not. Without the variable the test skips; nothing here touches a
public chain or holds a key.

## What the tests cover, in the blueprint's numbering

T01–T12, T17, T19, T20, T22–T25, the operator's limits, the preview
deadline, the worked example row by row, and the fuzz. On the fork: the
real wrapper's identity, transfer, series round trip and unwrap (T21:
it unwraps), and the raw token's transfer and derived balance. On the local
node: T16 and T18 in the part a local chain can show — a running index and
reconciliation against real events. Not covered: T13 (prices — the contract
has none), T14 (a corporate action across a recorded block), and anything
on a public chain.

The events the contract emits are the ones `lib/positions/events.ts`
decodes; `tests/contract-events.test.ts` in the repository root checks the
committed ABI fixture against a built artifact whenever one exists.
