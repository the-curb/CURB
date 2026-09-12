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
in and pay it out, does it unwrap, and what size is it. Balances are set by
storage, so no holder is impersonated. The last test writes what it found
to `evidence/apple-s1.fork.json`, which is committed with the block it ran
at and shown on the series page.

```bash
npm run test:fork
```

A public node serves recent state only, so the block is not pinned; an
archive endpoint in `ETH_RPC_URL` pins one. Component B is a mock here:
Ondo's record is behind an API key this desk does not hold.

## What the tests cover, in the blueprint's numbering

T01–T12, T17, T19, T20, T22–T25, the operator's limits, the preview
deadline, the worked example row by row, and the fuzz. On the fork: the
real wrapper's identity, transfer, series round trip and unwrap (T21:
it unwraps), and the raw token's transfer and derived balance. Not covered:
T13 (prices — the contract has none), T14 (a corporate action across a
recorded block), T16 and T18 (a running index and a backend).

The events the contract emits are the ones `lib/positions/events.ts`
decodes; `tests/contract-events.test.ts` in the repository root checks the
committed ABI fixture against a built artifact whenever one exists.
