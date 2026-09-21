import Link from 'next/link';
import { BRAND } from '@/lib/brand';
import { AGENT_COUNTS } from '@/lib/agents/registry';
import { FOOTER, footerLine } from '@/lib/copy/footer';
import { Mark } from './mark';

const LINKS: ReadonlyArray<readonly [string, string]> = [
  ...FOOTER.links,
  [FOOTER.github, BRAND.links.github],
  [`X · ${BRAND.links.xHandle}`, BRAND.links.x],
];

/** The descriptor the header carries, as two lines: the second set in italic. */
const [LEAD, EMPHASIS] = BRAND.descriptor.split(/(?<=\.)\s+/);

/**
 * The colophon. A heavy rule, then three columns: what the desk does, the
 * mark and what is not live, and every destination as a ruled list — two
 * across on a phone, so the list is half as tall. The folio line closes the
 * sheet.
 */
export function SiteFooter() {
  return (
    <footer className="mt-4 px-3 pb-4 sm:px-4">
      <div className="border-t-[3px] border-(--color-paper)">
        <div className="cells !border-t-0 grid-cols-1 md:grid-cols-[minmax(0,5fr)_minmax(0,4fr)_minmax(0,3fr)]">
          <div className="cell p-6 sm:p-8">
            <p className="display text-2xl leading-tight text-(--color-paper) sm:text-4xl">
              {LEAD}
              <br />
              <em className="text-(--color-paper-dim)">{EMPHASIS}</em>
            </p>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-(--color-paper-dim)">{footerLine(FOOTER.about, AGENT_COUNTS.total)}</p>
            <p className="mt-3 max-w-md text-[13px] leading-relaxed text-(--color-paper-faint)">{FOOTER.refuses}</p>
          </div>
          <div className="cell p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <Mark size={30} className="text-(--color-accent)" />
              <span className="display text-xl tracking-[0.22em] text-(--color-paper)">{BRAND.name}</span>
            </div>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-(--color-paper-dim)">{BRAND.desk.line}</p>
            <ul className="mt-4 max-w-md space-y-2 text-[13px] leading-relaxed text-(--color-paper-faint)">
              {FOOTER.facts.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <div className="cell">
            <ul className="grid grid-cols-2 md:grid-cols-1">
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
        <span>{FOOTER.folio}</span>
      </p>
    </footer>
  );
}
