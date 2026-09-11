/**
 * Watching the published terms for change, without reading them for meaning.
 *
 * Counsel will not interpret a page. What it can do, on the same terms as any
 * figure, is measure one: fetch it, reduce it to its visible text, hash that,
 * and say whether the hash is the one it saw last time. "The restricted-
 * jurisdictions page changed on this date" is a fact with a source and a
 * time. What changed, and what it means, is the issuer's page to read.
 *
 * The hash covers the page's main content — the element the site puts its
 * prose in — so that a redesign of the navigation is less likely to read as a
 * change to the terms. It is still a change detector on a document, not a
 * diff of clauses: a changed hash means "go and read it", never more.
 */

import { createHash } from 'node:crypto';
import { getText } from '../chain/transport.ts';
import { read, unread, type Reading } from '../doctrine/reading.ts';
import type { SnapshotRecord } from '../store/types.ts';

export interface PageDigest {
  readonly url: string;
  /** sha256 of the normalised visible text of the main content. */
  readonly hash: string;
  readonly chars: number;
  readonly status: number;
}

const ENTITIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/&nbsp;/g, ' '],
  [/&amp;/g, '&'],
  [/&#x27;|&#39;|&apos;/g, "'"],
  [/&quot;/g, '"'],
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&rsquo;/g, '’'],
  [/&lsquo;/g, '‘'],
  [/&mdash;/g, '—'],
  [/&ndash;/g, '–'],
];

/** The page as a reader would see it: main content, tags gone, whitespace folded. */
export function visibleText(html: string): string {
  const main =
    /<main[\s>][\s\S]*?<\/main>/i.exec(html)?.[0] ??
    /<article[\s>][\s\S]*?<\/article>/i.exec(html)?.[0] ??
    /<body[\s>][\s\S]*?<\/body>/i.exec(html)?.[0] ??
    html;
  let text = main
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  for (const [pattern, replacement] of ENTITIES) text = text.replace(pattern, replacement);
  // Tags become spaces, which puts a space before the full stop after an
  // inline element. Fold that: a re-render that wraps a word in <em> is not
  // a change to the terms.
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?)\]])/g, '$1')
    .trim();
}

export function digestOf(url: string, html: string, status: number): PageDigest {
  const text = visibleText(html);
  return { url, hash: createHash('sha256').update(text).digest('hex'), chars: text.length, status };
}

export async function fetchDigest(url: string, opts: { readonly intervalSeconds: number; readonly timeoutMs?: number }): Promise<Reading<PageDigest>> {
  const source = `${new URL(url).host} · GET`;
  const startedAt = new Date();
  try {
    const response = await getText(url, { timeoutMs: opts.timeoutMs ?? 30_000, accept: 'text/html' });
    if (!response.ok) {
      return unread('SOURCE_UNREACHABLE', { source, detail: `HTTP ${response.status}` });
    }
    const digest = digestOf(url, response.text, response.status);
    if (digest.chars === 0) {
      return unread('SOURCE_MALFORMED', { source, detail: 'the page carried no visible text' });
    }
    return read({ value: digest, source, retrievedAt: startedAt, intervalSeconds: opts.intervalSeconds });
  } catch (cause) {
    const aborted = cause instanceof Error && cause.name === 'AbortError';
    return unread(aborted ? 'SOURCE_TIMEOUT' : 'SOURCE_UNREACHABLE', {
      source,
      detail: cause instanceof Error ? cause.message : 'unknown transport failure',
    });
  }
}

export interface PageWatch {
  readonly hash: string;
  readonly chars: number;
  readonly firstSeenAt: string;
  readonly lastFetchedAt: string;
  /** When the hash last differed from the one before it. Null while unchanged since first seen. */
  readonly lastChangedAt: string | null;
  readonly changes: number;
}

export type PageVerdict =
  | { readonly kind: 'FIRST_SEEN'; readonly watch: PageWatch }
  | { readonly kind: 'UNCHANGED'; readonly watch: PageWatch }
  | { readonly kind: 'CHANGED'; readonly watch: PageWatch; readonly previousHash: string };

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The previous watch, read back from a snapshot and checked field by field. */
export function watchOf(snapshot: SnapshotRecord | undefined): PageWatch | null {
  if (!snapshot) return null;
  const p = snapshot.payload;
  const hash = str(p.hash);
  const firstSeenAt = str(p.firstSeenAt);
  const lastFetchedAt = str(p.lastFetchedAt);
  if (hash === null || firstSeenAt === null || lastFetchedAt === null) return null;
  return {
    hash,
    chars: num(p.chars) ?? 0,
    firstSeenAt,
    lastFetchedAt,
    lastChangedAt: str(p.lastChangedAt),
    changes: num(p.changes) ?? 0,
  };
}

/** Compare a fresh digest with the previous watch. Pure. */
export function judgePage(digest: PageDigest, prior: PageWatch | null, fetchedAt: string): PageVerdict {
  if (prior === null) {
    return { kind: 'FIRST_SEEN', watch: { hash: digest.hash, chars: digest.chars, firstSeenAt: fetchedAt, lastFetchedAt: fetchedAt, lastChangedAt: null, changes: 0 } };
  }
  if (prior.hash === digest.hash) {
    return { kind: 'UNCHANGED', watch: { ...prior, lastFetchedAt: fetchedAt } };
  }
  return {
    kind: 'CHANGED',
    previousHash: prior.hash,
    watch: { ...prior, hash: digest.hash, chars: digest.chars, lastFetchedAt: fetchedAt, lastChangedAt: fetchedAt, changes: prior.changes + 1 },
  };
}

export function watchSnapshot(key: string, watch: PageWatch, observedAt: string): SnapshotRecord {
  return { key: `terms:${key}`, observedAt, payload: { ...watch } };
}
