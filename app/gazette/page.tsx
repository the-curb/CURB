import Link from 'next/link';
import { BRAND } from '@/lib/brand';
import { composeEdition, utcDay } from '@/lib/gazette/edition';
import { getStoreAsync } from '@/lib/store';

export const dynamic = 'force-dynamic';

export const metadata = { title: BRAND.paper.name };

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
          The archive could not be read ({daysRead.reason}). No editions are listed, and none
          should be inferred from that.
        </p>
      </main>
    );
  }

  // Today is always listed, even before anything has been filed: a live edition
  // with nothing in it yet is a different thing from a day that never happened.
  const days = daysRead.value.includes(today) ? daysRead.value : [today, ...daysRead.value];

  const editions = await Promise.all(
    days.map(async (day) => {
      const record = await store.dayRecord(day);
      return record.state === 'UNREAD'
        ? { day, edition: null, reason: record.reason }
        : { day, edition: composeEdition(record.value, now), reason: null };
    }),
  );

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
      <nav className="mb-8 text-[11px] uppercase tracking-[0.16em] text-[--color-paper-faint]">
        <Link href="/" className="hover:text-[--color-paper]">
          ‹ {BRAND.name}
        </Link>
      </nav>

      <header className="mb-10">
        <div className="border-t-2 border-[--color-paper]" />
        <div className="py-6 text-center">
          <h1
            className="text-4xl tracking-[0.18em] text-[--color-paper] sm:text-6xl"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {BRAND.paper.name.toUpperCase()}
          </h1>
          <p className="mt-3 text-[10px] uppercase tracking-[0.2em] text-[--color-paper-faint]">
            {BRAND.paper.cadence} · The agents are the reporters.
          </p>
        </div>
        <div className="border-t-2 border-[--color-paper]" />
      </header>

      <ol className="space-y-0">
        {editions.map(({ day, edition, reason }) => (
          <li key={day} className="border-t border-[--color-rule] py-6 first:border-t-0">
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-[10px] uppercase tracking-[0.18em] text-[--color-paper-faint]">
              <span>{longDate(day)}</span>
              <span>{day === today ? 'Live edition' : 'Edition'}</span>
            </div>
            {edition === null ? (
              <p className="text-sm" style={{ color: 'var(--color-state-stale)' }}>
                This day&apos;s record could not be read ({reason}).
              </p>
            ) : (
              <>
                <Link href={`/gazette/${day}`} className="group block">
                  <h2
                    className="text-2xl leading-tight text-[--color-paper] group-hover:text-[--color-brass] sm:text-3xl"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {edition.headline}
                  </h2>
                </Link>
                <p className="mt-2 text-sm leading-relaxed text-[--color-paper-dim]">
                  {edition.standfirst}
                </p>
                <Link
                  href={`/gazette/${day}`}
                  className="mt-3 inline-block text-[11px] uppercase tracking-[0.16em] text-[--color-paper-faint] hover:text-[--color-paper]"
                >
                  Read the edition ›
                </Link>
              </>
            )}
          </li>
        ))}
      </ol>

      <footer className="mt-12 border-t border-[--color-rule] pt-6 text-[11px] leading-relaxed text-[--color-paper-faint]">
        Every edition is composed from that day&apos;s record and adds nothing to it. What was not
        read is printed beside what was. Nothing here is investment, legal or tax advice.
      </footer>
    </main>
  );
}
