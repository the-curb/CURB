/**
 * COUNSEL — eligibility, rights and restrictions.
 *
 * The only agent that reads documents rather than the chain, and the one with
 * the narrowest job: point at the published terms, quote what was recorded, and
 * refuse every determination that belongs to the issuer.
 *
 * It applies the same three states to documents that the rest of the system
 * applies to figures. A link is not a reading. A register that lists five
 * sources the same way when one has been read and four have not is claiming
 * coverage it does not have, which is the document-shaped version of printing a
 * zero for a figure nobody looked up.
 *
 * What it does with every page, read or not, is watch it: fetch it, hash its
 * visible text, and say whether that hash is the one it saw before. A page
 * that changed is reported as changed, with the date — and for the page whose
 * content was recorded by hand, with the note that the recorded line was taken
 * from an earlier version. What changed is the issuer's page to read.
 */

import type { Producer, ProducerResult } from '../runtime.ts';
import type { DeclaredFigure } from '../../doctrine/policy.ts';
import type { SnapshotRecord } from '../../store/types.ts';
import { describeAge, isRead } from '../../doctrine/reading.ts';
import { NEVER_DETERMINED, TERMS_SOURCES, type TermsSource } from '../../chain/terms.ts';
import { fetchDigest, judgePage, watchOf, watchSnapshot, type PageVerdict } from '../../terms/watch.ts';

const INTERVAL = 24 * 3600;
const REGISTER_SOURCE = 'the published-terms register, kept in this repository with dates';

/** A few at a time: five pages from one host is a courtesy, not a burst. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

/** Every number a line prints, handed to the caller to declare with its source. */
export type Declare = (token: string, source: string) => void;

/**
 * The watch line for one source. Pure over the verdict; every figure it prints
 * — an age, a status code inside a reason — goes through `declare`, because a
 * line that says "first seen 11d ago" without declaring the eleven is a line
 * the gate blocks, and rightly.
 */
export function describeWatch(source: TermsSource, verdict: PageVerdict | null, unreadReason: string | null, now: Date, declare: Declare): string {
  const host = new URL(source.url).host;
  if (verdict === null) {
    const reason = unreadReason ?? 'no reason recorded';
    for (const n of reason.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) declare(n, `${host} · fetch failure`);
    return `— ${source.title}: could not be fetched on this run (${reason}). Whether it changed is not known; that is not the same as unchanged.`;
  }
  const ageOf = (iso: string) => {
    const text = describeAge(Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000)));
    declare(text.replace(/[^\d.]/g, ''), `the terms watch for ${host}, kept in the store`);
    return text;
  };
  switch (verdict.kind) {
    case 'FIRST_SEEN':
      return `— ${source.title}: fetched and hashed for the first time. Changes are reported from the next run.`;
    case 'UNCHANGED':
      return `— ${source.title}: fetched; its visible text hashes as it did when first seen ${ageOf(verdict.watch.firstSeenAt)} ago${verdict.watch.lastChangedAt ? `, and as it has since it last changed ${ageOf(verdict.watch.lastChangedAt)} ago` : ''}.`;
    case 'CHANGED': {
      const recorded =
        source.state === 'READ'
          ? ` The line recorded for this page came from an earlier version; it shows what was said on ${source.readAt}, not now.`
          : '';
      return `— ${source.title}: CHANGED since the last fetch. What changed is not read here; read the page.${recorded}`;
    }
  }
}

