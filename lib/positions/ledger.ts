/**
 * The position ledger — the accounting model of a series, as a pure function
 * of its own state.
 *
 * A series holds exactly two components and a fixed number of base units of
 * each per lot. A receipt is one whole lot. The rules here are the ones the
 * blueprint proposes for a series contract; they are modelled in code so the
 * simulation on the site and the tests run the same arithmetic, and so a
 * change to a rule is a change to one file.
 *
 *   n        lots outstanding
 *   q[i]     base units of component i per lot — integer, immutable
 *   A[i]     active liability            = n × q[i]
 *   R[i]     reserved for exit           = Σ claims[u][i]
 *   L[i]     total liability             = A[i] + R[i]
 *   B[i]     real balance held by the series
 *   solvent  B[i] ≥ L[i]   — in units of the token, and only that
 *
 * Nothing here calls anything outside itself: an exit is a change to the
 * ledger, and a claim of one component never reads the other. A model, not
 * an audited contract — the site says so wherever this runs.
 */

export type ComponentId = 'A' | 'B';
export const COMPONENTS: readonly ComponentId[] = ['A', 'B'];

export type Units = Record<ComponentId, bigint>;

export interface LedgerState {
  /** Base units of each component per lot. Immutable for the life of the series. */
  readonly q: Units;
  /** The most lots whose liabilities — active and reserved — the series may carry. */
  readonly capLots: bigint;
  /** Lots outstanding. */
  readonly n: bigint;
  /** Base units of each component held. */
  readonly balances: Units;
  /** Base units of each component allocated for exit and not yet paid. */
  readonly reserved: Units;
  /** Receipts per holder. */
  readonly receipts: Readonly<Record<string, bigint>>;
  /** Unpaid claims per holder per component. */
  readonly claims: Readonly<Record<string, Units>>;
  /** Whether the component's token can currently be transferred at all. Set by the world, not by the series. */
  readonly transferable: Record<ComponentId, boolean>;
  /** Whether the operator has stopped minting. */
  readonly mintPaused: boolean;
  /** Whether the operator has stopped paying claims of a component. */
  readonly claimPaused: Record<ComponentId, boolean>;
}

export type LedgerFailure =
  | 'LOTS_MUST_BE_POSITIVE'
  | 'MINT_PAUSED'
  | 'COMPONENT_NOT_TRANSFERABLE'
  | 'CAP_EXCEEDED'
  | 'BACKING_SHORT_AFTER_DEPOSIT'
  | 'INSUFFICIENT_RECEIPTS'
  | 'NOTHING_TO_CLAIM'
  | 'CLAIM_PAUSED'
  | 'SHORTFALL_HALTS_PAYMENT';

export type LedgerResult =
  | { readonly ok: true; readonly state: LedgerState; readonly note: string }
  | { readonly ok: false; readonly reason: LedgerFailure; readonly component?: ComponentId; readonly detail: string };

const ZERO: Units = { A: 0n, B: 0n };

export function openSeries(q: Units, capLots: bigint): LedgerState {
  if (q.A <= 0n || q.B <= 0n) throw new Error('every q[i] must be a positive integer');
  if (capLots <= 0n) throw new Error('capLots must be positive');
  return {
    q,
    capLots,
    n: 0n,
    balances: { ...ZERO },
    reserved: { ...ZERO },
    receipts: {},
    claims: {},
    transferable: { A: true, B: true },
    mintPaused: false,
    claimPaused: { A: false, B: false },
  };
}

/** Active liability of one component: what outstanding receipts are owed. */
export function active(state: LedgerState, i: ComponentId): bigint {
  return state.n * state.q[i];
}

/** Total liability of one component: active plus everything allocated for exit. */
export function liability(state: LedgerState, i: ComponentId): bigint {
  return active(state, i) + state.reserved[i];
}

/** Units held beyond the liability. Never used to price a mint, never sweepable. */
export function surplus(state: LedgerState, i: ComponentId): bigint {
  const s = state.balances[i] - liability(state, i);
  return s > 0n ? s : 0n;
}

