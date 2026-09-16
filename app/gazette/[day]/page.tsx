import { notFound } from 'next/navigation';
import { composeEdition, isValidDay, utcDay, type Edition } from '@/lib/gazette/edition';
import { getStoreAsync } from '@/lib/store';
import { editionHash } from '@/lib/gazette/narrate';
import { BRAND } from '@/lib/brand';
import { ABSENT_GLYPH } from '@/lib/doctrine/reading';
import { positionsJournal, type JournalEntry } from '@/lib/positions/journal';
import { creditsStatus } from '@/lib/credits/config';
import { centsText } from '@/lib/credits/prices';
import { receiptsByDay } from '@/lib/credits/receipts';
import { seriesById } from '@/lib/positions/series';

const JOURNAL_LABEL: Record<JournalEntry['kind'], string> = {
  EVIDENCE_ARCHIVED: 'archived',
  EVIDENCE_CHANGED: 'changed',
  DRIFT: 'moved on chain',
  FINDING: 'reconciliation moved',
};

/** Composed on every request. Today's edition grows until midnight UTC. */
export const dynamic = 'force-dynamic';

type Params = Promise<{ day: string }>;

export async function generateMetadata(props: { params: Params }) {
  const { day } = await props.params;
  return { title: `${day} · ${BRAND.paper.name}` };
}

function longDate(day: string): string {
  return new Date(`${day}T12:00:00Z`)
    .toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' })
    .toUpperCase();
}

function Rule({ heavy = false }: { heavy?: boolean }) {
  return <div className={`border-t ${heavy ? 'border-t-2 border-(--color-paper)' : 'border-(--color-rule)'}`} />;
}

function Masthead({ edition }: { edition: Edition }) {
  return (
    <header className="mb-10">
      <Rule heavy />
      <div className="py-6 text-center">
        <h1 className="display text-5xl tracking-[0.06em] text-(--color-paper) sm:text-7xl">
          {edition.masthead.toUpperCase()}
        </h1>
      </div>
      <Rule />
      <div className="flex flex-wrap items-center justify-between gap-2 py-2 text-[10px] uppercase tracking-[0.2em] text-(--color-paper-faint)">
        <span>{longDate(edition.day)}</span>
        <span>{BRAND.paper.cadence}</span>
        <span>{edition.isToday ? 'Live edition' : 'Closed edition'}</span>
      </div>
      <Rule heavy />
    </header>
  );
}

function Section({ section }: { section: Edition['sections'][number] }) {
  return (
    <article className="border-t border-(--color-rule) py-6 first:border-t-0 first:pt-0">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg text-(--color-paper)" style={{ fontFamily: 'var(--font-sans)' }}>
          {section.headline}
        </h3>
        <span className="text-[10px] uppercase tracking-[0.16em] text-(--color-paper-faint)">
          Filed by {section.agent.name} · {section.publishedAt.slice(11, 16)} UTC
          {section.filings > 1 ? ` · latest of ${section.filings} filings today` : ''}
        </span>
      </div>
      {section.agent.posture === 'PROMOTES' ? (
        <p className="mb-3 text-[10px] uppercase tracking-[0.16em] text-(--color-brass)">
          Promotion · disclosed by the author, appended by code
        </p>
      ) : null}
      <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-(--color-paper-dim)">
        {section.body}
      </pre>
      <p className="mt-3 border-l-2 border-(--color-rule-2) pl-3 text-[11px] italic leading-relaxed text-(--color-paper-faint)">
        {section.agent.refusal}
      </p>
    </article>
  );
}

