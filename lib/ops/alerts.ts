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
import { systemHealth, type AgentHealth } from '../agents/health.ts';
import type { HeartbeatRecord, PublicationRecord, SnapshotRecord, Store } from '../store/types.ts';
import { composeBoard } from '../floor/board.ts';
import { BRAND } from '../brand.ts';
import { request } from '../chain/transport.ts';
import { createHash } from 'node:crypto';

export interface Condition {
  /** Stable across ticks while the condition holds. */
  readonly id: string;
  readonly severity: 'DARK' | 'STALE' | 'NOTE';
  readonly text: string;
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
    const board = composeBoard(feedSnapshots, now);
    if (board.sampleState === 'ABSENT') {
      out.push({ id: 'board:sample:ABSENT', severity: 'DARK', text: 'the Pillar has not sampled the feeds within its absence threshold; the board is a memory' });
    }
    for (const row of board.equity) {
      if (row.pauseFlag === 'SET') out.push({ id: `feed:${row.key}:PAUSED`, severity: 'STALE', text: `${row.label}: the issuer's oracle pause flag is set; the feed holds its last value` });
      if (row.identity === 'DRIFT') out.push({ id: `feed:${row.key}:DRIFT`, severity: 'DARK', text: `${row.label}: the feed no longer describes itself as recorded; its price is withheld` });
      if (row.pastHeartbeat === true && row.sessionAtSample === 'REGULAR') {
        out.push({ id: `feed:${row.key}:STALE_IN_SESSION`, severity: 'STALE', text: `${row.label}: past its published heartbeat while the exchange was open` });
      }
    }
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
    if (snap.key === 'credits:run') {
      if (p.rate === 'UNREAD') out.push({ id: 'credits:rate:UNREAD', severity: 'STALE', text: `the credit desk could not read a rate on its last run (${str(p.rateDetail) ?? 'no reason recorded'}); nothing is quoted and top-ups wait` });
      if (p.index === 'HEAD_UNREAD' || p.index === 'STORE_UNREADABLE') out.push({ id: `credits:index:${String(p.index)}`, severity: 'STALE', text: `the credit desk's top-ups were not indexed on its last run (${str(p.indexDetail) ?? String(p.index)})` });
      if (typeof p.waitingForRate === 'number' && p.waitingForRate > 0) out.push({ id: 'credits:topups:WAITING', severity: 'NOTE', text: `${p.waitingForRate} top-up${p.waitingForRate === 1 ? '' : 's'} wait${p.waitingForRate === 1 ? 's' : ''} for a rate the node could give; nothing is credited at a guess` });
      if (typeof p.fanOutFailed === 'number' && p.fanOutFailed > 0) out.push({ id: 'credits:fanout:FAILED', severity: 'NOTE', text: `${p.fanOutFailed} subscriber webhook${p.fanOutFailed === 1 ? '' : 's'} did not accept the last alert; not charged, tried again next change` });
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
  lines.push(`still active: ${t.active.length === 0 ? 'none' : t.active.map((c) => c.id).join(', ')}`);
  return lines.join('\n');
}

export type Delivery =
  | { readonly state: 'SENT'; readonly status: number }
  | { readonly state: 'FAILED'; readonly reason: string }
  | { readonly state: 'NOT_CONFIGURED' }
  | { readonly state: 'NOTHING_TO_SEND' };

/** Discord reads `content`; Slack reads `text`; each ignores the other. */
export async function deliver(message: string, webhook: string | undefined = process.env.CURB_ALERT_WEBHOOK): Promise<Delivery> {
  if (!webhook) return { state: 'NOT_CONFIGURED' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await request(
      webhook,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: message, text: message }) },
      controller.signal,
    );
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
  /** Identifies the transition by its content, so the same one is fanned out once even when it recurs. */
  readonly transitionId: string | null;
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
 * than being marked as sent.
 */
export async function runAlerts(store: Store, now: Date, webhook?: string): Promise<AlertRun> {
  const [heartbeats, feedSnapshots, registrar, state, head, drift, positions, evidence, creditsRun, creditsCode] = await Promise.all([
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
  ]);

  const current = deriveConditions({
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
  let stateStored = false;
  if (delivery.state === 'SENT' || delivery.state === 'NOTHING_TO_SEND') {
    const written = await store.writeSnapshots([{ key: ALERT_STATE_KEY, observedAt: now.toISOString(), payload: { active: current.map((c) => c.id) } }]);
    stateStored = written.state === 'WRITTEN';
  }

  return { active: current.map((c) => c.id), raised: t.raised.map((c) => c.id), cleared: t.cleared, delivery, stateStored, message, transitionId: message === null ? null : transitionId(t) };
}
