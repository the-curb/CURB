/**
 * THE ARCHIVIST — corporate actions, read from the chain rather than announced.
 *
 * A stock token tracks the total return of its underlying: reinvested dividends
 * raise a multiplier, so one token comes to represent more than one share and
 * the feed price drifts above the headline share price. The multiplier is
 * readable on chain, and so is the next one, with the moment it takes effect.
 *
 * That makes a corporate action something this system can observe directly
 * instead of waiting for a notice — and it makes the failure case observable
 * too. A split the token did not follow is the whole story.
 *
 * Every stock token in the issuer's registry is read on every run, in one
 * batch, and compared with the previous run's snapshot of the same token. What
 * gets printed is the movement: which multipliers are not one, which moved
 * since the last reading, which changes are published but not yet effective.
 * A hundred and ninety-four unchanged multipliers are a count, not a list.
 *
 * `newUIMultiplier()` with `effectiveAt()` is the only forward-looking pair in
 * this codebase, and it is not a forecast: it is a change the issuer has already
 * published, with the time it applies.
 */

import type { Producer, ProducerResult } from '../runtime.ts';
import type { DeclaredFigure } from '../../doctrine/policy.ts';
import type { ObservationRecord, SnapshotRecord } from '../../store/types.ts';
import { isRead, type Reading } from '../../doctrine/reading.ts';
import { activeNetwork } from '../../chain/networks.ts';
import { SELECTORS, formatUnits } from '../../chain/abi.ts';
import { readMany, type Call } from '../../chain/multicall.ts';
import {
  decodeDecimals,
  decodeUintReading,
  formatMultiplier,
  formatMultiplierExact,
  MULTIPLIER_SCALE,
} from '../../chain/oracle.ts';
import { STOCK_TOKENS, STOCK_TOKENS_SOURCE, type StockTokenRecord } from '../../chain/stock-tokens.ts';
import { TOKENS } from '../../chain/tokens.ts';

const INTERVAL = 6 * 3600;

/** Questions a corporate action raises that bytecode cannot answer. */
const NOT_DERIVABLE = [
  'Why a multiplier moved. The chain records that it changed, not whether the cause was a dividend, a split, or a correction. The issuer’s notice is the only place that says.',
  'Whether a corporate action that should have moved a multiplier failed to. Absence of a change is not evidence that nothing happened — it is the case this agent exists to make visible, and it needs the issuer’s calendar to confirm.',
  'The tax or entitlement consequences of any action recorded here.',
] as const;

const ONE = MULTIPLIER_SCALE;

/** The raw answers for one stock token, before judgement. */
export interface TokenRead {
  readonly token: StockTokenRecord;
  readonly multiplier: Reading<bigint>;
  readonly next: Reading<bigint>;
  readonly effectiveAt: Reading<bigint>;
  readonly supply: Reading<bigint>;
  readonly decimals: Reading<number>;
}

/** What the previous run recorded for the same token, if it recorded anything. */
export interface TokenPrior {
  readonly multiplierRaw: string;
  readonly supplyRaw: string | null;
}

export interface TokenVerdict {
  readonly token: StockTokenRecord;
  readonly multiplier: bigint | null;
  readonly shown: string | null;
  readonly movedFrom: bigint | null;
  readonly pending: { readonly next: bigint; readonly effectiveAt: Date | null } | null;
  readonly supply: bigint | null;
  readonly supplyMoved: 'ISSUED' | 'REDEEMED' | null;
  readonly unreadBecause: string | null;
  readonly retrievedAt: string | null;
}

