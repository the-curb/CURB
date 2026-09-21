import Link from 'next/link';
import { BRAND } from '@/lib/brand';
import { composeEdition, utcDay } from '@/lib/gazette/edition';
import { getStoreAsync } from '@/lib/store';
import { GAZETTE } from '@/lib/copy/gazette';

export const dynamic = 'force-dynamic';

export const metadata = { title: BRAND.paper.name };

const C = GAZETTE.index;

/** How many editions are printed with their front page; the rest are listed by date. */
const FRONT_PAGES = 7;

function longDate(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default async function GazetteIndex() {
  const now = new Date();
  const today = utcDay(now);
  const store = await getStoreAsync();
  const daysRead = await store.publicationDays(30);

  if (daysRead.state === 'UNREAD') {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-sm" style={{ color: 'var(--color-state-stale)' }}>
          {C.unread} <span className="text-(--color-paper-faint)">({daysRead.reason})</span>
        </p>
      </main>
    );
  }

  // Today is always listed, even before anything has been filed: a live edition
  // with nothing in it yet is a different thing from a day that never happened.
  const days = daysRead.value.includes(today) ? daysRead.value : [today, ...daysRead.value];
  const front = days.slice(0, FRONT_PAGES);
  const older = days.slice(FRONT_PAGES);

  const editions = await Promise.all(
    front.map(async (day) => {
      const record = await store.dayRecord(day);
      return record.state === 'UNREAD' ? { day, edition: null, reason: record.reason } : { day, edition: composeEdition(record.value, now), reason: null };
    }),
  );

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
      <header className="mb-10">
        <div className="border-t-2 border-(--color-paper)" />
        <div className="py-6 text-center">
          <h1 className="display text-5xl tracking-[0.06em] text-(--color-paper) sm:text-7xl">{BRAND.paper.name.toUpperCase()}</h1>
          <p className="mt-3 text-[10px] uppercase tracking-[0.2em] text-(--color-paper-faint)">
            {BRAND.paper.cadence} · {GAZETTE.reporters}
          </p>
        </div>
        <div className="border-t-2 border-(--color-paper)" />
      </header>

      <ol className="space-y-0">
        {editions.map(({ day, edition, reason }) => (
          <li key={day} className="border-t border-(--color-rule) py-6 first:border-t-0">
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-[10px] uppercase tracking-[0.18em] text-(--color-paper-faint)">
              <span>{longDate(day)}</span>
              <span>{day === today ? C.live : C.edition}</span>
            </div>
            {edition === null ? (
              <p className="text-sm" style={{ color: 'var(--color-state-stale)' }}>
                {C.dayUnread} <span className="text-(--color-paper-faint)">({reason})</span>
              </p>
            ) : (
              <>
                <Link href={`/gazette/${day}`} className="group block">
                  <h2 className="text-2xl leading-tight text-(--color-paper) group-hover:text-(--color-brass) sm:text-3xl" style={{ fontFamily: 'var(--font-sans)' }}>
                    {edition.headline}
                  </h2>
                </Link>
                <p className="mt-2 text-sm leading-relaxed text-(--color-paper-dim)">{edition.standfirst}</p>
                <Link href={`/gazette/${day}`} className="mt-3 inline-block text-[11px] uppercase tracking-[0.16em] text-(--color-paper-faint) hover:text-(--color-paper)">
                  {C.read} ›
                </Link>
              </>
            )}
          </li>
        ))}
      </ol>

      {older.length > 0 ? (
        <section className="mt-8 border-t border-(--color-rule) pt-6">
          <h2 className="text-[10px] uppercase tracking-[0.18em] text-(--color-paper-faint)">{C.older}</h2>
          <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            {older.map((day) => (
              <li key={day}>
                <Link href={`/gazette/${day}`} className="text-(--color-paper-dim) hover:text-(--color-paper)">
                  {longDate(day)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="mt-12 border-t border-(--color-rule) pt-6 text-[11px] leading-relaxed text-(--color-paper-faint)">{C.footer}</footer>
    </main>
  );
}
