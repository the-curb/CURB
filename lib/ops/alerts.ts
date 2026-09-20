/**
 * Alerts: the signal in /api/state, wired to a human.
 *
 * A condition is a stable id for something a person should know about — an
 * agent gone absent, a feed whose issuer pause flag is set, the stock-token
 * beacon pointing somewhere new. The set of active conditions is computed from
 * the record after every tick and compared with the set recorded after the
 * last one; what changed is delivered, once. A condition that persists is not
 * re-sent every five minutes, and a condition that clears is said to have
 * cleared, because "it stopped paging" and "it was fixed" are different facts.
 *
 * Delivery is a webhook, Discord- and Slack-shaped in one body. Not configured
 * is a reported state, not a silent one: the tick response says NOT_CONFIGURED,
 * so an operator who believes they would be paged can see that they would not.
 *
 * Every function here that decides anything is pure. The one that talks to the
 * network is small and does nothing else.
 */

import { AGENTS } from '../agents/registry.ts';
import { STOCK_TOKENS } from '../chain/stock-tokens.ts';
import { systemHealth, type AgentHealth } from '../agents/health.ts';
import type { HeartbeatRecord, PublicationRecord, SnapshotRecord, Store } from '../store/types.ts';
import { composeBoard } from '../floor/board.ts';
import { describeAge } from '../doctrine/reading.ts';
import { BRAND } from '../brand.ts';
import { request } from '../chain/transport.ts';
import { createHash } from 'node:crypto';

export interface Condition {
  /** Stable across ticks while the condition holds. */
  readonly id: string;
  readonly severity: 'DARK' | 'STALE' | 'NOTE';
  readonly text: string;
}

/**
 * What a condition is about, for the person who pays to be told. A holder
 * of a stock token wants the token's own events and the issuer's; the
 * desk's plumbing — its store, its index, its agents — is the operator's,
 * and is not what a subscription buys unless it asks for it.
 */
export type ConditionKind = 'token' | 'issuer' | 'market' | 'chain' | 'desk';
export const CONDITION_KINDS: readonly ConditionKind[] = ['token', 'issuer', 'market', 'chain', 'desk'];
/** What a subscription that names no kinds is told: everything a holder would want, nothing about the desk's own plumbing. */
export const DEFAULT_KINDS: readonly ConditionKind[] = ['token', 'issuer', 'market', 'chain'];

export const KIND_CATALOGUE: Readonly<Record<ConditionKind, { readonly what: string; readonly examples: readonly string[] }>> = {
  token: {
    what: 'one token: a staged multiplier change and the day it takes effect; the issuer’s oracle pause flag; a price past its heartbeat while the exchange is open; a feed that no longer describes itself as recorded',
    examples: ['token:rh-aapl:MULTIPLIER_PENDING', 'feed:rh-aapl-usd:PAUSED', 'feed:rh-aapl-usd:STALE_IN_SESSION', 'feed:rh-aapl-usd:DRIFT'],
  },
  issuer: {
    what: 'every token at once: the beacon they all delegate to pointing somewhere new or holding different code; the issuer’s registry listing tokens or feeds the capture does not hold; an issuer document a series depends on changing or going away',
    examples: ['beacon:implementation:CHANGED', 'beacon:code:DIFFERS', 'capture:tokens:DRIFT', 'evidence:<source>:CHANGED'],
  },
  market: {
    what: 'where the token trades on this chain against what the oracle last printed: a difference past the published band, a book too thin to leave at the size stated, and a ticker whose every pool has gone empty. What is sent is the measurement and the band it crossed — never which way it closes, and never what to do about it',
    examples: ['market:rh-aapl-usd:BASIS_WIDE', 'market:rh-aapl-usd:THIN', 'market:rh-aapl-usd:NO_MARKET'],
  },
  chain: { what: 'the chain’s head not advancing', examples: ['chain:head:STALLED'] },
  desk: { what: 'the desk’s own plumbing: its store, its agents, its credit index and its series reconciliation — the operator’s concern, sent only when asked for', examples: ['system:reporting:NONE', 'credits:index:BEHIND', 'positions:<series>:DISAGREEMENT'] },
};

