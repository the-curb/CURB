/**
 * The evidence archive: what the issuers publish about the candidate
 * components, fetched on a schedule, kept exactly as received, and parsed
 * separately.
 *
 * Every fetch is an observation with a source, a read time, a hash of the
 * body and an explicit status. A body that changed since the last one is a
 * new versioned record; a body that did not is a note that it was checked.
 * The parse never overwrites the raw text, and a raw text is never trusted
 * further than its status allows. Nothing here reads a chain: what an
 * address does on chain is the verification's job, not the archive's.
 */

import type { SnapshotRecord, Store } from '../store/types.ts';
import { APPLE_S1 } from './series.ts';
import { fetchDigest } from '../terms/watch.ts';
import {
  fetchDocumented,
  fetchOndo,
  ONDO_ADDRESSES_URL,
  parseOndoAddresses,
  parseXstocksAsset,
  XSTOCKS_ASSET_URL,
  type Fetched,
  type FetchStatus,
  type OndoAsset,
  type XstocksAsset,
} from './issuers.ts';

export type EvidenceKind = 'xstocks-asset' | 'ondo-addresses' | 'page';

export interface EvidenceSource {
  /** Stable id: `<issuer>:<instrument>`. */
  readonly id: string;
  readonly kind: EvidenceKind;
  readonly seriesId: string;
  readonly component: 'A' | 'B';
  readonly url: string;
  readonly title: string;
}

export const EVIDENCE_SOURCES: readonly EvidenceSource[] = [
  {
    id: 'xstocks:AAPLx',
    kind: 'xstocks-asset',
    seriesId: APPLE_S1.id,
    component: 'A',
    url: XSTOCKS_ASSET_URL('AAPLx'),
    title: 'xStocks public asset record for AAPLx',
  },
  {
    id: 'ondo:AAPLon',
    kind: 'ondo-addresses',
    seriesId: APPLE_S1.id,
    component: 'B',
    url: ONDO_ADDRESSES_URL('AAPLon'),
    title: 'Ondo contract addresses for AAPLon',
  },
  // The documents each issuer publishes about the instrument, watched for
  // change by the hash of their visible text and never read for meaning —
  // a change is a page for a person to read, not a fact this desk asserts.
  ...APPLE_S1.components.flatMap((c) =>
    c.sources
      .filter((doc) => doc.url !== XSTOCKS_ASSET_URL('AAPLx') && !doc.url.startsWith(ONDO_ADDRESSES_URL('')))
      .map((doc) => ({
        id: `page:${c.id}:${new URL(doc.url).pathname
          .replace(/[^a-z0-9]+/gi, '-')
          .replace(/^-|-$/g, '')
          .toLowerCase()}`,
        kind: 'page' as const,
        seriesId: APPLE_S1.id,
        component: c.id,
        url: doc.url,
        title: doc.title,
      })),
  ),
];

export type ParseStatus = 'PARSED' | 'NOT_PARSED';

export interface Observation {
  readonly sourceId: string;
  readonly kind: EvidenceKind;
  readonly url: string;
  readonly readAt: string;
  readonly status: FetchStatus;
  readonly httpStatus: number | null;
  readonly hash: string | null;
  readonly raw: string | null;
  readonly parse: ParseStatus;
  readonly parsed: XstocksAsset | OndoAsset | null;
  readonly detail: string | null;
}

export const EVIDENCE_PREFIX = 'evidence:';
export const evidenceLatestKey = (sourceId: string) => `${EVIDENCE_PREFIX}${sourceId}:latest`;
export const evidenceVersionKey = (sourceId: string, hash: string) => `${EVIDENCE_PREFIX}${sourceId}:v:${hash}`;

function parseFor(
  kind: EvidenceKind,
  fetched: Fetched,
): {
  parse: ParseStatus;
  parsed: Observation['parsed'];
  status: FetchStatus;
  detail: string | null;
} {
  if (fetched.status !== 'OK' || fetched.raw === null)
    return {
      parse: 'NOT_PARSED',
      parsed: null,
      status: fetched.status,
      detail: fetched.detail,
    };
  const result = kind === 'xstocks-asset' ? parseXstocksAsset(fetched.raw) : parseOndoAddresses(fetched.raw);
  if (result.ok)
    return {
      parse: 'PARSED',
      parsed: result.asset,
      status: 'OK',
      detail: null,
    };
  return {
    parse: 'NOT_PARSED',
    parsed: null,
    status: result.status,
    detail: result.detail,
  };
}

export async function observe(source: EvidenceSource, now: Date): Promise<Observation> {
  if (source.kind === 'page') return observePage(source, now);
  const fetched = source.kind === 'ondo-addresses' ? await fetchOndo(source.url, now) : await fetchDocumented(source.url, now);
  const p = parseFor(source.kind, fetched);
  return {
    sourceId: source.id,
    kind: source.kind,
    url: source.url,
    readAt: fetched.readAt,
    status: p.status,
    httpStatus: fetched.httpStatus,
    hash: fetched.hash,
    raw: fetched.raw,
    parse: p.parse,
    parsed: p.parsed,
    detail: p.detail,
  };
}

