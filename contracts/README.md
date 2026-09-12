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

## Deploying a series, one day (G02)

`scripts/deploy-series.ts <record.json> [--dry-run] [--reviewed]` deploys one
series from a reviewed deployment record — see `records/apple-s1.example.json`
for the shape, and `docs/decisions/DEPLOYMENT.md` for the plan. It refuses
an unreviewed record, a node on the wrong chain, components that do not
answer as the record says, and a public chain without `--reviewed`; the key
comes from `DEPLOYER_PRIVATE_KEY` in the operator's shell and is never
printed. Rehearsed on a local chain only.

## The operator's bytes (O01)

`node scripts/operator-calldata.mjs <series> <mint-permit|claim-permit|pause-mint|pause-claims|transfer-operator> …`
prints `to` and `data` for one operator action, for the multisig to sign;
a stop or a resume without a reason is refused.

## The recorded build (G02)

`npm run record:build` writes the compiled runtime bytecode, where its
immutables sit in it, the compiler version and the commit to
`evidence/CompanySeries.build.json` (five immutables) and
`evidence/CreditDesk.build.json` (two: the token and the treasury). The site
compares a deployed contract with its build on every tick: equal outside
the immutable slots, and the slots holding the reviewed record's values.
The rehearsal tests do the same against the local deployments.

## The recorded run (C07)

`npm run record:tests` runs the unit tests with the fuzz seed pinned in
`hardhat.config.ts` and writes the seed, the runs, every test's result and
the commit to `evidence/unit-tests.json`, which is committed and shown on
the series page. Record after committing, so the record names a clean tree.
A passing run is not a review and not an audit.

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
archive endpoint in `ETH_RPC_URL` pins one. Component B is the address the
issuer's product page publishes for AAPLon (never the API specification's
example): the B tests ask it the same questions and run one series with
both components real. The public node throttles bursts; `ETH_RPC_URL=https://eth.drpc.org`
has answered.

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

## The drill on a local node (O02)

`scripts/drill.ts` stages the incidents the blueprint names, on a fresh
series on the same Hardhat node: the issuer freezes A (claims of A revert,
claims of B pay, minting is refused, then A resumes and the A claim pays);
the operator role is handed to a 2-of-3 multisig (`src/mocks/MockMultisig.sol`,
a stand-in for a Safe) and a stop and a resume each need two signatures,
with the former single key refused; the issuer seizes part of the A the
series holds (A's whole-liability check halts A payments, B still pays,
minting is refused); a holder claims with no backend involved. Every
transaction hash and every revert name is kept.

```bash
node scripts/drill.ts > drill.json      # the chain half; one JSON line on stdout
```

The site half, from the repository root, reads that chain and stages the
two incidents that are the site's own — a node that stops answering and a
source that stops answering — then writes the whole drill, with who did
what, to `evidence/drill-local.json`, shown on the series page:

```bash
CURB_DRILL_RECORD="$(cat contracts/drill.json)" npm test
```

The same node serves the series page's wallet flow: with
`CURB_SERIES_DEPLOYMENTS` set to the rehearsal's line and a wallet pointed
at `http://127.0.0.1:8545` (chain id 31337), a permitted account mints and
claims from the page, and the next maintenance run indexes it.

## The credit desk on a local node (§16)

`src/CreditDesk.sol` is the token record's one function
(`docs/decisions/TOKEN.md`): `topUp(bytes32 keyHash, uint256 amount)` moves
CURB from the payer to the published treasury and emits the hash and the
amount, and it can do nothing else — no admin, no pause, no upgrade, no
balance. Fifteen tests in `test/CreditDesk.t.sol` hold that against a
token that halts, returns false, charges a fee, or was never approved.

`scripts/credits-rehearsal.ts` deploys a mock CURB, a mock dollar, a mock
pool (`src/mocks/MockPair.sol`, reserves set by hand) and the desk on the
same Hardhat node, tops a key hash up with 4,000 CURB at US$0.005 and, after
the pool has doubled, 1,000 more at US$0.01, and prints the record the site
reads:

```bash
node scripts/credits-rehearsal.ts > credits-rehearsal.json
CURB_REHEARSAL_CREDITS="$(cat contracts/credits-rehearsal.json)" npm test     # from the repository root
```

`tests/credits-rehearsal.test.ts` then reads the rate at the head (US$0.01,
a market capitalisation of US$10,000,000 on the mock's supply), finds the
desk's code to be the build in `evidence/CreditDesk.build.json` with the
record's token and treasury in its immutables, credits the two top-ups at
their own blocks (US$20.00 and US$10.00), finds the key open, syncs again
without crediting anything twice, and charges one paid call. No CURB
exists; the mock is a mock.

`scripts/deploy-credit-desk.ts <record.json> [--dry-run] [--reviewed]` deploys
the desk from a reviewed record — see `records/credit-desk.example.json` for
the shape (refused on purpose: nobody reviewed it) and
`docs/decisions/DEPLOYMENT.md` for the steps. It refuses an unreviewed
record, a node on the wrong chain, a token that does not answer as the
record says, a treasury without code on a public chain, and a public chain
without `--reviewed`; the key comes from `DEPLOYER_PRIVATE_KEY` in the
operator's shell and is never printed. Rehearsed on a local chain only.

The rehearsal, the drill and the credit desk's rehearsal also run on every
push, in the `rehearsal` job of `.github/workflows/checks.yml`: a Hardhat
node is started there, the transactions are sent, and the site's tests read
them back.

It found A `SHORTFALL` by exactly what was seized and B `MATCHED`, a DARK
condition on A alone, `HEAD_UNREAD` and `UNKNOWN` (not a shortfall) while
the node was down with the cursor kept, and a STALE condition naming the
lost source. Nobody was paged and nothing was recovered: the drill computes
the conditions, it does not deliver them, and what was seized stays seized.

## T14: across a corporate action

`test/fork/AppleCorporateActionFork.t.sol` forks Ethereum twice — at the
block before the issuer's last multiplier activation and at the activation
block (25,706,680, 8 August 2026 00:30 UTC, found by a binary search of
`multiplier()` over archive state) — and reads both sides: the raw
multiplier, the wrapper's shares, the wrapper's raw balance and its
conversion rate. It writes `evidence/apple-s1.corporate-action.json`. Two
pinned forks need an endpoint that serves archive state; the public
`https://eth.drpc.org` did.

## What the tests cover, in the blueprint's numbering

T01–T12, T17, T19, T20, T22–T25, the operator's limits, the preview
deadline, the worked example row by row, and the fuzz. On the fork: the
real wrapper's identity, transfer, series round trip and unwrap (T21:
it unwraps), and the raw token's transfer and derived balance. On the local
node: T16 and T18 in the part a local chain can show — a running index and
reconciliation against real events. Across a corporate action: T14, for one
dividend activation. Not covered: T13 (prices — the contract has none; the
site's valuation covers it), a split, and anything on a public chain.

The events the contract emits are the ones `lib/positions/events.ts`
decodes; `tests/contract-events.test.ts` in the repository root checks the
committed ABI fixture against a built artifact whenever one exists.