/** The kind a condition id belongs to. Pure, and total: an id nobody classified is the desk’s. */
export function kindOf(id: string): ConditionKind {
  if (id.startsWith('feed:') || id.startsWith('token:')) return 'token';
  if (id.startsWith('beacon:') || id.startsWith('capture:') || id.startsWith('evidence:')) return 'issuer';
  if (id.startsWith('market:')) return 'market';
  if (id.startsWith('chain:')) return 'chain';
  return 'desk';
}

/** The ticker a token condition is about, or null for a condition about no one token. */
export function tickerOf(id: string): string | null {
  const m = /^(feed|token|market):([^:]+):/.exec(id);
  if (!m) return null;
  const key = m[2]!;
  const token = m[1] === 'token' ? STOCK_TOKENS.find((t) => t.key === key) : STOCK_TOKENS.find((t) => t.feedKey === key);
  return token?.ticker ?? null;
}

export interface ConditionFilter {
  readonly kinds: readonly ConditionKind[];
  /** Tickers, upper-case; empty means every token. Applies to token conditions only — an issuer event concerns every token. */
  readonly tokens: readonly string[];
}

/** Whether a subscription with this filter is told of this condition. Pure. */
export function matchesFilter(filter: ConditionFilter, condition: Condition): boolean {
  const kind = kindOf(condition.id);
  if (!filter.kinds.includes(kind)) return false;
  if (kind !== 'token' || filter.tokens.length === 0) return true;
  const ticker = tickerOf(condition.id);
  return ticker !== null && filter.tokens.includes(ticker);
}

/** A raw multiplier (18 decimals) as a person reads it, six places. */
function multiplierText(raw: string): string {
  if (!/^[0-9]+$/.test(raw)) return raw;
  const whole = raw.length > 18 ? raw.slice(0, -18) : '0';
  const frac = raw.padStart(19, '0').slice(-18, -12);
  return `${whole}.${frac}`;
}

const ALERTING_HEALTH: ReadonlySet<AgentHealth> = new Set(['ABSENT', 'DEGRADED', 'STALE']);

