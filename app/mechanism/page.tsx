import { promises as fs } from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import { DECISIONS, resolveRecordLinks, statusOf } from '@/lib/docs/decisions';
import { APPLE_S1, GATES } from '@/lib/positions/series';
import { parseMarkdown, type Block } from '@/lib/docs/markdown';
import { FoldedDocument } from '../components/markdown-view';
import { HashOpener } from '../components/hash-opener';
import { DOCUMENTS, documentsLine } from '@/lib/copy/documents';

export const dynamic = 'force-dynamic';
export const metadata = { title: DOCUMENTS.mechanism.title, description: DOCUMENTS.mechanism.description };

/**
 * MECHANISM.md, rendered from the file — the position product's blueprint:
 * the decision, the ledger, the statuses a component has, who can touch
 * what, and the gates a real-asset pilot has to pass. The page shows the
 * document, not a summary of it, for the same reason the doctrine does; each
 * section is folded under its own heading so the document's shape comes
 * first, and a link to a section opens it.
 */

const DOC = path.join(/*turbopackIgnore: true*/ process.cwd(), 'MECHANISM.md');
const C = DOCUMENTS.mechanism;
const linkClass = 'text-(--color-paper) underline decoration-(--color-accent) underline-offset-4 hover:text-(--color-accent)';

export default async function MechanismPage() {
  let blocks: Block[] | null = null;
  let fault: string | null = null;
  try {
    blocks = parseMarkdown(resolveRecordLinks(await fs.readFile(DOC, 'utf8')));
  } catch (cause) {
    fault = cause instanceof Error ? cause.message : 'unknown failure';
  }
  const passed = GATES.filter((g) => g.status === 'PASSED').length;
  const count = (s: string) => DECISIONS.filter((d) => statusOf(d) === s).length;
  const partly = count('partly decided');

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 sm:py-16">
      <header className="mb-6">
        <div className="kicker">
          <b>{C.kicker}</b> · {C.title}
        </div>
        <h1 className="display mt-4 max-w-3xl text-4xl text-(--color-paper) sm:text-5xl">{C.headline}</h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-(--color-paper-dim)">{DOCUMENTS.open}</p>
        <p className="tabular mt-3 text-[12px] text-(--color-paper-faint)">
          {documentsLine(C.status, { passed, total: GATES.length, records: DECISIONS.length, proposed: count('proposed'), decided: count('decided') })}
          {partly > 0 ? ` · ${partly} partly decided` : ''}
          {' · '}
          {APPLE_S1.name}
        </p>
        <p className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link href={`/positions/${APPLE_S1.id}`} className={linkClass}>
            {C.simulation}
          </Link>
          <Link href="/mechanism/decisions" className={linkClass}>
            {C.decisions}
          </Link>
          <Link href="/mechanism/status" className={linkClass}>
            {C.exists}
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
