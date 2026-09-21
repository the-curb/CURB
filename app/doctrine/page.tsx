import { promises as fs } from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import { RULE_COUNT } from '@/lib/doctrine/policy';
import { AGENT_COUNTS } from '@/lib/agents/registry';
import { parseMarkdown, type Block } from '@/lib/docs/markdown';
import { FoldedDocument } from '../components/markdown-view';
import { HashOpener } from '../components/hash-opener';
import { DOCUMENTS, documentsLine } from '@/lib/copy/documents';

export const dynamic = 'force-dynamic';
export const metadata = { title: DOCUMENTS.doctrine.title, description: DOCUMENTS.doctrine.description };

/**
 * DOCTRINE.md, rendered from the file. The document names the file that
 * enforces each rule, and this page shows the document rather than a copy of
 * it, so what the site says the rules are cannot drift from what they are.
 * If the file cannot be read, the page says so; it does not fall back to a
 * summary written by hand. Each section is folded under its own heading.
 */

const DOC = path.join(/*turbopackIgnore: true*/ process.cwd(), 'DOCTRINE.md');
const C = DOCUMENTS.doctrine;

export default async function DoctrinePage() {
  let blocks: Block[] | null = null;
  let fault: string | null = null;
  try {
    blocks = parseMarkdown(await fs.readFile(DOC, 'utf8'));
  } catch (cause) {
    fault = cause instanceof Error ? cause.message : 'unknown failure';
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 sm:py-16">
      <header className="mb-6">
        <div className="kicker">
          <b>{C.kicker}</b> · {C.title}
        </div>
        <h1 className="display mt-4 max-w-3xl text-4xl text-(--color-paper) sm:text-5xl">{C.headline}</h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-(--color-paper-dim)">
          {C.sub} {DOCUMENTS.open}
        </p>
        <p className="tabular mt-3 text-[12px] text-(--color-paper-faint)">
          {documentsLine(C.counts, { rules: RULE_COUNT, measure: AGENT_COUNTS.measure, promote: AGENT_COUNTS.promote })}
        </p>
        <p className="mt-3 text-sm text-(--color-paper-dim)">
          <Link href="/mechanism" className="underline decoration-(--color-accent) underline-offset-4 hover:text-(--color-paper)">
            {C.mechanism}
          </Link>
        </p>
      </header>

      {fault !== null || blocks === null ? (
        <p className="mt-8 text-base leading-relaxed" style={{ color: 'var(--color-state-stale)' }}>
          {DOCUMENTS.unread} <span className="text-(--color-paper-faint)">({fault ?? 'no content'})</span>
        </p>
      ) : (
        <>
          <HashOpener />
          <FoldedDocument blocks={blocks} />
        </>
      )}
    </main>
  );
}
