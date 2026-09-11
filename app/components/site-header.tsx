import Link from 'next/link';
import { BRAND } from '@/lib/brand';
import { Mark } from './mark';
import { ThemeToggle } from './theme-toggle';

/**
 * The header: one ruled strip of cells, fixed at the top. The mark, the
 * wordmark, a two-by-two of the districts, two wide cells for the paper and
 * the rules, and the half-moon. On a narrow screen the strip wraps into two
 * rows of cells rather than collapsing into a menu; the grid is the identity.
 */
const DISTRICT_LINKS: ReadonlyArray<readonly [string, string]> = [
  ['The Floor', '/floor'],
  ['The Registry', '/registry'],
  ['The Vault', '/vault'],
  ['Chambers', '/chambers'],
];

export function SiteHeader() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-4 sm:pt-4">
      <div className="cells grid-cols-[auto_1fr_auto] sm:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto_auto]">
        <Link href="/" className="cell flex items-center justify-center px-4 py-3 text-[--color-paper]" aria-label={`${BRAND.name} home`}>
          <Mark size={28} />
        </Link>
        <Link href="/" className="cell flex items-center px-4 py-3">
          <span className="tracking-mark text-sm font-medium text-[--color-paper] sm:text-lg">{BRAND.name}</span>
        </Link>

        <nav className="cell hidden sm:grid" aria-label="Districts">
          <div className="grid h-full grid-cols-2 gap-px bg-[--color-rule]">
            {DISTRICT_LINKS.map(([label, href]) => (
              <Link key={href} href={href} className="cell flex items-center justify-center px-4 py-2 text-[13px] text-[--color-paper-dim] hover:text-[--color-paper]">
                {label}
              </Link>
            ))}
          </div>
        </nav>
        <Link href="/gazette" className="cell hidden items-center justify-center px-5 text-center text-[13px] leading-snug text-[--color-paper-dim] hover:text-[--color-paper] sm:flex">
          The Curb
          <br />
          Gazette
        </Link>
        <Link href="/doctrine" className="cell hidden items-center justify-center px-5 text-[13px] text-[--color-paper-dim] hover:text-[--color-paper] sm:flex">
          Doctrine
        </Link>
        <div className="cell flex items-center justify-center px-3 text-[--color-paper]">
          <ThemeToggle />
        </div>

        {/* Narrow screens: the districts as a second ruled row. */}
        <nav className="cell col-span-3 grid grid-cols-3 gap-px bg-[--color-rule] sm:hidden" aria-label="Sections">
          {[...DISTRICT_LINKS, ['Gazette', '/gazette'] as const, ['Doctrine', '/doctrine'] as const].map(([label, href]) => (
            <Link key={href} href={href} className="cell flex items-center justify-center px-2 py-2 text-[11px] text-[--color-paper-dim]">
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