/** A document: its visible text hashed, its length noted, its body not kept. */
async function observePage(source: EvidenceSource, now: Date): Promise<Observation> {
  const digest = await fetchDigest(source.url, { intervalSeconds: 24 * 3600 });
  const base = {
    sourceId: source.id,
    kind: source.kind,
    url: source.url,
    readAt: now.toISOString(),
    raw: null,
    parse: 'NOT_PARSED' as const,
    parsed: null,
  };
  if (digest.state === 'UNREAD') {
    const denied = /HTTP 40[13]/.test(digest.detail ?? '');
    return {
      ...base,
      status: denied ? 'ACCESS_DENIED' : digest.reason === 'SOURCE_MALFORMED' ? 'SCHEMA_CHANGED' : 'UNREACHABLE',
      httpStatus: null,
      hash: null,
      detail: `${digest.reason}${digest.detail ? ` — ${digest.detail}` : ''}`,
    };
  }
  return {
    ...base,
    status: 'OK',
    httpStatus: digest.value.status,
    hash: digest.value.hash,
    detail: `${digest.value.chars.toLocaleString('en-US')} characters of visible text, hashed; not read for meaning`,
  };
}

/** The observation stored under a key, or null when the snapshot is not one. */
export function observationOf(snapshot: SnapshotRecord | undefined): Observation | null {
  if (!snapshot) return null;
  const p = snapshot.payload;
  if (typeof p.sourceId !== 'string' || typeof p.readAt !== 'string' || typeof p.status !== 'string') return null;
  return p as unknown as Observation;
}

export interface ArchiveOutcome {
  readonly sourceId: string;
  readonly status: FetchStatus;
  readonly parse: ParseStatus;
  readonly hash: string | null;
  /** NEW when the body's hash was not on record, SAME when it was, NONE when there was no body. */
  readonly version: 'NEW' | 'SAME' | 'NONE';
  readonly recorded: boolean;
}

/**
 * Fetch every source and record what came back. The latest key always
 * moves; a version key is written only for a body not seen before, so the
 * archive grows by change, not by schedule.
 */
export async function archiveEvidence(store: Store, now: Date, sources: readonly EvidenceSource[] = EVIDENCE_SOURCES): Promise<ArchiveOutcome[]> {
  const outcomes: ArchiveOutcome[] = [];
  for (const source of sources) {
    const observation = await observe(source, now);
    const prior = await store.snapshots(evidenceLatestKey(source.id));
    const priorLatest = prior.state === 'UNREAD' ? null : observationOf(prior.value.find((s) => s.key === evidenceLatestKey(source.id)));
    const version: ArchiveOutcome['version'] = observation.hash === null ? 'NONE' : priorLatest?.hash === observation.hash ? 'SAME' : 'NEW';

    const records: SnapshotRecord[] = [
      {
        key: evidenceLatestKey(source.id),
        observedAt: observation.readAt,
        payload: observation as unknown as Record<string, unknown>,
      },
    ];
    if (version === 'NEW' && observation.hash !== null) {
      records.push({
        key: evidenceVersionKey(source.id, observation.hash),
        observedAt: observation.readAt,
        payload: observation as unknown as Record<string, unknown>,
      });
    }
    const written = await store.writeSnapshots(records);
    outcomes.push({
      sourceId: source.id,
      status: observation.status,
      parse: observation.parse,
      hash: observation.hash,
      version,
      recorded: written.state === 'WRITTEN',
    });
  }
  return outcomes;
}

/** The latest observation per source, as the store has it. */
export async function latestEvidence(
  store: Store,
  sources: readonly EvidenceSource[] = EVIDENCE_SOURCES,
): Promise<
  {
    source: EvidenceSource;
    observation: Observation | null;
    storeFault: string | null;
  }[]
> {
  const read = await store.snapshots(EVIDENCE_PREFIX);
  return sources.map((source) => {
    if (read.state === 'UNREAD')
      return {
        source,
        observation: null,
        storeFault: `${read.reason}${read.detail ? ` — ${read.detail}` : ''}`,
      };
    return {
      source,
      observation: observationOf(read.value.find((s) => s.key === evidenceLatestKey(source.id))),
      storeFault: null,
    };
  });
}

/** How many distinct bodies have been archived for a source. */
export async function versionCount(store: Store, sourceId: string): Promise<number | null> {
  const read = await store.snapshots(`${EVIDENCE_PREFIX}${sourceId}:v:`);
  return read.state === 'UNREAD' ? null : read.value.length;
}