/** Everything the record says a person should know, as of now. Pure. */
export function deriveConditions(input: {
  readonly heartbeats: readonly HeartbeatRecord[] | null;
  readonly feedSnapshots: readonly SnapshotRecord[] | null;
  /** Why the snapshots could not be read, when they could not. Carried into the condition. */
  readonly feedSnapshotsFault?: string | null;
  readonly lastRegistrar: PublicationRecord | null;
  /** The 'chain:head' snapshot, when the store has one. */
  readonly headSnapshot?: SnapshotRecord | null;
  /** The 'capture:drift' snapshot, when the Registrar has written one. */
  readonly driftSnapshot?: SnapshotRecord | null;
  /** The position product's snapshots (`positions:` and `evidence:…:latest`), when the store has them. */
  readonly positionSnapshots?: readonly SnapshotRecord[] | null;
  /** The Archivist's `token:` snapshots, when the store has them: a staged multiplier is a condition until it takes effect. */
  readonly tokenSnapshots?: readonly SnapshotRecord[] | null;
  /** The Specialist's `pool:` snapshots, when the store has them: what the token trades at here, beside what the oracle last printed. */
  readonly poolSnapshots?: readonly SnapshotRecord[] | null;
  readonly now: Date;
}): Condition[] {
  const out: Condition[] = [];
  const { heartbeats, feedSnapshots, lastRegistrar, now } = input;

  if (heartbeats === null) {
    out.push({ id: 'store:heartbeats:UNREAD', severity: 'DARK', text: 'the heartbeat store could not be read; no agent state is known' });
  } else {
    const health = systemHealth(heartbeats, now);
    for (const status of health.statuses) {
      if (!ALERTING_HEALTH.has(status.health)) continue;
      const spec = AGENTS.find((a) => a.id === status.id);
      out.push({
        id: `agent:${status.id}:${status.health}`,
        severity: status.health === 'ABSENT' ? 'DARK' : status.health === 'DEGRADED' ? 'STALE' : 'NOTE',
        text: `${spec?.name ?? status.id} is ${status.health.toLowerCase()}${status.detail ? ` — ${status.detail}` : ''}`,
      });
    }
    if (health.reportingLastHour === 0 && heartbeats.length > 0) {
      out.push({ id: 'system:reporting:NONE', severity: 'DARK', text: 'no agent has reported in the last hour; the scheduler may have stopped' });
    }
  }

  if (feedSnapshots === null) {
    out.push({ id: 'store:snapshots:UNREAD', severity: 'STALE', text: `the snapshot store could not be read (${input.feedSnapshotsFault ?? 'no reason recorded'}); the board cannot be drawn` });
  } else {
    // The chain's own liveness, as the Pillar last read it. Judged at the
    // moment of the sample: a stalled head at sample time is the condition,
    // not the sample itself ageing on the shelf, which the board state covers.
    const head = input.headSnapshot;
    if (head && head.payload.stalled === true) {
      const age = typeof head.payload.ageSeconds === 'number' ? ` — head was ${Math.round(head.payload.ageSeconds)}s old at the sample` : '';
      out.push({ id: 'chain:head:STALLED', severity: 'DARK', text: `the chain head had stopped advancing when the Pillar last read it${age}; blocks were not being produced` });
    }
    const board = composeBoard(feedSnapshots, now, input.poolSnapshots ?? []);
    if (board.sampleState === 'ABSENT') {
      out.push({ id: 'board:sample:ABSENT', severity: 'DARK', text: 'the Pillar has not sampled the feeds within its absence threshold; the board is a memory' });
    }
    for (const row of board.equity) {
      if (row.pauseFlag === 'SET') out.push({ id: `feed:${row.key}:PAUSED`, severity: 'STALE', text: `${row.label}: the issuer's oracle pause flag is set; the feed holds its last value` });
      if (row.identity === 'DRIFT') out.push({ id: `feed:${row.key}:DRIFT`, severity: 'DARK', text: `${row.label}: the feed no longer describes itself as recorded; its price is withheld` });
      if (row.pastHeartbeat === true && row.sessionAtSample === 'REGULAR') {
        out.push({ id: `feed:${row.key}:STALE_IN_SESSION`, severity: 'STALE', text: `${row.label}: past its published heartbeat while the exchange was open` });
      }

      // Where the token trades, against what the oracle last printed.
      //
      // Each of these is a measurement crossing a line this desk published in
      // advance, in the same shape as "past its published heartbeat". None of
      // them says the difference is wide in any sense but the stated one, none
      // says which way it closes, and none says what to do. A holder is told
      // the number and the band it crossed; the rest is theirs.
      const m = row.market;
      if (m === null) continue;
      if (m.basisBps !== null && Math.abs(m.basisBps) >= WIDE_BASIS_BPS) {
        const sign = m.basisBps > 0 ? 'above' : 'below';
        out.push({
          id: `market:${row.key}:BASIS_WIDE`,
          severity: 'NOTE',
          text: `${row.label}: the deepest pool on this chain is ${Math.abs(Math.round(m.basisBps))} bp ${sign} the feed's last answer, past the ${WIDE_BASIS_BPS} bp band. The feed answer was ${describeAge(row.feedAgeSeconds ?? 0)} old${row.sessionAtSample === 'REGULAR' ? ' with the exchange open' : ' with the exchange shut'}`,
        });
      }
      if (m.depthUsd !== null && m.depthUsd < THIN_DEPTH_USD) {
        out.push({
          id: `market:${row.key}:THIN`,
          severity: 'STALE',
          text: `${row.label}: about ${Math.round(m.depthUsd).toLocaleString('en-US')} dollars moves its deepest pool one percent, under the ${THIN_DEPTH_USD.toLocaleString('en-US')} band. A bound over published state, not a quote`,
        });
      }
      if (m.priceInQuote === null && m.venueLabel !== null) {
        out.push({
          id: `market:${row.key}:NO_MARKET`,
          severity: 'DARK',
          text: `${row.label}: every pool this ticker has answered and none held liquidity in force. An empty pool still reports the price it was left at; there is no market behind it`,
        });
      }
    }
  }

  // A multiplier the issuer has staged is the one event a holder cannot see
  // coming from a price: it holds from the day it is staged to the day it
  // takes effect, and clearing it says the change happened.
  for (const s of input.tokenSnapshots ?? []) {
    const p = s.payload;
    if (!s.key.startsWith('token:') || typeof p.pendingRaw !== 'string' || typeof p.key !== 'string') continue;
    const ticker = typeof p.ticker === 'string' ? p.ticker : p.key;
    const from = typeof p.multiplierRaw === 'string' ? multiplierText(p.multiplierRaw) : '—';
    const at = typeof p.pendingEffectiveAt === 'string' ? ` on ${p.pendingEffectiveAt.slice(0, 10)}` : '';
    out.push({ id: `token:${p.key}:MULTIPLIER_PENDING`, severity: 'NOTE', text: `${ticker}: the issuer has staged a multiplier change, ${from} → ${multiplierText(p.pendingRaw)}, taking effect${at || ' at a time not yet published'}; read ${typeof p.retrievedAt === 'string' ? p.retrievedAt : s.observedAt}` });
  }

  // The capture against the world, as the Registrar last checked it. A token
  // whose contract moved is the capture pointing at the wrong contract: dark.
  // Tokens or feeds added or removed are a re-capture owed: a note.
  const drift = input.driftSnapshot;
  if (drift) {
    const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    const moved = list(drift.payload.tokensMoved);
    const tokensAdded = list(drift.payload.tokensAdded);
    const tokensRemoved = list(drift.payload.tokensRemoved);
    const feedsAdded = list(drift.payload.feedsAdded);
    const feedsRemoved = list(drift.payload.feedsRemoved);
    if (moved.length > 0) {
      out.push({ id: 'capture:tokens:MOVED', severity: 'DARK', text: `the capture points at the wrong contract for ${moved.join(', ')}: the issuer's registry names a different address for the same entry — re-capture` });
    }
    if (tokensAdded.length > 0 || tokensRemoved.length > 0) {
      out.push({ id: 'capture:tokens:DRIFT', severity: 'NOTE', text: `the issuer's registry no longer matches the capture — added: ${tokensAdded.join(', ') || 'none'}; removed: ${tokensRemoved.join(', ') || 'none'} — re-capture with scripts/capture-stock-tokens.ts` });
    }
    if (feedsAdded.length > 0 || feedsRemoved.length > 0) {
      out.push({ id: 'capture:feeds:DRIFT', severity: 'NOTE', text: `the vendor's feed directory no longer matches the capture — added: ${feedsAdded.join(', ') || 'none'}; removed: ${feedsRemoved.join(', ') || 'none'} — re-capture with scripts/capture-feeds.ts` });
    }
  }

  if (lastRegistrar !== null) {
    const beaconLine = lastRegistrar.body.split('\n').find((l) => l.includes('stock-token beacon')) ?? '';
    if (/CHANGED/.test(beaconLine)) {
      out.push({ id: 'beacon:implementation:CHANGED', severity: 'DARK', text: 'the stock-token beacon points at a different implementation than the one recorded at capture — every stock token changed code' });
    }
    if (/code hash behind it DIFFERS/.test(lastRegistrar.body)) {
      out.push({ id: 'beacon:code:DIFFERS', severity: 'DARK', text: 'the stock-token implementation code no longer hashes to the recorded value' });
    }
  }

  out.push(...positionConditions(input.positionSnapshots ?? null, now));

  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** How long a change in the evidence or a drift on chain stays a condition, so a person has time to read it. */
/**
 * The bands the market conditions cross, published here so a subscriber knows
 * the line before it is crossed rather than after.
 *
 * Neither is a judgement. Two hundred basis points is not "wide" in any sense
 * except that this desk said two hundred; five thousand dollars is not "thin"
 * except against the same declaration. They exist so a holder is told once when
 * a measurement passes a stated line and once when it comes back, instead of
 * being sent every reading of a number that moves all day.
 */
export const WIDE_BASIS_BPS = 200;
export const THIN_DEPTH_USD = 5_000;

export const CHANGE_WINDOW_SECONDS = 48 * 3600;

/**
 * The position product's conditions, from its own snapshots: a document or
 * an issuer record that changed, a source that stopped answering, a candidate
 * address whose code or answers moved since the last run, and a configured
 * series held short of what it owes. A source that is refused for want of a
 * key is the documented state, not a condition.
 */
export function positionConditions(snapshots: readonly SnapshotRecord[] | null, now: Date): Condition[] {
  if (snapshots === null) return [];
  const out: Condition[] = [];
  const recent = (iso: unknown): boolean => typeof iso === 'string' && now.getTime() - new Date(iso).getTime() <= CHANGE_WINDOW_SECONDS * 1000;
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

  for (const snap of snapshots) {
    const p = snap.payload;

    if (snap.key.startsWith('evidence:') && snap.key.endsWith(':latest')) {
      const sourceId = str(p.sourceId) ?? snap.key.slice('evidence:'.length, -':latest'.length);
      const status = str(p.status);
      const kind = str(p.kind);
      if (status === 'UNREACHABLE' || status === 'HTTP_ERROR' || status === 'SCHEMA_CHANGED' || status === 'NOT_JSON') {
        out.push({ id: `evidence:${sourceId}:${status}`, severity: 'STALE', text: `the ${kind === 'page' ? 'document' : 'issuer record'} ${sourceId} could not be read as before (${status.toLowerCase().replace('_', ' ')}${p.detail ? ` — ${String(p.detail)}` : ''})` });
      }
      if (status === 'ACCESS_DENIED' && process.env.CURB_ONDO_API_KEY) {
        out.push({ id: `evidence:${sourceId}:ACCESS_DENIED`, severity: 'STALE', text: `${sourceId} refused the configured key (${String(p.detail ?? 'no detail')})` });
      }
      if (recent(p.changedAt) && typeof p.hash === 'string') {
        out.push({
          id: `evidence:${sourceId}:CHANGED:${p.hash.slice(0, 8)}`,
          severity: 'NOTE',
          text: kind === 'page' ? `the document ${sourceId} changed (${String(p.url)}) — a page for a person to read, not a fact this desk asserts` : `the issuer record ${sourceId} changed — its parsed fields and the chain's answers should be reviewed`,
        });
      }
    }

    if (snap.key.startsWith('positions:verify:')) {
      const seriesId = str(p.seriesId) ?? snap.key.slice('positions:verify:'.length);
      const drift = Array.isArray(p.lastDrift) ? (p.lastDrift as { address?: unknown; role?: unknown; field?: unknown; from?: unknown; to?: unknown }[]) : [];
      if (recent(p.driftSince) && drift.length > 0) {
        for (const d of drift) {
          const expected = d.field === 'multiplier' || d.field === 'conversion';
          out.push({
            id: `positions:${seriesId}:DRIFT:${String(d.address).slice(0, 10)}:${String(d.field)}`,
            severity: expected ? 'NOTE' : ['answersAsToken', 'codeHash', 'asset', 'implementation', 'admin', 'beacon', 'candidateSet'].includes(String(d.field)) ? 'DARK' : 'STALE',
            text: expected
              ? `candidate ${String(d.role).toLowerCase().replace('_', ' ')} ${String(d.address)} for ${seriesId}: ${String(d.field)} moved from ${String(d.from)} to ${String(d.to)} — a corporate action activated; the wrapper's shares are unmoved by design and the raw balance moved with it`
              : `candidate ${String(d.role).toLowerCase().replace('_', ' ')} ${String(d.address)} for ${seriesId}: ${String(d.field)} moved from ${String(d.from)} to ${String(d.to)} — verification to be re-reviewed; minting would be stopped`,
          });
        }
      }
    }

    if (snap.key.startsWith('positions:code:')) {
      const seriesId = str(p.seriesId) ?? snap.key.slice('positions:code:'.length);
      if (p.state === 'MISMATCH') {
        out.push({ id: `positions:${seriesId}:CODE_MISMATCH`, severity: 'DARK', text: `the series at ${str(p.address) ?? '?'} is not the contract in this repository${str(p.detail) ? ` — ${str(p.detail)}` : ''}; nothing about it is trusted until a person says why` });
      } else if (p.state === 'UNREAD' || p.state === 'NO_BUILD') {
        out.push({ id: `positions:${seriesId}:CODE_${String(p.state)}`, severity: 'STALE', text: `the series code at ${str(p.address) ?? '?'} could not be verified${str(p.detail) ? ` — ${str(p.detail)}` : ''}` });
      }
    }

    // The credit desk: its last run, and its code against the build. A rate
    // that could not be read is stale, not zero; a desk whose code or
    // treasury is not the record's is dark.
    if (snap.key === 'credits:run' && p.configured === false) continue;
    if (snap.key === 'credits:code' && snapshots.some((s) => s.key === 'credits:run' && s.payload.configured === false)) continue;
    if (snap.key === 'credits:run') {
      if (typeof p.behindBlocks === 'number' && p.behindBlocks > 100_000) out.push({ id: 'credits:index:BEHIND', severity: 'NOTE', text: `the credit desk's index is ${p.behindBlocks.toLocaleString('en-US')} blocks behind the head and catches up 100,000 a tick; top-ups in the gap are credited when it gets there` });
      if (p.rate === 'UNREAD') out.push({ id: 'credits:rate:UNREAD', severity: 'STALE', text: `the credit desk could not read a rate on its last run (${str(p.rateDetail) ?? 'no reason recorded'}); nothing is quoted and top-ups wait` });
      if (p.index === 'HEAD_UNREAD' || p.index === 'STORE_UNREADABLE') out.push({ id: `credits:index:${String(p.index)}`, severity: 'STALE', text: `the credit desk's top-ups were not indexed on its last run (${str(p.indexDetail) ?? String(p.index)})` });
      if (typeof p.waitingForRate === 'number' && p.waitingForRate > 0) out.push({ id: 'credits:topups:WAITING', severity: 'NOTE', text: `${p.waitingForRate} top-up${p.waitingForRate === 1 ? '' : 's'} wait${p.waitingForRate === 1 ? 's' : ''} to be credited — a rate the node could give, or a store that takes the credit; nothing is credited at a guess` });
      if (p.index === 'PARTIAL') out.push({ id: 'credits:index:PARTIAL', severity: 'STALE', text: `the credit desk's index could not read every block range on its last run (${str(p.indexDetail) ?? 'a range was refused'}); the cursor waits there and reads again` });
      if (p.index === 'HELD') out.push({ id: 'credits:index:HELD', severity: 'STALE', text: `the credit desk's top-ups are not being credited: ${str(p.indexDetail) ?? 'the desk is not trusted'}` });
      if (typeof p.fanOutFailed === 'number' && p.fanOutFailed > 0) out.push({ id: 'credits:fanout:FAILED', severity: 'NOTE', text: `${p.fanOutFailed} subscriber webhook${p.fanOutFailed === 1 ? '' : 's'} did not accept the last alert; not charged, tried again next change` });
      if (p.poolCheck === 'PARTIAL' || p.poolCheck === 'UNREAD') out.push({ id: 'credits:pool:UNCHECKED', severity: 'NOTE', text: `the record's fromBlock is not yet checked against the pool's logs (${typeof p.poolCheckDetail === 'string' ? p.poolCheckDetail : 'read in parts, run by run'})` });
      if (typeof p.fanOutUncharged === 'number' && p.fanOutUncharged > 0) out.push({ id: 'credits:fanout:UNCHARGED', severity: 'NOTE', text: `${p.fanOutUncharged} alert deliver${p.fanOutUncharged === 1 ? 'y' : 'ies'} went out without the charge landing (a key short at that moment, or the store); the desk’s loss, not repeated` });
    }
    if (snap.key === 'credits:code') {
      if (p.state === 'MISMATCH') out.push({ id: 'credits:code:MISMATCH', severity: 'DARK', text: `the credit desk at ${str(p.address) ?? '?'} is not the contract in this repository paying to the recorded treasury${str(p.detail) ? ` — ${str(p.detail)}` : ''}; nothing about it is trusted until a person says why` });
      else if (p.state === 'UNREAD' || p.state === 'NO_BUILD') out.push({ id: `credits:code:${String(p.state)}`, severity: 'STALE', text: `the credit desk's code at ${str(p.address) ?? '?'} could not be verified${str(p.detail) ? ` — ${str(p.detail)}` : ''}` });
    }

    if (snap.key.startsWith('positions:reconcile:')) {
      const seriesId = str(p.seriesId) ?? snap.key.slice('positions:reconcile:'.length);
      const components = Array.isArray(p.components) ? (p.components as { component?: unknown; finding?: unknown; owed?: unknown; held?: unknown; reason?: unknown }[]) : [];
      for (const c of components) {
        if (c.finding === 'SHORTFALL') {
          out.push({ id: `positions:${seriesId}:SHORTFALL:${String(c.component)}`, severity: 'DARK', text: `series ${seriesId} holds ${String(c.held)} units of ${String(c.component)} against ${String(c.owed)} owed — payment of that component is halted until resolved` });
        } else if (c.finding === 'UNKNOWN') {
          out.push({ id: `positions:${seriesId}:UNKNOWN:${String(c.component)}`, severity: 'STALE', text: `series ${seriesId}: the balance of ${String(c.component)} could not be read (${String(c.reason ?? 'no reason')}); owed ${String(c.owed)}` });
        }
      }
      const disagreements = Array.isArray(p.disagreements) ? p.disagreements.length : 0;
      if (disagreements > 0) {
        out.push({ id: `positions:${seriesId}:DISAGREEMENT`, severity: 'DARK', text: `series ${seriesId}: ${disagreements} event${disagreements === 1 ? '' : 's'} on chain that the ledger model refuses — the contract and the model disagree` });
      }
    }
  }
  return out;
}

export interface Transition {
  readonly raised: readonly Condition[];
  readonly cleared: readonly string[];
  readonly active: readonly Condition[];
}

/** What changed since the last recorded set. Pure. */
export function transition(previousIds: readonly string[], current: readonly Condition[]): Transition {
  const before = new Set(previousIds);
  const now = new Set(current.map((c) => c.id));
  return {
    raised: current.filter((c) => !before.has(c.id)),
    cleared: previousIds.filter((id) => !now.has(id)),
    active: current,
  };
}

/** Discord refuses content over 2,000 characters; a message is cut before that with what was left out counted, never refused whole. */
export const MESSAGE_MAX_CHARS = 1_900;

/** One message, dry and specific. Nothing here forecasts or advises. */
export function composeMessage(t: Transition, now: Date): string {
  const lines: string[] = [`${BRAND.name} · ${now.toISOString()}`];
  if (t.raised.length > 0) {
    lines.push('RAISED');
    for (const c of t.raised) lines.push(`  ${c.severity === 'DARK' ? '●' : c.severity === 'STALE' ? '◐' : '○'} ${c.text}`);
  }
  if (t.cleared.length > 0) {
    lines.push('CLEARED');
    for (const id of t.cleared) lines.push(`  ○ ${id}`);
  }
  const tail = `still active: ${t.active.length === 0 ? 'none' : t.active.map((c) => c.id).join(', ')}`;
  const budget = MESSAGE_MAX_CHARS - Math.min(tail.length, 200) - 40;
  const kept: string[] = [];
  let used = 0;
  let left = 0;
  for (const line of lines) {
    if (used + line.length + 1 > budget) {
      left += 1;
      continue;
    }
    kept.push(line);
    used += line.length + 1;
  }
  if (left > 0) kept.push(`  … and ${left} more line${left === 1 ? '' : 's'}; the full set is on /api/state`);
  kept.push(tail.length > 200 ? `${tail.slice(0, 197)}…` : tail);
  return kept.join('\n');
}

export type Delivery =
  | { readonly state: 'SENT'; readonly status: number }
  | { readonly state: 'FAILED'; readonly reason: string }
  | { readonly state: 'NOT_CONFIGURED' }
  | { readonly state: 'NOTHING_TO_SEND' };

/**
 * Discord reads `content`; Slack reads `text`; each ignores the other. A
 * redirect is not followed: the address that was registered is the only
 * one posted to. `pinTo` dials the addresses a check resolved and judged
 * public, so a name cannot point elsewhere between the check and the post.
 */
export async function deliver(message: string, webhook: string | undefined = process.env.CURB_ALERT_WEBHOOK, timeoutMs = 10_000, pinTo?: readonly string[]): Promise<Delivery> {
  if (!webhook) return { state: 'NOT_CONFIGURED' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await request(
      webhook,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: message, text: message }), redirect: 'manual', ...(pinTo === undefined ? {} : { pinTo }) },
      controller.signal,
    );
    if (response.status >= 300 && response.status < 400) return { state: 'FAILED', reason: `HTTP ${response.status}: a redirect, which is not followed` };
    return response.ok ? { state: 'SENT', status: response.status } : { state: 'FAILED', reason: `HTTP ${response.status}` };
  } catch (cause) {
    return { state: 'FAILED', reason: cause instanceof Error ? cause.message : 'unknown transport failure' };
  } finally {
    clearTimeout(timer);
  }
}