export default async function EditionPage(props: { params: Params }) {
  const { day } = await props.params;
  if (!isValidDay(day)) notFound();

  const now = new Date();
  const store = await getStoreAsync();
  const record = await store.dayRecord(day);

  // A record that could not be read is not a day with nothing in it.
  if (record.state === 'UNREAD') {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-sm" style={{ color: 'var(--color-state-stale)' }}>
          The record for {day} could not be read ({record.reason}
          {record.detail ? ` — ${record.detail}` : ''}). No edition is shown, and none should be
          inferred: an unreadable record is not an empty day.
        </p>
      </main>
    );
  }

  const edition = composeEdition(record.value, now);
  const isFuture = day > utcDay(now);
  const districts = [...new Set(edition.sections.map((s) => s.district))];
  // The position product's verified changes that day: issuer records archived
  // or changed, candidate addresses that moved between verification runs, and
  // reconciliation findings that moved.
  const journal = isFuture ? null : await positionsJournal(store, day);
  // The credit desk's receipts that day, by the day they were credited — the
  // "after" the token record promises; printed when a desk exists or a
  // credit was ever made, so a day with none reads as none.
  const receipts = isFuture ? null : await receiptsByDay(store, day);
  const deskExists = creditsStatus().state === 'CONFIGURED';

  // The narrated lede, if one was attempted for this exact composition. A
  // narration pinned to an older hash is stale prose about a different edition
  // and is not shown as current.
  const narrationRead = edition.isToday ? null : await store.narration(day);
  const narration =
    narrationRead && narrationRead.state === 'VERIFIED' && narrationRead.value
      ? { ...narrationRead.value, current: narrationRead.value.editionHash === editionHash(edition) }
      : null;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 sm:py-16">

      <Masthead edition={edition} />

      {isFuture ? (
        <p className="text-sm text-(--color-paper-faint)">
          {day} has not happened yet. There is nothing to print, and nothing here guesses at it.
        </p>
      ) : edition.sections.length === 0 && edition.notRead.length === 0 ? (
        <p className="text-sm text-(--color-paper-faint)">
          Nothing was recorded on {day}. That is an empty day in the record, not a day the record
          could not reach.
        </p>
      ) : (
        <>
          {/* ── Front page ─────────────────────────────────────────────── */}
          <section className="mb-12">
            <h2
              className="mb-4 text-3xl leading-tight text-(--color-paper) sm:text-4xl"
              style={{ fontFamily: 'var(--font-sans)' }}
            >
              {edition.headline}
            </h2>

            {narration?.current && narration.outcome === 'NARRATED' && narration.standfirst ? (
              <>
                <p
                  className="text-lg leading-relaxed text-(--color-paper)"
                  style={{ fontFamily: 'var(--font-sans)' }}
                >
                  {narration.standfirst}
                </p>
                <p className="mt-3 text-[10px] uppercase tracking-[0.16em] text-(--color-paper-faint)">
                  Written by {narration.model} over the record · every figure in it is the record&apos;s · passed the same gate as every agent
                </p>
                <p className="mt-4 border-l-2 border-(--color-rule-2) pl-4 text-sm leading-relaxed text-(--color-paper-dim)">
                  {edition.standfirst}
                </p>
              </>
            ) : (
              <>
                <p className="text-base leading-relaxed text-(--color-paper-dim)">{edition.standfirst}</p>
                {narration && narration.current && narration.outcome !== 'NARRATED' ? (
                  <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--color-state-stale)' }}>
                    {/* The outcome is the paper's business; the vendor's own error text is
                        not, and republishing a billing message on a public page tells a
                        reader nothing about the record. The detail stays in the row. */}
                    A narration was attempted and {narration.outcome.replace(/_/g, ' ').toLowerCase()}. The paper&apos;s own count stands.
                  </p>
                ) : narration && !narration.current ? (
                  <p className="mt-3 text-xs leading-relaxed text-(--color-paper-faint)">
                    An earlier narration exists for a different composition of this day and is not shown.
                  </p>
                ) : null}
              </>
            )}
          </section>

          {/* ── Districts ──────────────────────────────────────────────── */}
          {districts.map((district) => (
            <section key={district} className="mb-12">
              <div className="mb-4 flex items-baseline gap-4">
                <h2 className="text-[11px] uppercase tracking-[0.28em] text-(--color-brass)">
                  {district}
                </h2>
                <span className="text-[10px] text-(--color-paper-faint)">
                  {BRAND.universe.districts.find((d) => d.name === district)?.holds}
                </span>
              </div>
              <div className="border border-(--color-rule) bg-(--color-ink-2) p-5 sm:p-6">
                {edition.sections
                  .filter((s) => s.district === district)
                  .map((s) => (
                    <Section key={`${s.agent.id}-${s.publishedAt}`} section={s} />
                  ))}
              </div>
            </section>
          ))}

          {/* ── What was not read ──────────────────────────────────────── */}
          <section className="mb-12">
            <h2 className="mb-4 text-[11px] uppercase tracking-[0.28em] text-(--color-paper-faint)">
              What was not read
            </h2>
            <div className="border border-(--color-rule) bg-(--color-ink-2) p-5 sm:p-6">
              {edition.notRead.length === 0 ? (
                <p className="text-sm text-(--color-paper-faint)">
                  Every agent that ran completed its reading. This line is printed so its absence
                  would be noticed.
                </p>
              ) : (
                <ul className="space-y-3">
                  {edition.notRead.map((n) => (
                    <li key={`${n.agent.id}-${n.at}`} className="text-sm">
                      <span className="text-(--color-paper)">{n.agent.name}</span>
                      <span className="ml-3 text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--color-state-degraded)' }}>
                        {n.outcome.replace(/_/g, ' ')}
                      </span>
                      <span className="ml-3 text-[10px] text-(--color-paper-faint)">{n.at.slice(11, 16)} UTC</span>
                      {n.detail ? (
                        <p className="mt-1 text-xs leading-relaxed text-(--color-paper-faint)">{n.detail}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* ── Sources of record ──────────────────────────────────────── */}
          <section className="mb-12">
            <h2 className="mb-4 text-[11px] uppercase tracking-[0.28em] text-(--color-paper-faint)">
              Sources of record
            </h2>
            <div className="border border-(--color-rule) bg-(--color-ink-2) p-5 sm:p-6">
              {edition.sources.length === 0 ? (
                <p className="text-sm text-(--color-paper-faint)">
                  No figure was declared today, so no source is cited. A figure without a source
                  does not go out.
                </p>
              ) : (
                <ol className="space-y-1.5">
                  {edition.sources.map((s, i) => (
                    <li key={s.source} className="flex items-baseline gap-3 text-xs">
                      <span className="tabular w-6 shrink-0 text-(--color-paper-faint)">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="text-(--color-paper-dim)">{s.source}</span>
                      <span className="tabular ml-auto shrink-0 text-(--color-paper-faint)">
                        {s.figures} {s.figures === 1 ? 'figure' : 'figures'} · first read {s.firstReadAt.slice(11, 16)} UTC
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>

          {/* ── The ledger ─────────────────────────────────────────────── */}
          <section className="mb-12">
            <h2 className="mb-4 text-[11px] uppercase tracking-[0.28em] text-(--color-paper-faint)">
              The ledger
            </h2>
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 border border-(--color-rule) bg-(--color-ink-2) p-5 text-xs sm:grid-cols-3 sm:p-6">
              {(Object.entries(edition.ledger) as [string, number][]).map(([outcome, n]) => (
                <div key={outcome} className="flex items-baseline justify-between gap-3">
                  <span className="uppercase tracking-[0.12em] text-(--color-paper-faint)">
                    {outcome.replace(/_/g, ' ').toLowerCase()}
                  </span>
                  <span className="tabular text-(--color-paper)">{n === 0 ? ABSENT_GLYPH : n}</span>
                </div>
              ))}
              <div className="flex items-baseline justify-between gap-3">
                <span className="uppercase tracking-[0.12em] text-(--color-paper-faint)">
                  outputs kept after block
                </span>
                <span className="tabular text-(--color-paper)">
                  {edition.blockedOutputs === 0 ? ABSENT_GLYPH : edition.blockedOutputs}
                </span>
              </div>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-(--color-paper-faint)">
              A dash is a count of zero, printed as a dash so it cannot be mistaken for a figure that was
              measured. Every run that day is counted here, including the ones that produced nothing.
            </p>
          </section>
        </>
      )}

      {journal === null ? null : (
        <section className="mb-12">
          <h2 className="mb-4 text-[11px] uppercase tracking-[0.28em] text-(--color-paper-faint)">
            Positions · verified changes
          </h2>
          <div className="border border-(--color-rule) bg-(--color-ink-2) p-5 sm:p-6">
            {journal.storeFault !== null ? (
              <p className="text-sm" style={{ color: 'var(--color-state-stale)' }}>
                The position product&apos;s archive could not be read ({journal.storeFault}). Nothing is shown, and an unreadable archive is not a day without change.
              </p>
            ) : journal.entries.length === 0 ? (
              <p className="text-sm text-(--color-paper-faint)">
                No issuer record or document was archived or changed, no candidate address moved between verification runs, and no reconciliation finding moved, on {day}. Printed so its absence would be noticed.
              </p>
            ) : (
              <ul className="space-y-3">
                {journal.entries.map((e) => (
                  <li key={`${e.at}-${e.seriesId}-${e.component}-${e.subject}-${e.mark}`} className="text-sm">
                    <span className="tabular text-[10px] text-(--color-paper-faint)">{e.at.slice(11, 16)} UTC</span>
                    <span className="ml-3 text-(--color-accent)">{e.component}</span>
                    <span className="ml-2 text-(--color-paper)">
                      {e.url ? (
                        <a href={e.url} className="underline decoration-(--color-rule-2) underline-offset-4 hover:text-(--color-paper)" rel="noopener noreferrer" target="_blank">
                          {e.subject}
                        </a>
                      ) : (
                        <span className="tabular">{e.subject}</span>
                      )}
                    </span>
                    <span className="ml-3 text-[10px] uppercase tracking-[0.14em]" style={{ color: e.kind === 'DRIFT' || (e.kind === 'FINDING' && e.mark === 'SHORTFALL') ? 'var(--color-state-dark)' : e.kind === 'EVIDENCE_CHANGED' || e.kind === 'FINDING' ? 'var(--color-state-degraded)' : 'var(--color-paper-faint)' }}>
                      {JOURNAL_LABEL[e.kind]} · {e.mark}
                    </span>
                    <p className="mt-1 text-xs leading-relaxed text-(--color-paper-faint)">
                      {seriesById(e.seriesId)?.name ?? e.seriesId} — {e.detail}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-(--color-paper-faint)">
            Derived from the archive&apos;s version rows and the verification&apos;s drift rows, by the day they were observed; composed again tomorrow from the same rows, the day reads the same. A change is a fact about the source, not a finding about the instrument.
          </p>
        </section>
      )}

      {receipts === null || (!deskExists && receipts.topUps === 0 && receipts.storeFault === null) ? null : (
        <section className="mb-12">
          <h2 className="mb-4 text-[11px] uppercase tracking-[0.28em] text-(--color-paper-faint)">
            Services · receipts
          </h2>
          <div className="border border-(--color-rule) bg-(--color-ink-2) p-5 sm:p-6">
            {receipts.storeFault !== null ? (
              <p className="text-sm" style={{ color: 'var(--color-state-stale)' }}>
                The credit desk&apos;s rows could not be read ({receipts.storeFault}). Nothing is shown, and an unreadable store is not a day without receipts.
              </p>
            ) : receipts.topUps === 0 ? (
              <p className="text-sm text-(--color-paper-faint)">No top-up was credited on {day}. Printed so its absence would be noticed.</p>
            ) : (
              <p className="text-sm text-(--color-paper)">
                <span className="tabular">{receipts.topUps}</span> top-up{receipts.topUps === 1 ? '' : 's'} to <span className="tabular">{receipts.keys}</span> key{receipts.keys === 1 ? '' : 's'} credited{' '}
                <span className="tabular">{centsText(BigInt(receipts.cents))}</span> for <span className="tabular">{receipts.curbBaseUnits}</span> base units of CURB
                <span className="text-(--color-paper-faint)">
                  {' '}
                  — priced at their own block by state {receipts.byBasis.TOP_UP_BLOCK}, by the pool&apos;s events {receipts.byBasis.TOP_UP_BLOCK_EVENTS}, at the head when indexed {receipts.byBasis.HEAD_AT_INDEXING}
                </span>
                .
              </p>
            )}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-(--color-paper-faint)">
            Derived from the keys&apos; rows by the day the credit was made; key hashes are not printed. The price list and the running total are on the services page.
          </p>
        </section>
      )}

      <footer className="border-t border-(--color-rule) pt-6 text-[11px] leading-relaxed text-(--color-paper-faint)">
        <p>
          This edition is composed from the day&apos;s record and adds nothing to it. The agents are
          the reporters; each section carries its author&apos;s declared refusal. Nothing here is
          investment, legal or tax advice, and no agent places an order.
        </p>
        <p className="mt-2 tabular">Composed {edition.composedAt}</p>
      </footer>
    </main>
  );
}
