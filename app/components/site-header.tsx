import Link from 'next/link';
import { BRAND } from '@/lib/brand';
import { Mark } from './mark';
import { ThemeToggle } from './theme-toggle';

/**
 * The masthead. A folio strip — where the desk sits, and the ink switch —
 * over the title row: the mark in the second ink, the name in the serif,
 * and the sections as a ruled run of small capitals. Under it the paper's
 * rule, a hairline over a heavy line. It stays at the top; the sheet scrolls
 * beneath it. On a narrow screen the sections become a third row that
 * scrolls sideways rather than a menu that hides them.
 */
const SECTIONS: ReadonlyArray<readonly [string, string]> = [
  ['The Floor', '/floor'],
  ['The Registry', '/registry'],
  ['The Vault', '/vault'],
  ['Chambers', '/chambers'],
  ['Gazette', '/gazette'],
  ['Doctrine', '/doctrine'],
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 bg-(--color-ink)">
      <div className="masthead-rule">
        <div className="tabular flex h-7 items-center justify-between gap-4 border-b border-(--color-rule) px-4 text-[10px] uppercase tracking-[0.2em] text-(--color-paper-faint)">
          <span className="truncate">A desk on Robinhood Chain · 4663</span>
          <ThemeToggle />
        </div>

        <div className="flex h-12 items-center gap-5 px-4 sm:h-14">
          <Link href="/" className="flex items-center gap-3 text-(--color-paper)" aria-label={`${BRAND.name} home`}>
            <Mark size={26} className="text-(--color-accent)" />
            <span className="display text-[1.55rem] tracking-[0.1em] sm:text-[1.8rem]">{BRAND.name}</span>
          </Link>
          <span className="display hidden text-lg italic text-(--color-paper-faint) lg:inline">{BRAND.descriptor}</span>

          <nav className="ml-auto hidden h-full items-stretch sm:flex" aria-label="Sections">
            {SECTIONS.map(([label, href]) => (
              <Link
                key={href}
                href={href}
                className="tabular flex items-center border-l border-(--color-rule) px-4 text-[11px] uppercase tracking-[0.16em] text-(--color-paper-dim) hover:text-(--color-paper)"
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>

        <nav className="scrollrow flex h-9 items-stretch overflow-x-auto border-t border-(--color-rule) sm:hidden" aria-label="Sections">
          {SECTIONS.map(([label, href]) => (
            <Link
              key={href}
              href={href}
              className="tabular flex shrink-0 items-center border-r border-(--color-rule) px-4 text-[11px] uppercase tracking-[0.14em] text-(--color-paper-dim)"
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