export const ALERT_STATE_KEY = 'ops:alerts';

export interface AlertRun {
  readonly active: readonly string[];
  readonly raised: readonly string[];
  readonly cleared: readonly string[];
  readonly delivery: Delivery;
  readonly stateStored: boolean;
  /** The message composed for this transition, for the subscribers' fan-out; null when there was nothing to send. */
  readonly message: string | null;
  /** Identifies the transition by its content. */
  readonly transitionId: string | null;
  /** The conditions active now, in full — what the credit desk's subscribers are told the changes of. */
  readonly conditions: readonly Condition[];
}

/** The transition's identity: what was raised, what cleared, what stays — the same sets give the same id. */
export function transitionId(t: Transition): string {
  const body = JSON.stringify({ raised: t.raised.map((c) => c.id), cleared: [...t.cleared], active: t.active.map((c) => c.id) });
  return `0x${createHash('sha256').update(body).digest('hex')}`;
}

/**
 * Derive, compare, deliver, record. The recorded set is written only after a
 * successful delivery (or when there was nothing to deliver), so a webhook
 * that failed is tried again on the next tick with the same transition rather
 * than being marked as sent. The current set of conditions is returned with
 * the run, so the credit desk's subscribers can each be told their own
 * changes since their own last delivery, independent of the operator's.
 */