/** Judge one token against what was recorded for it last time. Pure. */
export function judgeToken(read: TokenRead, prior: TokenPrior | null, now: Date): TokenVerdict {
  const { token, multiplier, next, effectiveAt, supply, decimals } = read;
  const retrievedAt = isRead(multiplier) ? multiplier.retrievedAt : isRead(supply) ? supply.retrievedAt : null;

  const supplyValue = isRead(supply) && isRead(decimals) ? supply.value : null;
  const supplyMoved =
    supplyValue !== null && prior?.supplyRaw != null && BigInt(prior.supplyRaw) !== supplyValue
      ? supplyValue > BigInt(prior.supplyRaw)
        ? 'ISSUED'
        : 'REDEEMED'
      : null;

  if (!isRead(multiplier)) {
    return {
      token,
      multiplier: null,
      shown: null,
      movedFrom: null,
      pending: null,
      supply: supplyValue,
      supplyMoved,
      unreadBecause: `${multiplier.reason}${multiplier.detail ? ` — ${multiplier.detail}` : ''}`,
      retrievedAt,
    };
  }

  const movedFrom =
    prior !== null && BigInt(prior.multiplierRaw) !== multiplier.value ? BigInt(prior.multiplierRaw) : null;

  // A staged change is one whose value differs from the live one and whose
  // effective time has not passed. After it applies the contract keeps both
  // fields equal, and a past effectiveAt with equal values is history, not news.
  let pending: TokenVerdict['pending'] = null;
  if (isRead(next) && next.value !== multiplier.value) {
    const at = isRead(effectiveAt) && effectiveAt.value > 0n ? new Date(Number(effectiveAt.value) * 1000) : null;
    if (at === null || at.getTime() > now.getTime()) pending = { next: next.value, effectiveAt: at };
  }

  return {
    token,
    multiplier: multiplier.value,
    shown: formatMultiplier(multiplier.value),
    movedFrom,
    pending,
    supply: supplyValue,
    supplyMoved,
    unreadBecause: null,
    retrievedAt,
  };
}

export function tokenSnapshot(v: TokenVerdict, observedAt: string): SnapshotRecord {
  return {
    key: `token:${v.token.key}`,
    observedAt,
    payload: {
      key: v.token.key,
      ticker: v.token.ticker,
      address: v.token.address,
      multiplier: v.multiplier === null ? null : formatMultiplierExact(v.multiplier),
      multiplierRaw: v.multiplier === null ? null : v.multiplier.toString(),
      pendingRaw: v.pending === null ? null : v.pending.next.toString(),
      pendingEffectiveAt: v.pending?.effectiveAt?.toISOString() ?? null,
      supplyRaw: v.supply === null ? null : v.supply.toString(),
      decimals: v.token.decimals,
      unreadBecause: v.unreadBecause,
      retrievedAt: v.retrievedAt,
    },
  };
}

/** Read the previous snapshot back into the shape judgeToken compares against. */
export function priorOf(snapshot: SnapshotRecord | undefined): TokenPrior | null {
  if (!snapshot) return null;
  const raw = snapshot.payload.multiplierRaw;
  if (typeof raw !== 'string') return null;
  const supplyRaw = snapshot.payload.supplyRaw;
  return { multiplierRaw: raw, supplyRaw: typeof supplyRaw === 'string' ? supplyRaw : null };
}

