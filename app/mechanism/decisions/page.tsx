import Link from 'next/link';
import { DECISIONS, statusOf } from '@/lib/docs/decisions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Decision records' };

/**
 * The decisions the blueprint asks to be written down before a pilot, as
 * proposals: what is proposed, why, what the prototype already does, and
 * what stays open. A record is proposed until a named person decides it —
 * the status line of each says who and when — and this page does not
 * decide for them; the decision so far (the token record, by the product
 * owner) is carried in the registry, not inferred here.
 */
export default function DecisionsIndex() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-12 sm:py-16">
      <header className="mb-8">
        <div className="kicker">
          <b>The position</b> · <Link href="/mechanism" className="hover:text-(--color-paper)">Mechanism</Link> · decision records
        </div>
        <h1 className="display mt-4 max-w-3xl text-4xl text-(--color-paper) sm:text-5xl">What has to be decided, written down before anyone decides it.</h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-(--color-paper-dim)">
          Fourteen records, thirteen <span className="text-(--color-paper)">proposed</span> and one <span className="text-(--color-paper)">decided</span>: the design choices the blueprint asks for (R03, R05, R06), the operator policy (O01), the runbook (O03), the cost comparison with its measured inputs (B01), the deployment plan (G02), the assumption register that says what is assumed while no one has decided, a self-review that is not a review (C09), the interview guide that is ready to run (R04, B02), and the token's one function with its prices, conversion, terms and proceeds (§16) — decided by the product owner on 12 September 2026, with only the launch chain still open. Each says what the prototype already does and what stays open. They are files in the repository, read at request time.
        </p>
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
