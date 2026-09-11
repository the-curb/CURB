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
 * The footer: the thesis set large over a striped ground, the mark and what
 * the system will not do, and every destination as a ruled cell.
 */
export function SiteFooter() {
  return (
    <footer className="px-3 pb-3 sm:px-4 sm:pb-4">
      <div className="cells grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="cell stripes relative overflow-hidden p-6 sm:p-8">
          <p className="display relative text-2xl text-[--color-paper] sm:text-[clamp(1.5rem,2.6vw,2.25rem)]">
            the ticker tells you the exposure.
            <br />
            the curb tells you the <em className="not-italic underline decoration-1 underline-offset-8">conditions</em>.
          </p>
        </div>
        <div className="cell p-6 sm:p-8">
          <p className="max-w-md text-base leading-relaxed text-[--color-paper-dim]">
            Whether you hold a stock token or are only reading about one, the number you are shown
            has an age, a source, and a set of conditions around it. This paper prints all three, and
            says when it could not.
          </p>
        </div>

        <div className="cell p-6 sm:p-8">
          <div className="flex items-center gap-3 text-[--color-paper]">
            <Mark size={32} />
            <span className="tracking-mark text-xl font-medium">{BRAND.name}</span>
          </div>
          <p className="mt-5 max-w-md text-sm leading-relaxed text-[--color-paper-dim]">
            Nine agents read Robinhood Chain and two published registries on a schedule, publish what
            they measured with a source and a time on every figure, and refuse — in code, not in a
            prompt — to forecast, advise, rate, or print a number they did not read. It places no
            orders, holds no token, sells nothing, and states no price for a token no feed prices.
          </p>
        </div>
        <div className="cells grid-cols-2 !border-0 sm:grid-cols-3">
          {LINKS.map(([label, href]) => (
            <Link
              key={href}
              href={href}
              className="cell flex items-center px-5 py-6 text-[13px] text-[--color-paper-dim] hover:text-[--color-paper]"
              {...(href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            >
              {label}
            </Link>
          ))}
        </div>
      </div>
      <p className="mt-3 px-1 text-[11px] text-[--color-paper-faint]">
        {BRAND.paper.name} · {BRAND.paper.cadence} · MIT.
      </p>
    </footer>
  );
}
