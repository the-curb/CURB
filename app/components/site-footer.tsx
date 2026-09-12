import Link from 'next/link';
import { BRAND } from '@/lib/brand';
import { Mark } from './mark';

const LINKS: ReadonlyArray<readonly [string, string]> = [
  ['Positions', '/positions'],
  ['Mechanism', '/mechanism'],
  ['The Floor', '/floor'],
  ['The Registry', '/registry'],
  ['The Vault', '/vault'],
  ['Chambers', '/chambers'],
  ['The Curb Gazette', '/gazette'],
  ['Services', '/services'],
  ['Doctrine', '/doctrine'],
  ['The agents', '/agents'],
  ['State, as data', '/api/state'],
  ['Source on GitHub', 'https://github.com/the-curb/CURB'],
];

/**
 * The colophon. A heavy rule, then three columns: the thesis and the stage,
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
              One company. Multiple issuers.
              <br />
              <em className="text-(--color-paper-dim)">One position.</em>
            </p>
            <p className="mt-6 max-w-md text-base leading-relaxed text-(--color-paper-dim)">
              {BRAND.name} began with a question about how share exposure is formed on a blockchain. A symbol names the company;
              the issuer and its contract decide how that exposure is actually held. We are building a company position that
              combines several stock-token issuers, discloses its components, and records a holder’s rights when the position is
              formed and when it is unwound.
            </p>
            <p className="mt-3 max-w-md text-[13px] leading-relaxed text-(--color-paper-faint)">{BRAND.stage}</p>
          </div>
          <div className="cell p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <Mark size={30} className="text-(--color-accent)" />
              <span className="display text-xl tracking-[0.22em] text-(--color-paper)">{BRAND.name}</span>
            </div>
            <p className="mt-5 max-w-md text-sm leading-relaxed text-(--color-paper-dim)">
              The product is at the design and testing stage. The risk of the share, of each issuer and of each contract remains,
              and the ability to withdraw a component follows the state and terms of that instrument. No receipt is one share, no
              exit is a cash redemption, and no CURB token is a condition of any of it.
            </p>
            <p className="mt-3 max-w-md text-[13px] leading-relaxed text-(--color-paper-faint)">
              Beneath it, a desk of nine agents reads Robinhood Chain and two published registries on a schedule, publishes what
              it measured with a source and a time on every figure, and refuses — in code, not in a prompt — to forecast, advise,
              rate, or print a number it did not read. {BRAND.desk.line}
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
        <span>Design under test · printed from the record · MIT</span>
      </p>
    </footer>
  );
}
