import { DeskNav } from '../components/desk-nav';
import { RegistryTable, type RegistryRowView } from '../components/registry-table';
import { STOCK_TOKENS_SOURCE, STOCK_TOKEN_BEACON } from '@/lib/chain/stock-tokens';
import { FEED_COVERAGE, STOCK_TOKEN_COVERAGE } from '@/lib/chain/feeds';
import { ABSENT_GLYPH, describeAge } from '@/lib/doctrine/reading';
import { composeRoll, type RollRow } from '@/lib/registry/roll';
import { getStoreAsync } from '@/lib/store';
import { REGISTRY, registryLine } from '@/lib/copy/registry';

export const dynamic = 'force-dynamic';
export const metadata = { title: REGISTRY.title, description: REGISTRY.description };

/**
 * THE REGISTRY — every stock token the issuer lists, and what the chain last
 * said about each. It opens on the table a reader came for, with the tokens
 * that need a second look at the top; then the two things a reader will not
 * find elsewhere on one page: that every token here runs the code one beacon
 * names, and whether the list this desk reads still matches the live one.
 */

const STATE_COLOUR = {
  VERIFIED: 'var(--color-state-live)',
  STALE: 'var(--color-state-stale)',
  ABSENT: 'var(--color-state-dark)',
  NONE: 'var(--color-state-fog)',
} as const;

function Absent({ why }: { why: string }) {
  return (
    <span className="absent" title={why}>
      {ABSENT_GLYPH}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-t border-(--color-rule) py-2.5 first:border-t-0">
      <span className="text-[11px] uppercase tracking-[0.16em] text-(--color-paper-faint)">{label}</span>
      <span className="text-right text-sm">{children}</span>
    </div>
  );
}

/** A change coming first, then a token that is not at one share, then the rest in the issuer's order. */
function attention(r: RollRow): number {
  return r.pending !== null ? 0 : r.notAtOne === true ? 1 : 2;
}

