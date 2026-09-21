import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { HOME, homeSentences } from '../lib/copy/home.ts';
import { FLOOR, floorSentences } from '../lib/copy/floor.ts';
import { GUIDE, guideSentences } from '../lib/copy/guide.ts';
import { SERVICES_COPY, servicesSentences } from '../lib/copy/services.ts';
import { FOOTER, footerSentences } from '../lib/copy/footer.ts';
import { REGISTRY, registrySentences } from '../lib/copy/registry.ts';
import { VAULT, vaultSentences } from '../lib/copy/vault.ts';

/**
 * The owner's rule, 21 September 2026: the site does not keep telling a reader
 * it is free. It asks for nothing — no wallet, no account, no price — and lets
 * that speak for itself, the way any product a reader simply uses does. "Free"
 * said on every page read like a pitch, and a pitch is the one voice this desk
 * does not have.
 *
 * The paid-mode lines are exempt: if the desk ever charges, saying so plainly
 * is the honest thing. Everything a reader sees in the mode that runs is held
 * to it.
 */

const ANNOUNCES_FREE = /\bfree\b|\bgratis\b|costs? nothing|no cost\b|not charged|nothing is charged|at no charge|without charge/i;

const running = (): Record<string, string[]> => ({
  home: [HOME.headline.line, HOME.headline.emphasis, HOME.subhead, ...homeSentences()],
  floor: [FLOOR.headline, FLOOR.sub, ...floorSentences()],
  guide: [GUIDE.headline, ...guideSentences().filter((s) => !GUIDE.alerts.paid.includes(s))],
  services: [SERVICES_COPY.headline.FREE, SERVICES_COPY.sub.FREE, SERVICES_COPY.machinery.summary.FREE, ...servicesSentences().filter((s) => !SERVICES_COPY.alerts.paid.includes(s))],
  footer: footerSentences(),
  registry: [REGISTRY.headline, ...registrySentences()],
  vault: [VAULT.headline, ...vaultSentences()],
});

describe('the site does not keep announcing that it is free', () => {
  for (const [page, lines] of Object.entries(running())) {
    it(`${page} asks for nothing without saying so`, () => {
      const hits = lines.filter((l) => ANNOUNCES_FREE.test(l));
      assert.deepEqual(hits, [], hits.join(' | '));
    });
  }

  it('prints no "free" badge or chip in the page markup either', () => {
    for (const file of ['app/page.tsx', 'app/guide/page.tsx', 'app/services/page.tsx', 'app/floor/page.tsx', 'app/registry/page.tsx', 'app/vault/page.tsx', 'app/components/site-footer.tsx', 'app/components/site-header.tsx', 'app/agents/page.tsx', 'app/agents/[id]/page.tsx', 'app/chambers/page.tsx', 'app/positions/page.tsx', 'app/positions/[series]/page.tsx', 'app/mechanism/page.tsx', 'app/doctrine/page.tsx', 'app/gazette/page.tsx', 'app/gazette/[day]/page.tsx']) {
      let source: string;
      try {
        source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      } catch {
        continue;
      }
      const jsxText = source.match(/>[^<>{}]*</g) ?? [];
      const hits = jsxText.filter((t) => ANNOUNCES_FREE.test(t));
      assert.deepEqual(hits, [], `${file}: ${hits.join(' | ')}`);
    }
  });
});