/** Units the liability exceeds the balance by. While positive, that component pays nobody. */
export function shortfall(state: LedgerState, i: ComponentId): bigint {
  const s = liability(state, i) - state.balances[i];
  return s > 0n ? s : 0n;
}

export function receiptsOf(state: LedgerState, holder: string): bigint {
  return state.receipts[holder] ?? 0n;
}

export function claimsOf(state: LedgerState, holder: string): Units {
  return state.claims[holder] ?? { ...ZERO };
}

/**
 * Mint k lots for a holder against a deposit of exactly k × q[i] of each
 * component. Both deposits land or neither does; the receipt exists only
 * after both. Backing is checked against the whole liability afterwards, so a
 * deposit that is exact cannot quietly cover an older shortfall, and the cap
 * counts reserved units so burning and re-minting cannot hide them.
 */
export function mint(state: LedgerState, holder: string, k: bigint): LedgerResult {
  if (k <= 0n) return { ok: false, reason: 'LOTS_MUST_BE_POSITIVE', detail: 'a mint is a positive whole number of lots' };
  if (state.mintPaused) return { ok: false, reason: 'MINT_PAUSED', detail: 'the operator has stopped minting; existing receipts and claims are unaffected' };

  for (const i of COMPONENTS) {
    if (!state.transferable[i]) {
      return {
        ok: false,
        reason: 'COMPONENT_NOT_TRANSFERABLE',
        component: i,
        detail: `component ${i} cannot be transferred into the series, so the whole mint reverts — no partial deposit is final`,
      };
    }
    if ((state.n + k) * state.q[i] + state.reserved[i] > state.capLots * state.q[i]) {
      return {
        ok: false,
        reason: 'CAP_EXCEEDED',
        component: i,
        detail: `the cap of ${state.capLots} lots counts reserved units of ${i} as well as outstanding receipts`,
      };
    }
  }

  const balances: Units = { A: state.balances.A + k * state.q.A, B: state.balances.B + k * state.q.B };
  for (const i of COMPONENTS) {
    if (balances[i] < (state.n + k) * state.q[i] + state.reserved[i]) {
      return {
        ok: false,
        reason: 'BACKING_SHORT_AFTER_DEPOSIT',
        component: i,
        detail: `after the deposit the series would hold less ${i} than it owes; an exact deposit does not cover an older shortfall`,
      };
    }
  }

  return {
    ok: true,
    state: {
      ...state,
      n: state.n + k,
      balances,
      receipts: { ...state.receipts, [holder]: receiptsOf(state, holder) + k },
    },
    note: `${holder} deposited ${k * state.q.A} A and ${k * state.q.B} B and holds ${k} more lot${k === 1n ? '' : 's'}`,
  };
}

/**
 * Allocate k lots for exit: the receipts are burned and the holder's right to
 * k × q[i] of every component is recorded as a claim. Only the ledger changes.
 * The total liability of each component is the same before and after.
 */
export function allocateExit(state: LedgerState, holder: string, k: bigint): LedgerResult {
  if (k <= 0n) return { ok: false, reason: 'LOTS_MUST_BE_POSITIVE', detail: 'an exit is a positive whole number of lots' };
  const held = receiptsOf(state, holder);
  if (held < k) return { ok: false, reason: 'INSUFFICIENT_RECEIPTS', detail: `${holder} holds ${held} lot${held === 1n ? '' : 's'}, not ${k}` };

  const prior = claimsOf(state, holder);
  return {
    ok: true,
    state: {
      ...state,
      n: state.n - k,
      receipts: { ...state.receipts, [holder]: held - k },
      reserved: { A: state.reserved.A + k * state.q.A, B: state.reserved.B + k * state.q.B },
      claims: { ...state.claims, [holder]: { A: prior.A + k * state.q.A, B: prior.B + k * state.q.B } },
    },
    note: `${holder} burned ${k} lot${k === 1n ? '' : 's'}; ${k * state.q.A} A and ${k * state.q.B} B moved from active to reserved`,
  };
}

/**
 * Pay one holder's whole claim of one component, to that holder only. The
 * other component is not read. If the series holds less of this component
 * than it owes in total, nobody is paid from it — the fastest claimant does
 * not get the remainder before the shortfall is acknowledged.
 */
