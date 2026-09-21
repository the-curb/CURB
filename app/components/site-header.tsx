import Link from 'next/link';
import { BRAND } from '@/lib/brand';
import { Mark } from './mark';
import { ThemeToggle } from './theme-toggle';

/**
 * The masthead. A folio strip — where the desk sits, and the ink switch —
 * over the title row: the mark in the second ink, the name in the serif,
 * and the sections as a ruled run of small capitals, in the order a reader
 * uses them: the prices first, the product that is not live yet after the
 * things that are. The mechanism and the doctrine are one click further, from
 * the footer and from the pages that cite them. Under it the paper's
 * rule, a hairline over a heavy line. It stays at the top; the sheet scrolls
 * beneath it. On a narrow screen the sections become a third row that
 * scrolls sideways rather than a menu that hides them.
 */
const SECTIONS: ReadonlyArray<readonly [string, string]> = [
  ['The Floor', '/floor'],
  ['Registry', '/registry'],
  ['Gazette', '/gazette'],
  ['Services', '/services'],
  ['Positions', '/positions'],
  ['How to use it', '/guide'],
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 bg-(--color-ink)">
      <div className="masthead-rule">
        <div className="tabular flex h-7 items-center justify-between gap-4 border-b border-(--color-rule) px-4 text-[10px] uppercase tracking-[0.2em] text-(--color-paper-faint)">
          <span className="truncate">A desk on Robinhood Chain</span>
          <span className="flex items-center gap-4">
            <a href={BRAND.links.x} className="hidden hover:text-(--color-paper) sm:inline" target="_blank" rel="noopener noreferrer" aria-label={`${BRAND.name} on X, ${BRAND.links.xHandle}`}>
              X · {BRAND.links.xHandle}
            </a>
            <a href={BRAND.links.github} className="hidden hover:text-(--color-paper) sm:inline" target="_blank" rel="noopener noreferrer" aria-label="Source on GitHub">
              GitHub
            </a>
            <ThemeToggle />
          </span>
        </div>

        <div className="flex h-12 items-center gap-5 px-4 sm:h-14">
          <Link href="/" className="flex items-center gap-3 text-(--color-paper)" aria-label={`${BRAND.name} home`}>
            <Mark size={26} className="text-(--color-accent)" />
            <span className="display whitespace-nowrap text-[1.2rem] tracking-[0.22em] sm:text-[1.4rem]">{BRAND.name}</span>
          </Link>
          <span className="hidden whitespace-nowrap text-[13px] text-(--color-paper-faint) xl:inline">{BRAND.descriptor}</span>

          <nav className="ml-auto hidden h-full items-stretch lg:flex" aria-label="Sections">
            {SECTIONS.map(([label, href]) => (
              <Link
                key={href}
                href={href}
                className="tabular flex items-center whitespace-nowrap border-l border-(--color-rule) px-4 text-[11px] uppercase tracking-[0.16em] text-(--color-paper-dim) hover:text-(--color-paper)"
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>

        <nav className="scrollrow flex h-9 items-stretch overflow-x-auto border-t border-(--color-rule) lg:hidden" aria-label="Sections">
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