export default async function RegistryPage() {
  const now = new Date();
  const store = await getStoreAsync();
  const [snapshots, publications, driftSnapshots] = await Promise.all([store.snapshots('token:'), store.publicationsByAgent('registrar', 1), store.snapshots('capture:drift')]);
  // The capture against the world, as the Registrar last checked it. Stored JSON, checked field by field.
  const driftRow = driftSnapshots.state === 'UNREAD' ? null : (driftSnapshots.value.find((s) => s.key === 'capture:drift') ?? null);
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const drift = driftRow === null ? null : {
    checkedAgeSeconds: Math.max(0, Math.round((now.getTime() - new Date(driftRow.observedAt).getTime()) / 1000)),
    tokensListed: typeof driftRow.payload.tokensListed === 'number' ? driftRow.payload.tokensListed : null,
    feedsListed: typeof driftRow.payload.feedsListed === 'number' ? driftRow.payload.feedsListed : null,
    tokensAdded: list(driftRow.payload.tokensAdded), tokensRemoved: list(driftRow.payload.tokensRemoved), tokensMoved: list(driftRow.payload.tokensMoved),
    feedsAdded: list(driftRow.payload.feedsAdded), feedsRemoved: list(driftRow.payload.feedsRemoved),
  };
  const driftClean = drift !== null && [drift.tokensAdded, drift.tokensRemoved, drift.tokensMoved, drift.feedsAdded, drift.feedsRemoved].every((l) => l.length === 0);
  const roll = snapshots.state === 'UNREAD' ? null : composeRoll(snapshots.value, now);
  const rollFault = snapshots.state === 'UNREAD' ? `${snapshots.reason}${snapshots.detail ? ` — ${snapshots.detail}` : ''}` : null;
  const lastAudit = publications.state === 'UNREAD' ? null : (publications.value[0] ?? null);
  const beaconLine = lastAudit?.body.split('\n').find((l) => l.includes('stock-token beacon')) ?? null;
  const state = roll === null ? null : REGISTRY.state[roll.sampleState];

  const rows: RegistryRowView[] =
    roll === null
      ? []
      : roll.rows
          .map((row, i) => ({ row, i }))
          .sort((a, b) => attention(a.row) - attention(b.row) || a.i - b.i)
          .map(({ row }) => ({
            key: row.token.key,
            ticker: row.token.ticker,
            company: row.token.name.replace(/\s*•\s*Robinhood Token$/, ''),
            address: row.token.address,
            multiplier: row.multiplier,
            multiplierExact: row.multiplierExact,
            notAtOne: row.notAtOne,
            pending: row.pending,
            supply: row.supply,
            hasFeed: row.feedName !== null,
            feedName: row.feedName,
            checked: row.sampleAgeSeconds === null ? null : `${describeAge(row.sampleAgeSeconds)} ${REGISTRY.table.values.ago}`,
            unreadBecause: row.unreadBecause,
          }));

  const stats: ReadonlyArray<readonly [string | number, string]> = [
    [roll?.counts.total ?? STOCK_TOKEN_COVERAGE.tokensInRegistry, REGISTRY.counts.total],
    [roll?.counts.withFeed ?? STOCK_TOKEN_COVERAGE.withFeed, REGISTRY.counts.withFeed],
    [roll === null ? ABSENT_GLYPH : roll.counts.notAtOne, REGISTRY.counts.notAtOne],
    [roll === null ? ABSENT_GLYPH : roll.counts.pending, REGISTRY.counts.pending],
  ];

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 sm:py-16">
      <header className="mb-8">
        <DeskNav current="THE REGISTRY" />
        <h1 className="display mt-4 max-w-3xl text-4xl text-(--color-paper) sm:text-5xl">{REGISTRY.headline}</h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-(--color-paper-dim)">{REGISTRY.sub}</p>
        {state && roll ? (
          <p className="mt-4 text-[11px] uppercase tracking-[0.18em]" style={{ color: STATE_COLOUR[roll.sampleState] }} title={state.means}>
            ● {state.label}
            {roll.sampleAgeSeconds === null ? '' : ` · ${registryLine(REGISTRY.read, { age: describeAge(roll.sampleAgeSeconds) })}`}
          </p>
        ) : null}
      </header>

      <section className="cells mb-8 grid-cols-2 md:grid-cols-4">
        {stats.map(([value, label]) => (
          <div key={label} className="cell p-5">
            <div className="tabular text-3xl text-(--color-paper)">{value}</div>
            <div className="mt-1 text-[12px] text-(--color-paper-dim)">{label}</div>
          </div>
        ))}
      </section>

      <section className="mb-12 border border-(--color-rule) bg-(--color-ink-2) p-6 sm:p-8">
        <p className="max-w-2xl text-sm leading-relaxed text-(--color-paper-dim)">
          {REGISTRY.why} {REGISTRY.whyMore}
        </p>
        <div className="mt-6">
          {roll === null ? (
            <p className="text-sm leading-relaxed" style={{ color: 'var(--color-state-stale)' }}>
              {REGISTRY.unreadStore} <span className="text-(--color-paper-faint)">({rollFault})</span>
            </p>
          ) : (
            <RegistryTable rows={rows} />
          )}
        </div>
        <dl className="mt-8 grid gap-4 border-t border-(--color-rule) pt-5 sm:grid-cols-3">
          {REGISTRY.legend.map((item) => (
            <div key={item.term}>
              <dt className="text-[11px] uppercase tracking-[0.16em] text-(--color-paper-faint)">{item.term}</dt>
              <dd className="mt-1 text-[12px] leading-relaxed text-(--color-paper-dim)">{item.means}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── THE BEACON ────────────────────────────────────────────────────── */}
        <section className="border border-(--color-rule) bg-(--color-ink-2) p-6 sm:p-8">
          <h2 className="text-[12px] uppercase tracking-[0.24em] text-(--color-paper-faint)">{REGISTRY.beacon.kicker}</h2>
          <p className="mt-3 text-sm leading-relaxed text-(--color-paper-dim)">{REGISTRY.beacon.body}</p>
          <div className="mt-5">
            <Row label={REGISTRY.beacon.rows.last}>
              {beaconLine === null ? (
                <span className="text-xs text-(--color-paper-faint)">
                  <Absent why={lastAudit === null ? 'no Registrar filing has been read' : 'the last filing carries no beacon line'} /> {REGISTRY.beacon.noFiling}
                </span>
              ) : (
                <span className="text-xs" style={{ color: /CHANGED|DIFFERS/.test(beaconLine) ? 'var(--color-state-dark)' : 'var(--color-state-live)' }}>
                  {/CHANGED|DIFFERS/.test(beaconLine) ? REGISTRY.beacon.changed : REGISTRY.beacon.same}
                  {lastAudit ? ` · ${describeAge(Math.max(0, Math.round((now.getTime() - new Date(lastAudit.publishedAt).getTime()) / 1000)))} ${REGISTRY.beacon.ago}` : ''}
                </span>
              )}
            </Row>
            <Row label={REGISTRY.beacon.rows.address}>
              <span className="tabular break-all text-xs">{STOCK_TOKEN_BEACON.address}</span>
            </Row>
            <Row label={REGISTRY.beacon.rows.code}>
              <span className="tabular break-all text-xs">{STOCK_TOKEN_BEACON.observedImplementation}</span>
            </Row>
            <Row label={REGISTRY.beacon.rows.size}>
              <span className="tabular text-xs">{STOCK_TOKEN_BEACON.observedImplementationSizeBytes} bytes</span>
            </Row>
            <Row label={REGISTRY.beacon.rows.block}>
              <span className="tabular text-xs">{STOCK_TOKEN_BEACON.observedAtBlock}</span>
            </Row>
            <Row label={REGISTRY.beacon.rows.at}>
              <span className="tabular text-xs">{STOCK_TOKEN_BEACON.observedAt}</span>
            </Row>
          </div>
        </section>

        {/* ── THE CAPTURE, AGAINST THE WORLD ───────────────────────────────── */}
        <section className="border border-(--color-rule) bg-(--color-ink-2) p-6 sm:p-8">
          <h2 className="text-[12px] uppercase tracking-[0.24em] text-(--color-paper-faint)">{REGISTRY.capture.kicker}</h2>
          <p className="mt-3 text-sm leading-relaxed text-(--color-paper-dim)">{REGISTRY.capture.body}</p>
          {drift === null ? (
            <p className="mt-5 text-sm text-(--color-paper-faint)">
              <Absent why={driftSnapshots.state === 'UNREAD' ? 'the snapshot store could not be read' : 'the Registrar has not yet checked the capture against the live sources'} /> {REGISTRY.capture.notYet}
            </p>
          ) : (
            <div className="mt-5">
              <Row label={REGISTRY.capture.rows.result}>
                <span className="text-xs" style={{ color: driftClean ? 'var(--color-state-live)' : 'var(--color-state-stale)' }}>
                  {driftClean ? REGISTRY.capture.same : REGISTRY.capture.owed}
                </span>
              </Row>
              <Row label={REGISTRY.capture.rows.checked}>
                <span className="tabular text-xs">
                  {describeAge(drift.checkedAgeSeconds)} {REGISTRY.beacon.ago}
                </span>
              </Row>
              <Row label={REGISTRY.capture.rows.tokens}>
                <span className="tabular">
                  {drift.tokensListed ?? ABSENT_GLYPH} · {STOCK_TOKEN_COVERAGE.tokensInRegistry}
                </span>
              </Row>
              <Row label={REGISTRY.capture.rows.feeds}>
                <span className="tabular">
                  {drift.feedsListed ?? ABSENT_GLYPH} · {FEED_COVERAGE.capturedHere}
                </span>
              </Row>
              {drift.tokensAdded.length > 0 ? <Row label={REGISTRY.capture.rows.added}><span className="text-xs">{drift.tokensAdded.join(', ')}</span></Row> : null}
              {drift.tokensRemoved.length > 0 ? <Row label={REGISTRY.capture.rows.removed}><span className="text-xs">{drift.tokensRemoved.join(', ')}</span></Row> : null}
              {drift.tokensMoved.length > 0 ? <Row label={REGISTRY.capture.rows.moved}><span className="text-xs" style={{ color: 'var(--color-state-dark)' }}>{drift.tokensMoved.join(', ')}</span></Row> : null}
              {drift.feedsAdded.length > 0 ? <Row label={REGISTRY.capture.rows.feedsAdded}><span className="text-xs">{drift.feedsAdded.join(', ')}</span></Row> : null}
              {drift.feedsRemoved.length > 0 ? <Row label={REGISTRY.capture.rows.feedsRemoved}><span className="text-xs">{drift.feedsRemoved.join(', ')}</span></Row> : null}
            </div>
          )}
        </section>
      </div>

      <dl className="mt-8 grid gap-3 text-xs leading-relaxed text-(--color-paper-faint) sm:grid-cols-2">
        <div>
          <dt className="uppercase tracking-[0.16em]">{REGISTRY.sources.registry}</dt>
          <dd className="mt-1 break-all">
            {STOCK_TOKENS_SOURCE.url} · read {STOCK_TOKENS_SOURCE.retrievedAt} ·{' '}
            {registryLine(REGISTRY.sources.onChain, { n: STOCK_TOKENS_SOURCE.onThisChain, listed: STOCK_TOKENS_SOURCE.listed, block: STOCK_TOKENS_SOURCE.verifiedAtBlock })}
          </dd>
        </div>
        <div>
          <dt className="uppercase tracking-[0.16em]">{REGISTRY.sources.feeds}</dt>
          <dd className="mt-1 break-all">
            {FEED_COVERAGE.directory} · read {FEED_COVERAGE.observedAt} ·{' '}
            {registryLine(REGISTRY.sources.checked, { n: FEED_COVERAGE.capturedHere, listed: FEED_COVERAGE.listedByDirectory, block: FEED_COVERAGE.observedAtBlock })}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-(--color-paper-faint)">{REGISTRY.sources.note}</p>
    </main>
  );
}