export function claim(state: LedgerState, holder: string, i: ComponentId): LedgerResult {
  const owed = claimsOf(state, holder)[i];
  if (owed <= 0n) return { ok: false, reason: 'NOTHING_TO_CLAIM', component: i, detail: `${holder} has no unpaid claim of ${i}` };
  if (state.claimPaused[i]) return { ok: false, reason: 'CLAIM_PAUSED', component: i, detail: `claims of ${i} are stopped by the operator; the claim stays recorded` };
  if (!state.transferable[i]) {
    return { ok: false, reason: 'COMPONENT_NOT_TRANSFERABLE', component: i, detail: `${i} cannot be transferred out right now; the claim of ${owed} stays recorded in full` };
  }
  if (state.balances[i] < liability(state, i)) {
    return {
      ok: false,
      reason: 'SHORTFALL_HALTS_PAYMENT',
      component: i,
      detail: `the series holds ${state.balances[i]} ${i} against a liability of ${liability(state, i)}; payment of ${i} is halted for everyone until that is resolved`,
    };
  }

  const prior = claimsOf(state, holder);
  return {
    ok: true,
    state: {
      ...state,
      balances: { ...state.balances, [i]: state.balances[i] - owed },
      reserved: { ...state.reserved, [i]: state.reserved[i] - owed },
      claims: { ...state.claims, [holder]: { ...prior, [i]: 0n } },
    },
    note: `${holder} was paid ${owed} ${i}; nobody else's liability changed`,
  };
}

/** Units sent straight to the series. They change no lot, no receipt and no claim. */
export function donate(state: LedgerState, i: ComponentId, amount: bigint): LedgerState {
  if (amount <= 0n) return state;
  return { ...state, balances: { ...state.balances, [i]: state.balances[i] + amount } };
}

/** Units leaving the series by any path but a claim — modelling a loss, so the shortfall rules can be seen. */
export function lose(state: LedgerState, i: ComponentId, amount: bigint): LedgerState {
  if (amount <= 0n) return state;
  const next = state.balances[i] - amount;
  return { ...state, balances: { ...state.balances, [i]: next < 0n ? 0n : next } };
}

export function setTransferable(state: LedgerState, i: ComponentId, value: boolean): LedgerState {
  return { ...state, transferable: { ...state.transferable, [i]: value } };
}

export function setMintPaused(state: LedgerState, value: boolean): LedgerState {
  return { ...state, mintPaused: value };
}

export function setClaimPaused(state: LedgerState, i: ComponentId, value: boolean): LedgerState {
  return { ...state, claimPaused: { ...state.claimPaused, [i]: value } };
}

export interface InvariantReport {
  readonly holds: boolean;
  readonly lines: readonly { readonly name: string; readonly holds: boolean; readonly detail: string }[];
}

/** The invariants the blueprint names, checked against a state. */
export function checkInvariants(state: LedgerState): InvariantReport {
  const lines = [];
  for (const i of COMPONENTS) {
    const sumClaims = Object.values(state.claims).reduce((acc, c) => acc + c[i], 0n);
    lines.push({
      name: `R[${i}] = Σ claims[${i}]`,
      holds: sumClaims === state.reserved[i],
      detail: `${state.reserved[i]} reserved, ${sumClaims} in claims`,
    });
    lines.push({
      name: `B[${i}] ≥ L[${i}]`,
      holds: state.balances[i] >= liability(state, i),
      detail: `${state.balances[i]} held against ${liability(state, i)} owed (${active(state, i)} active + ${state.reserved[i]} reserved)`,
    });
    lines.push({
      name: `L[${i}] ≤ cap × q[${i}]`,
      holds: liability(state, i) <= state.capLots * state.q[i],
      detail: `${liability(state, i)} owed of ${state.capLots * state.q[i]} permitted`,
    });
  }
  const sumReceipts = Object.values(state.receipts).reduce((acc, r) => acc + r, 0n);
  lines.push({ name: 'n = Σ receipts', holds: sumReceipts === state.n, detail: `${state.n} outstanding, ${sumReceipts} held` });
  return { holds: lines.every((l) => l.holds), lines };
}
