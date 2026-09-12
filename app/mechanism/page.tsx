import { promises as fs } from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import { APPLE_S1, GATES } from '@/lib/positions/series';
import { parseMarkdown, type Block } from '@/lib/docs/markdown';
import { BlockView, Contents } from '../components/markdown-view';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Mechanism' };

/**
 * MECHANISM.md, rendered from the file — the position product's blueprint:
 * the decision, the ledger, the statuses a component has, who can touch
 * what, and the gates a real-asset pilot has to pass. The page shows the
 * document, not a summary of it, for the same reason the doctrine does.
 */

const DOC = path.join(/*turbopackIgnore: true*/ process.cwd(), 'MECHANISM.md');

export default async function MechanismPage() {
  let blocks: Block[] | null = null;
  let fault: string | null = null;
  try {
    blocks = parseMarkdown(await fs.readFile(DOC, 'utf8'));
  } catch (cause) {
    fault = cause instanceof Error ? cause.message : 'unknown failure';
  }
  const sections = blocks?.filter((b): b is Extract<Block, { kind: 'heading' }> => b.kind === 'heading' && b.level === 2) ?? [];
  const passed = GATES.filter((g) => g.status === 'PASSED').length;

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 sm:py-16">
      <header className="mb-6">
        <div className="kicker">
          <b>The position</b> · Mechanism v1
        </div>
        <h1 className="display mt-4 max-w-3xl text-4xl text-(--color-paper) sm:text-5xl">
          One company. Multiple issuers. One position. How it would work, and what has to be true first.
        </h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-(--color-paper-dim)">
          {APPLE_S1.stageLine} {passed} of {GATES.length} gates before real assets have passed. This page is the
          document itself, read from the repository at request time. The arithmetic in §7 runs in the{' '}
          <Link href={`/positions/${APPLE_S1.id}`} className="text-(--color-paper) underline decoration-(--color-accent) underline-offset-4 hover:text-(--color-accent)">
            simulation
          </Link>
          . The choices it asks to be written down are{' '}
          <Link href="/mechanism/decisions" className="text-(--color-paper) underline decoration-(--color-accent) underline-offset-4 hover:text-(--color-accent)">
            decision records
          </Link>
          , all proposed and none decided.
        </p>
      </header>

      {fault !== null || blocks === null ? (
        <p className="mt-8 text-base leading-relaxed" style={{ color: 'var(--color-state-stale)' }}>
          The mechanism file could not be read ({fault ?? 'no content'}). Nothing is shown in its place.
        </p>
      ) : (
        <>
          <Contents sections={sections} />
          <article>
            {blocks.map((block, i) => (
              <BlockView key={i} block={block} />
            ))}
          </article>
        </>
      )}
    </main>
  );
}