export const counselProducer: Producer = async ({ now, store }): Promise<ProducerResult> => {
  const opts = { intervalSeconds: INTERVAL, timeoutMs: 30_000 };
  const at = now.toISOString();

  const previous = await store.snapshots('terms:');
  const priorByKey = new Map<string, SnapshotRecord>();
  if (previous.state !== 'UNREAD') for (const s of previous.value) priorByKey.set(s.key, s);
  const priorsUnreadable = previous.state === 'UNREAD';

  const digests = await mapLimit(TERMS_SOURCES, 2, (source) => fetchDigest(source.url, opts));

  const figures: DeclaredFigure[] = [];
  const declare = (token: string, source: string = REGISTER_SOURCE, retrievedAt: string = at) => figures.push({ token, source, retrievedAt });
  const snapshots: SnapshotRecord[] = [];
  const watchLines: string[] = [];
  let fetched = 0;
  let changed = 0;
  let oldestInputAt: Date | null = null;

  TERMS_SOURCES.forEach((source, i) => {
    const digest = digests[i]!;
    if (!isRead(digest)) {
      watchLines.push(describeWatch(source, null, `${digest.reason}${digest.detail ? ` — ${digest.detail}` : ''}`, now, (token, src) => declare(token, src)));
      return;
    }
    fetched += 1;
    const retrieved = new Date(digest.retrievedAt);
    if (oldestInputAt === null || retrieved < oldestInputAt) oldestInputAt = retrieved;
    // Without the previous watches nothing can be compared; the fetch is kept
    // as a first sighting for the record, and the line says why.
    const prior = priorsUnreadable ? null : watchOf(priorByKey.get(`terms:${source.key}`));
    const verdict = judgePage(digest.value, prior, digest.retrievedAt);
    if (verdict.kind === 'CHANGED') changed += 1;
    snapshots.push(watchSnapshot(source.key, verdict.watch, at));
    watchLines.push(
      priorsUnreadable
        ? `— ${source.title}: fetched, but earlier checks could not be read back, so nothing is compared. Not the same as unchanged.`
        : describeWatch(source, verdict, null, now, (token, src) => declare(token, src, digest.retrievedAt)),
    );
  });

  // The register always answers: it is the record of what has and has not been
  // read, and that record is the primary thing this agent publishes. Each page
  // fetched is a further source on top of it.
  const sourcesReached = 1 + fetched;

  const read = TERMS_SOURCES.filter((s) => s.state === 'READ');
  const unread = TERMS_SOURCES.filter((s) => s.state === 'LINK_ONLY');
  const totalCount = String(TERMS_SOURCES.length);
  const readCount = String(read.length);
  const unreadCount = String(unread.length);
  const fetchedCount = String(fetched);
  const changedCount = String(changed);
  [totalCount, readCount, unreadCount, fetchedCount, changedCount].forEach((t) => declare(t));

  const readLines = read.map(
    (source) => `— ${source.title} (${source.url}), read ${source.readAt}. It is the authority for ${source.covers}. Recorded: ${source.recorded}`,
  );
  const unreadLines = unread.map(
    (source) => `— ${source.title} (${source.url}) is the authority for ${source.covers}. Held as a link, not read for meaning.`,
  );

  const body = [
    `THE REGISTER · ${readCount} of ${totalCount} sources read`,
    ...(readLines.length > 0 ? readLines : ['— No published source has been read, so this register carries no quotations.']),
    '',
    `NOT READ · ${unreadCount} of ${totalCount}`,
    ...(unreadLines.length > 0 ? unreadLines : ['— Every source in the register has been read.']),
    '',
    `WATCHED · ${fetchedCount} of ${totalCount} pages fetched · ${changedCount} changed`,
    ...watchLines,
    '',
    'NEVER DETERMINED HERE',
    ...NEVER_DETERMINED.map((line) => `— ${line}`),
    '',
    'HOW TO READ THIS',
    '— A quotation is what a page said on the date beside it, not what it says now.',
    '— A changed hash means the page’s text changed. It does not say which words.',
    '— Pointing at a term is not interpreting it. For a decision, read the issuer’s page.',
  ].join('\n');

  return {
    publication: {
      headline: `TERMS · ${readCount} of ${totalCount} read · ${fetchedCount} watched${changed > 0 ? ` · ${changedCount} CHANGED` : ''}`,
      body,
      figures,
      // 24/5 names the schedule the vendor page states for stock feeds.
      allowedLiterals: ['24', '5'],
    },
    sourcesReached,
    oldestInputAt: oldestInputAt ?? (read[0]?.readAt ? new Date(read[0].readAt) : null),
    snapshots,
  };
};
