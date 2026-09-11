import { notFound } from 'next/navigation';
import { composeEdition, isValidDay, utcDay, type Edition } from '@/lib/gazette/edition';
import { getStoreAsync } from '@/lib/store';
import { editionHash } from '@/lib/gazette/narrate';
import { BRAND } from '@/lib/brand';
import { ABSENT_GLYPH } from '@/lib/doctrine/reading';

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
        <h3 className="text-lg text-(--color-paper)" style={{ fontFamily: 'var(--font-serif)' }}>
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
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              {edition.headline}
            </h2>

            {narration?.current && narration.outcome === 'NARRATED' && narration.standfirst ? (
              <>
                <p
                  className="text-lg leading-relaxed text-(--color-paper)"
                  style={{ fontFamily: 'var(--font-serif)' }}
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
                    A narration was attempted and {narration.outcome.replace(/_/g, ' ').toLowerCase()}
                    {narration.detail ? ` — ${narration.detail}` : ''}. The paper&apos;s own count stands.
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
