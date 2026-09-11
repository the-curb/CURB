import Link from 'next/link';
import { BRAND } from '@/lib/brand';
import { Mark } from './mark';

const LINKS: ReadonlyArray<readonly [string, string]> = [
  ['The Floor', '/floor'],
  ['The Registry', '/registry'],
  ['The Vault', '/vault'],
  ['Chambers', '/chambers'],
  ['The Curb Gazette', '/gazette'],
  ['Doctrine', '/doctrine'],
  ['The agents', '/agents'],
  ['State, as data', '/api/state'],
  ['Source on GitHub', 'https://github.com/the-curb/CURB'],
];

/**
 * The colophon. A heavy rule, then three columns: the thesis in the serif,
 * the mark and what the desk will not do, and every destination as a ruled
 * list. The folio line closes the sheet.
 */
export function SiteFooter() {
  return (
    <footer className="mt-4 px-3 pb-4 sm:px-4">
      <div className="border-t-[3px] border-(--color-paper)">
        <div className="cells !border-t-0 grid-cols-1 md:grid-cols-[minmax(0,5fr)_minmax(0,4fr)_minmax(0,3fr)]">
          <div className="cell p-6 sm:p-8">
            <p className="display text-3xl leading-tight text-(--color-paper) sm:text-4xl">
              The ticker tells you the exposure.
              <br />
              <em className="text-(--color-paper-dim)">The Curb tells you the conditions.</em>
            </p>
            <p className="mt-6 max-w-md text-base leading-relaxed text-(--color-paper-dim)">
              Whether you hold a stock token or are only reading about one, the number you are shown has an age, a source, and
              a set of conditions around it. This paper prints all three, and says when it could not.
            </p>
          </div>
          <div className="cell p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <Mark size={30} className="text-(--color-accent)" />
              <span className="display text-xl tracking-[0.22em] text-(--color-paper)">{BRAND.name}</span>
            </div>
            <p className="mt-5 max-w-md text-sm leading-relaxed text-(--color-paper-dim)">
              Nine agents read Robinhood Chain and two published registries on a schedule, publish what they measured with a
              source and a time on every figure, and refuse — in code, not in a prompt — to forecast, advise, rate, or print a
              number they did not read. It places no orders, holds no token, sells nothing, and states no price for a token no
              feed prices.
            </p>
          </div>
          <div className="cell">
            <ul>
              {LINKS.map(([label, href]) => (
                <li key={href} className="border-b border-(--color-rule) last:border-b-0">
                  <Link
                    href={href}
                    className="tabular flex items-center justify-between px-5 py-3 text-[11px] uppercase tracking-[0.16em] text-(--color-paper-dim) hover:text-(--color-paper)"
                    {...(href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  >
                    <span>{label}</span>
                    <span aria-hidden="true" className="text-(--color-accent)">
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      <p className="tabular mt-3 flex flex-wrap justify-between gap-x-6 gap-y-1 px-1 text-[10px] uppercase tracking-[0.18em] text-(--color-paper-faint)">
        <span>
          {BRAND.paper.name} · {BRAND.paper.cadence}
        </span>
        <span>Printed from the record · MIT</span>
      </p>
    </footer>
  );
}
