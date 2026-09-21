import Link from 'next/link';
import { DECISIONS, statusOf } from '@/lib/docs/decisions';
import { DOCUMENTS, documentsLine } from '@/lib/copy/documents';

export const dynamic = 'force-dynamic';
export const metadata = { title: DOCUMENTS.decisions.title, description: DOCUMENTS.decisions.description };

const C = DOCUMENTS.decisions;

/**
 * The decisions the blueprint asks to be written down before a pilot, as
 * proposals: what is proposed, why, what the prototype already does, and
 * what stays open. A record is proposed until a named person decides it —
 * the status line of each says who and when — and this page does not
 * decide for them; the decisions so far are carried in the registry, not
 * inferred here.
 */
export default function DecisionsIndex() {
  const count = (s: string) => DECISIONS.filter((d) => statusOf(d) === s).length;
  const partly = count('partly decided');
  return (
    <main className="mx-auto max-w-5xl px-6 py-12 sm:py-16">
      <header className="mb-8">
        <div className="kicker">
          <b>{DOCUMENTS.mechanism.kicker}</b> ·{' '}
          <Link href="/mechanism" className="hover:text-(--color-paper)">
            {DOCUMENTS.mechanism.title}
          </Link>{' '}
          · {C.kicker}
        </div>
        <h1 className="display mt-4 max-w-3xl text-4xl text-(--color-paper) sm:text-5xl">{C.headline}</h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-(--color-paper-dim)">
          {documentsLine(C.sub, { records: DECISIONS.length, proposed: count('proposed'), decided: count('decided') })}
          {partly > 0 ? ` ${partly} partly decided.` : ''}
        </p>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-(--color-paper-faint)">{C.what}</p>
      </header>
      <ol className="cells grid-cols-1 md:grid-cols-2">
        {DECISIONS.map((d, i) => (
          <li key={d.slug} className="cell p-6 sm:p-8">
            <div className="kicker">
              <span className="tabular text-(--color-accent)">{String(i + 1).padStart(2, '0')}</span> · {d.backlog} · {statusOf(d)}
            </div>
            <h2 className="display mt-2 text-2xl text-(--color-paper)">
              <Link href={`/mechanism/decisions/${d.slug}`} className="hover:text-(--color-accent)">
                {d.title}
              </Link>
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-(--color-paper-dim)">{d.asks}.</p>
          </li>
        ))}
      </ol>
    </main>
  );
}
