import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  active,
  allocateExit,
  checkInvariants,
  claim,
  claimsOf,
  donate,
  liability,
  lose,
  mint,
  openSeries,
  receiptsOf,
  setClaimPaused,
  setMintPaused,
  setTransferable,
  shortfall,
  surplus,
  type LedgerState,
} from '../lib/positions/ledger.ts';
import { WORKED_EXAMPLE } from '../lib/positions/series.ts';

/**
 * The blueprint's test plan, run against the ledger model. Each case names
 * the blueprint scenario it covers. The model is the arithmetic a series
 * contract would have to implement; these are the properties it must keep.
 */

const q = { A: 10n, B: 20n };

function ok(result: ReturnType<typeof mint>): LedgerState {
  assert.equal(result.ok, true, result.ok ? '' : `${result.reason}: ${result.detail}`);
  return result.ok ? result.state : (undefined as never);
}

function fail(result: ReturnType<typeof mint>, reason: string): void {
  assert.equal(result.ok, false, 'expected a refusal');
  if (!result.ok) assert.equal(result.reason, reason);
}

describe('the position ledger', () => {
  it('T01 — mints exactly, and never owes more than it holds', () => {
    const s = ok(mint(openSeries(q, 1_000n), 'alice', 3n));
    assert.equal(s.n, 3n);
    assert.equal(receiptsOf(s, 'alice'), 3n);
    assert.deepEqual(s.balances, { A: 30n, B: 60n });
    assert.equal(liability(s, 'A'), 30n);
    assert.equal(liability(s, 'B'), 60n);
    assert.equal(checkInvariants(s).holds, true);
  });

  it('T02 — a second component that cannot arrive reverts the whole mint', () => {
    const halted = setTransferable(openSeries(q, 1_000n), 'B', false);
    const result = mint(halted, 'alice', 3n);
    fail(result, 'COMPONENT_NOT_TRANSFERABLE');
    assert.equal(halted.n, 0n);
    assert.deepEqual(halted.balances, { A: 0n, B: 0n });
    assert.equal(receiptsOf(halted, 'alice'), 0n);
  });

  it('T03 — an exit moves rights from active to reserved and changes no total liability', () => {
    const before = ok(mint(openSeries(q, 1_000n), 'alice', 4n));
    const after = ok(allocateExit(before, 'alice', 1n));
    for (const i of ['A', 'B'] as const) {
      assert.equal(liability(after, i), liability(before, i));
      assert.equal(active(after, i), active(before, i) - q[i]);
      assert.equal(after.reserved[i], q[i]);
    }
    assert.equal(receiptsOf(after, 'alice'), 3n);
    assert.deepEqual(claimsOf(after, 'alice'), { A: 10n, B: 20n });
    assert.equal(checkInvariants(after).holds, true);
  });

  it('T04 — a halted A leaves the A claim intact and lets B be claimed without touching A', () => {
    let s = ok(mint(openSeries(q, 1_000n), 'alice', 2n));
    s = ok(allocateExit(s, 'alice', 2n));
    s = setTransferable(s, 'A', false);

    fail(claim(s, 'alice', 'A'), 'COMPONENT_NOT_TRANSFERABLE');
    assert.equal(claimsOf(s, 'alice').A, 20n, 'the claim is still recorded in full');

    const paidB = ok(claim(s, 'alice', 'B'));
    assert.equal(claimsOf(paidB, 'alice').B, 0n);
    assert.equal(paidB.balances.B, 0n);
    assert.equal(paidB.balances.A, 20n, 'A was not read or moved');
    assert.equal(paidB.reserved.A, 20n);
  });

  it('T05 — a claim pays once, and only to its holder', () => {
    let s = ok(mint(openSeries(q, 1_000n), 'alice', 1n));
    s = ok(allocateExit(s, 'alice', 1n));
    s = ok(claim(s, 'alice', 'A'));
    fail(claim(s, 'alice', 'A'), 'NOTHING_TO_CLAIM');
    fail(claim(s, 'bob', 'A'), 'NOTHING_TO_CLAIM');
    assert.equal(s.balances.A, 0n);
  });

  it('T06 — a depositor after pending claims gets no part of the reserve', () => {
    let s = ok(mint(openSeries(q, 1_000n), 'alice', 5n));
    s = ok(allocateExit(s, 'alice', 5n));
    s = ok(mint(s, 'bob', 2n));
    assert.equal(s.reserved.A, 50n);
    assert.equal(claimsOf(s, 'alice').A, 50n);
    assert.equal(active(s, 'A'), 20n, "bob's lots are backed by bob's deposit");
    assert.equal(s.balances.A, 70n);
    assert.equal(checkInvariants(s).holds, true);
  });

  it('T07 — a donation changes no lot, no receipt and no claim', () => {
    const empty = donate(openSeries(q, 1_000n), 'A', 999n);
    assert.equal(empty.n, 0n);
    assert.equal(surplus(empty, 'A'), 999n);

    const minted = ok(mint(empty, 'alice', 1n));
    assert.equal(receiptsOf(minted, 'alice'), 1n);
    assert.equal(minted.balances.A, 1_009n);
    assert.equal(liability(minted, 'A'), 10n, 'the surplus prices nothing and backs nothing');

    const later = donate(minted, 'B', 5n);
    assert.equal(later.n, minted.n);
    assert.deepEqual(later.claims, minted.claims);
  });

  it('T08 — a component held short of its liability pays nobody, so there is no race', () => {
    let s = ok(mint(openSeries(q, 1_000n), 'alice', 2n));
    s = ok(mint(s, 'bob', 2n));
    s = ok(allocateExit(s, 'alice', 2n));
    s = ok(allocateExit(s, 'bob', 2n));
    s = lose(s, 'A', 15n); // 40 owed, 25 held
    assert.equal(shortfall(s, 'A'), 15n);
    fail(claim(s, 'alice', 'A'), 'SHORTFALL_HALTS_PAYMENT');
    fail(claim(s, 'bob', 'A'), 'SHORTFALL_HALTS_PAYMENT');
    assert.equal(s.balances.A, 25n, 'nothing left early');
    ok(claim(s, 'alice', 'B'));
  });

  it('T11 — zero supply with reserved claims does not let a new mint adopt them', () => {
    let s = ok(mint(openSeries(q, 1_000n), 'alice', 1n));
    s = ok(allocateExit(s, 'alice', 1n));
    assert.equal(s.n, 0n);
    s = ok(mint(s, 'bob', 1n));
    assert.equal(s.balances.A, 20n);
    assert.equal(s.reserved.A, 10n);
    assert.equal(claimsOf(s, 'alice').A, 10n);
    assert.equal(checkInvariants(s).holds, true);
  });

  it('T12 — integers only: a large lot count and 18-decimal units do not lose precision', () => {
    const big = { A: 10n ** 18n, B: 2n * 10n ** 18n };
    const s = ok(mint(openSeries(big, 10n ** 9n), 'alice', 123_456_789n));
    assert.equal(s.balances.A, 123_456_789n * 10n ** 18n);
    assert.equal(liability(s, 'B'), 123_456_789n * 2n * 10n ** 18n);
    assert.equal(checkInvariants(s).holds, true);
  });

  it('T19 — a series with a non-positive unit per lot cannot be opened', () => {
    assert.throws(() => openSeries({ A: 0n, B: 20n }, 1_000n));
    assert.throws(() => openSeries({ A: 10n, B: -1n }, 1_000n));
  });

  it('T22 — burning and re-minting cannot get past a cap that counts reserved units', () => {
    let s = ok(mint(openSeries(q, 10n), 'alice', 10n));
    s = ok(allocateExit(s, 'alice', 10n));
    assert.equal(s.n, 0n);
    fail(mint(s, 'bob', 1n), 'CAP_EXCEEDED');
    s = ok(claim(s, 'alice', 'A'));
    fail(mint(s, 'bob', 1n), 'CAP_EXCEEDED');
    s = ok(claim(s, 'alice', 'B'));
    ok(mint(s, 'bob', 1n));
  });

  it('T23 — an exact deposit does not quietly cover an older shortfall', () => {
    let s = ok(mint(openSeries(q, 1_000n), 'alice', 2n));
    s = lose(s, 'B', 5n);
    fail(mint(s, 'bob', 1n), 'BACKING_SHORT_AFTER_DEPOSIT');
    assert.equal(receiptsOf(s, 'bob'), 0n);
  });

  it('T24 — supply changes only through a full deposit or an exit allocation', () => {
    const s = ok(mint(openSeries(q, 1_000n), 'alice', 1n));
    fail(mint(s, 'alice', 0n), 'LOTS_MUST_BE_POSITIVE');
    fail(allocateExit(s, 'alice', 2n), 'INSUFFICIENT_RECEIPTS');
    fail(allocateExit(s, 'bob', 1n), 'INSUFFICIENT_RECEIPTS');
    assert.equal(s.n, 1n);
  });

  it('operator stops are per operation and per component, and touch no right', () => {
    let s = ok(mint(openSeries(q, 1_000n), 'alice', 1n));
    s = ok(allocateExit(s, 'alice', 1n));
    const paused = setMintPaused(s, true);
    fail(mint(paused, 'bob', 1n), 'MINT_PAUSED');
    const stoppedA = setClaimPaused(paused, 'A', true);
    fail(claim(stoppedA, 'alice', 'A'), 'CLAIM_PAUSED');
    assert.equal(claimsOf(stoppedA, 'alice').A, 10n);
    ok(claim(stoppedA, 'alice', 'B'));
  });

  it('reproduces the worked example, row by row', () => {
    const { q: eq, capLots, lots, alice, bob } = WORKED_EXAMPLE;
    let s = openSeries(eq, capLots);
    s = ok(mint(s, 'alice', alice));
    s = ok(mint(s, 'others', lots - alice));
    const row = (state: LedgerState) => [state.n, active(state, 'A'), state.reserved.A, active(state, 'B'), state.reserved.B];
    assert.deepEqual(row(s), [100n, 1_000n, 0n, 2_000n, 0n]);

    s = ok(allocateExit(s, 'alice', alice));
    assert.deepEqual(row(s), [75n, 750n, 250n, 1_500n, 500n]);

    s = setTransferable(s, 'A', false);
    fail(claim(s, 'alice', 'A'), 'COMPONENT_NOT_TRANSFERABLE');
    s = ok(claim(s, 'alice', 'B'));
    assert.deepEqual(row(s), [75n, 750n, 250n, 1_500n, 0n]);

    fail(mint(s, 'bob', bob), 'COMPONENT_NOT_TRANSFERABLE');
    s = setTransferable(s, 'A', true);
    s = ok(mint(s, 'bob', bob));
    assert.deepEqual(row(s), [85n, 850n, 250n, 1_700n, 0n]);
    assert.equal(claimsOf(s, 'alice').A, 250n, 'alice still holds her claim; bob got no part of it');
    assert.equal(checkInvariants(s).holds, true);
  });
});