export const archivistProducer: Producer = async ({ now, store }): Promise<ProducerResult> => {
  const network = activeNetwork();
  const opts = { intervalSeconds: INTERVAL };
  const at = now.toISOString();

  // ── previous state, one query ────────────────────────────────────────────
  const previous = await store.snapshots('token:');
  const priorByKey = new Map<string, SnapshotRecord>();
  if (previous.state !== 'UNREAD') for (const s of previous.value) priorByKey.set(s.key, s);
  const priorsUnreadable = previous.state === 'UNREAD';

  // ── the batch: five questions per stock token, two per settlement asset ───
  const calls: Call[] = [];
  const layout = STOCK_TOKENS.map((token) => {
    const start = calls.length;
    calls.push(
      { target: token.address, data: SELECTORS.uiMultiplier },
      { target: token.address, data: SELECTORS.newUIMultiplier },
      { target: token.address, data: SELECTORS.effectiveAt },
      { target: token.address, data: SELECTORS.totalSupply },
      { target: token.address, data: SELECTORS.decimals },
    );
    return { token, start };
  });
  const settlementStart = calls.length;
  for (const token of TOKENS) {
    calls.push(
      { target: token.address, data: SELECTORS.totalSupply },
      { target: token.address, data: SELECTORS.decimals },
    );
  }
  const answers = await readMany(calls, opts);

  const reads: TokenRead[] = layout.map(({ token, start }) => ({
    token,
    multiplier: decodeUintReading(answers[start]!, 'uiMultiplier()'),
    next: decodeUintReading(answers[start + 1]!, 'newUIMultiplier()'),
    effectiveAt: decodeUintReading(answers[start + 2]!, 'effectiveAt()'),
    supply: decodeUintReading(answers[start + 3]!, 'totalSupply()'),
    decimals: decodeDecimals(answers[start + 4]!),
  }));
  const verdicts = reads.map((read) =>
    judgeToken(read, priorsUnreadable ? null : priorOf(priorByKey.get(`token:${read.token.key}`)), now),
  );

  const figures: DeclaredFigure[] = [];
  const literals = new Set<string>();
  const literal = (n: number) => {
    literals.add(String(n));
    return String(n);
  };
  const observations: ObservationRecord[] = [];
  const snapshots: SnapshotRecord[] = [];
  /** Keyed by the label the narration uses, so a printed absence is catchable. */
  const readings: Record<string, Reading<unknown>> = {};
  let sourcesReached = 0;
  let oldestInputAt: Date | null = null;
  const touch = (iso: string | null) => {
    if (iso === null) return;
    const d = new Date(iso);
    if (oldestInputAt === null || d < oldestInputAt) oldestInputAt = d;
  };

  for (const v of verdicts) {
    snapshots.push(tokenSnapshot(v, at));
    readings[`${v.token.ticker} shares per token`] = reads.find((r) => r.token === v.token)!.multiplier;
    if (v.multiplier === null) continue;
    sourcesReached += 1;
    touch(v.retrievedAt);
    const multiplierSource = `${network.label} · ${v.token.ticker} uiMultiplier()`;

    // The multiplier is a step function: the series keeps the steps, not the
    // plateaus. First sighting and every change are recorded; a plateau is
    // carried by the snapshot.
    const prior = priorsUnreadable ? null : priorOf(priorByKey.get(`token:${v.token.key}`));
    if (prior === null || v.movedFrom !== null) {
      observations.push({
        key: `${v.token.key}:multiplier`,
        observedAt: v.retrievedAt!,
        value: Number(v.multiplier) / Number(ONE),
        raw: v.multiplier.toString(),
        decimals: 18,
        source: multiplierSource,
      });
    }
    if (v.supply !== null) {
      observations.push({
        key: `${v.token.key}:supply`,
        observedAt: v.retrievedAt!,
        value: Number(v.supply) / 10 ** v.token.decimals,
        raw: v.supply.toString(),
        decimals: v.token.decimals,
        source: `${network.label} · ${v.token.ticker} totalSupply()`,
      });
    }
  }

  // ── settlement assets: supply only, they carry no multiplier ──────────────
  const settlementLines: string[] = [];
  TOKENS.forEach((token, i) => {
    const supply = decodeUintReading(answers[settlementStart + i * 2]!, 'totalSupply()');
    const decimals = decodeDecimals(answers[settlementStart + i * 2 + 1]!);
    readings[`${token.observedSymbol} supply`] = supply;
    if (!isRead(supply) || !isRead(decimals)) {
      settlementLines.push(
        `— ${token.observedSymbol}: total supply could not be read (${isRead(supply) ? 'decimals unreadable' : supply.reason}), so no supply figure is given.`,
      );
      return;
    }
    sourcesReached += 1;
    touch(supply.retrievedAt);
    const formatted = formatUnits(supply.value, decimals.value);
    figures.push({ token: formatted, source: `${network.label} · ${token.observedSymbol} totalSupply()`, retrievedAt: supply.retrievedAt });
    observations.push({
      key: `${token.key}:supply`,
      observedAt: supply.retrievedAt,
      value: Number(supply.value) / 10 ** decimals.value,
      raw: supply.value.toString(),
      decimals: decimals.value,
      source: `${network.label} · ${token.observedSymbol} totalSupply()`,
    });
    settlementLines.push(`— ${token.observedSymbol}: supply ${formatted}. This contract exposes no shares-per-token multiplier; it is a settlement asset, not a stock token.`);
  });

  if (sourcesReached === 0) {
    return {
      publication: null,
      sourcesReached,
      oldestInputAt,
      observations,
      snapshots,
      note: verdicts
        .filter((v) => v.unreadBecause !== null)
        .map((v) => `${v.token.ticker}: ${v.unreadBecause}`)
        .join(' · ')
        .slice(0, 400) || 'no token in the registry answered',
    };
  }

  // ── the prose: movement, not the roll ────────────────────────────────────
  const answered = verdicts.filter((v) => v.multiplier !== null);
  const notOne = answered.filter((v) => v.multiplier !== ONE).sort((a, b) => (a.multiplier! > b.multiplier! ? -1 : 1));
  const moved = answered.filter((v) => v.movedFrom !== null);
  const pending = answered.filter((v) => v.pending !== null);
  const issued = answered.filter((v) => v.supplyMoved === 'ISSUED');
  const redeemed = answered.filter((v) => v.supplyMoved === 'REDEEMED');
  const unread = verdicts.filter((v) => v.unreadBecause !== null);

  const declareMultiplier = (v: TokenVerdict, value: bigint, fn: string) => {
    const shown = formatMultiplier(value);
    figures.push({ token: shown, source: `${network.label} · ${v.token.ticker} ${fn}`, retrievedAt: v.retrievedAt! });
    return shown;
  };

  const observed: string[] = [];
  observed.push(
    `— ${literal(answered.length)} of ${literal(STOCK_TOKENS.length)} stock tokens in the issuer's registry answered their shares-per-token multiplier.`,
  );
  observed.push(
    notOne.length === 0
      ? '— Every multiplier read is exactly one: no token has yet recorded a reinvested distribution or a split.'
      : `— ${literal(notOne.length)} carry a multiplier other than one, meaning one token represents more or less than one share: ${notOne.map((v) => `${v.token.ticker} ${declareMultiplier(v, v.multiplier!, 'uiMultiplier()')}`).join(', ')}.`,
  );
  observed.push(
    priorsUnreadable
      ? '— The previous readings could not be read back, so no comparison is made. This is not a statement that nothing moved.'
      : priorByKey.size === 0
        ? '— This is the first reading kept for these tokens, so there is nothing yet to compare against.'
        : moved.length === 0
          ? '— Moved since the previous reading: none.'
          : `— MOVED since the previous reading: ${moved.map((v) => `${v.token.ticker} ${declareMultiplier(v, v.movedFrom!, 'uiMultiplier() previous')} → ${declareMultiplier(v, v.multiplier!, 'uiMultiplier()')}`).join(', ')}. One token now represents a different number of shares, and any figure derived from the older value is wrong by that ratio. The chain records the movement; the issuer's notice says why.`,
  );
  observed.push(
    pending.length === 0
      ? '— Published but not yet effective: none.'
      : `— Published but not yet effective: ${pending.map((v) => `${v.token.ticker} → ${declareMultiplier(v, v.pending!.next, 'newUIMultiplier()')}${v.pending!.effectiveAt ? ` at ${v.pending!.effectiveAt.toISOString()}` : ' (effective time not readable)'}`).join(', ')}. These are scheduled changes the issuer has recorded on chain, not projections.`,
  );
  if (!priorsUnreadable && priorByKey.size > 0) {
    observed.push(
      issued.length === 0 && redeemed.length === 0
        ? '— Supply unchanged on every token since the previous reading.'
        : `— Supply moved since the previous reading on ${literal(issued.length + redeemed.length)} tokens: units issued on ${issued.length === 0 ? 'none' : issued.map((v) => v.token.ticker).join(', ')}; redeemed or burned on ${redeemed.length === 0 ? 'none' : redeemed.map((v) => v.token.ticker).join(', ')}. The chain records the movement; it does not record who asked for it or why.`,
    );
  }

  figures.push({ token: String(STOCK_TOKENS.length), source: STOCK_TOKENS_SOURCE.url, retrievedAt: STOCK_TOKENS_SOURCE.retrievedAt });

  const body = [
    'OBSERVED',
    ...observed,
    ...settlementLines,
    '',
    'NOT READ',
    ...(unread.length > 0
      ? unread.map((v) => `— ${v.token.ticker}: ${v.unreadBecause}. Reported as unread, not as a multiplier of one.`)
      : ['— Every token in the registry answered on this run.']),
    '',
    'NOT DERIVABLE FROM THE CHAIN',
    ...NOT_DERIVABLE.map((line) => `— ${line}`),
  ].join('\n');

  const headlineParts = [
    `ACTIONS · ${answered.length} of ${STOCK_TOKENS.length} tokens read`,
    `${notOne.length} not at one`,
    moved.length > 0 ? `${moved.length} MOVED` : null,
    pending.length > 0 ? `${pending.length} pending` : null,
  ].filter((p): p is string => p !== null);
  literals.add(String(answered.length));
  literals.add(String(notOne.length));
  literals.add(String(moved.length));
  literals.add(String(pending.length));

  return {
    publication: {
      headline: headlineParts.join(' · '),
      body,
      figures,
      readings,
      allowedLiterals: [...literals],
    },
    sourcesReached,
    oldestInputAt,
    observations,
    snapshots,
  };
};