export async function runAlerts(store: Store, now: Date, webhook?: string): Promise<AlertRun> {
  const [heartbeats, feedSnapshots, registrar, state, head, drift, positions, evidence, creditsRun, creditsCode, tokens, pools] = await Promise.all([
    store.latestHeartbeats(),
    store.snapshots('feed:'),
    store.publicationsByAgent('registrar', 1),
    store.snapshots(ALERT_STATE_KEY),
    store.snapshots('chain:head'),
    store.snapshots('capture:drift'),
    store.snapshots('positions:'),
    store.snapshots('evidence:'),
    store.snapshots('credits:run'),
    store.snapshots('credits:code'),
    store.snapshots('token:'),
    store.snapshots('pool:'),
  ]);

  const current = deriveConditions({
    tokenSnapshots: tokens.state === 'UNREAD' ? null : tokens.value,
    poolSnapshots: pools.state === 'UNREAD' ? null : pools.value,
    heartbeats: heartbeats.state === 'UNREAD' ? null : heartbeats.value,
    feedSnapshots: feedSnapshots.state === 'UNREAD' ? null : feedSnapshots.value,
    feedSnapshotsFault: feedSnapshots.state === 'UNREAD' ? `${feedSnapshots.reason}${feedSnapshots.detail ? ` — ${feedSnapshots.detail}` : ''}` : null,
    lastRegistrar: registrar.state === 'UNREAD' ? null : (registrar.value[0] ?? null),
    headSnapshot: head.state === 'UNREAD' ? null : (head.value.find((s) => s.key === 'chain:head') ?? null),
    driftSnapshot: drift.state === 'UNREAD' ? null : (drift.value.find((s) => s.key === 'capture:drift') ?? null),
    positionSnapshots:
      positions.state === 'UNREAD' && evidence.state === 'UNREAD'
        ? null
        : [
            ...(positions.state === 'UNREAD' ? [] : positions.value),
            ...(evidence.state === 'UNREAD' ? [] : evidence.value.filter((s) => s.key.endsWith(':latest'))),
            ...(creditsRun.state === 'UNREAD' ? [] : creditsRun.value),
            ...(creditsCode.state === 'UNREAD' ? [] : creditsCode.value),
          ],
    now,
  });

  const previous = state.state === 'UNREAD' ? null : state.value.find((s) => s.key === ALERT_STATE_KEY);
  const previousIds = Array.isArray(previous?.payload.active) ? (previous.payload.active as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  const t = transition(previousIds, current);

  let delivery: Delivery = { state: 'NOTHING_TO_SEND' };
  let message: string | null = null;
  if (t.raised.length > 0 || t.cleared.length > 0) {
    message = composeMessage(t, now);
    delivery = await deliver(message, webhook);
  }

  // The recorded set means "what has been delivered". Unconfigured is not
  // delivered: the first tick after a webhook appears raises everything that
  // is active then, instead of treating it as old news nobody was told.
  const id = message === null ? null : transitionId(t);
  let stateStored = false;
  if (delivery.state === 'SENT' || delivery.state === 'NOTHING_TO_SEND') {
    const written = await store.writeSnapshots([{ key: ALERT_STATE_KEY, observedAt: now.toISOString(), payload: { active: current.map((c) => c.id) } }]);
    stateStored = written.state === 'WRITTEN';
  }

  return { active: current.map((c) => c.id), raised: t.raised.map((c) => c.id), cleared: t.cleared, delivery, stateStored, message, transitionId: id, conditions: current };
}
