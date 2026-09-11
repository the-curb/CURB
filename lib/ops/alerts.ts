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

  return out.sort((a, b) => a.id.localeCompare(b.id));
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
}

/**
 * Derive, compare, deliver, record. The recorded set is written only after a
 * successful delivery (or when there was nothing to deliver), so a webhook
 * that failed is tried again on the next tick with the same transition rather
 * than being marked as sent.
 */
export async function runAlerts(store: Store, now: Date, webhook?: string): Promise<AlertRun> {
  const [heartbeats, feedSnapshots, registrar, state, head, drift] = await Promise.all([
    store.latestHeartbeats(),
    store.snapshots('feed:'),
    store.publicationsByAgent('registrar', 1),
    store.snapshots(ALERT_STATE_KEY),
    store.snapshots('chain:head'),
    store.snapshots('capture:drift'),
  ]);

  const current = deriveConditions({
    heartbeats: heartbeats.state === 'UNREAD' ? null : heartbeats.value,
    feedSnapshots: feedSnapshots.state === 'UNREAD' ? null : feedSnapshots.value,
    feedSnapshotsFault: feedSnapshots.state === 'UNREAD' ? `${feedSnapshots.reason}${feedSnapshots.detail ? ` — ${feedSnapshots.detail}` : ''}` : null,
    lastRegistrar: registrar.state === 'UNREAD' ? null : (registrar.value[0] ?? null),
    headSnapshot: head.state === 'UNREAD' ? null : (head.value.find((s) => s.key === 'chain:head') ?? null),
    driftSnapshot: drift.state === 'UNREAD' ? null : (drift.value.find((s) => s.key === 'capture:drift') ?? null),
    now,
  });

  const previous = state.state === 'UNREAD' ? null : state.value.find((s) => s.key === ALERT_STATE_KEY);
  const previousIds = Array.isArray(previous?.payload.active) ? (previous.payload.active as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  const t = transition(previousIds, current);

  let delivery: Delivery = { state: 'NOTHING_TO_SEND' };
  if (t.raised.length > 0 || t.cleared.length > 0) {
    delivery = await deliver(composeMessage(t, now), webhook);
  }

  // The recorded set means "what has been delivered". Unconfigured is not
  // delivered: the first tick after a webhook appears raises everything that
  // is active then, instead of treating it as old news nobody was told.
  let stateStored = false;
  if (delivery.state === 'SENT' || delivery.state === 'NOTHING_TO_SEND') {
    const written = await store.writeSnapshots([{ key: ALERT_STATE_KEY, observedAt: now.toISOString(), payload: { active: current.map((c) => c.id) } }]);
    stateStored = written.state === 'WRITTEN';
  }

  return { active: current.map((c) => c.id), raised: t.raised.map((c) => c.id), cleared: t.cleared, delivery, stateStored };
}
