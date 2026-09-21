import { promises as fs } from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import { resolveRecordLinks } from '@/lib/docs/decisions';
import { parseMarkdown, type Block } from '@/lib/docs/markdown';
import { FoldedDocument } from '../../components/markdown-view';
import { DOCUMENTS } from '@/lib/copy/documents';

export const dynamic = 'force-dynamic';
export const metadata = { title: DOCUMENTS.status.title, description: DOCUMENTS.status.description };

/**
 * docs/STATUS.md, rendered from the file: the mechanism's §17 status table,
 * moved to its own page on 21 September 2026 so the mechanism reads as the
 * design and this page as the inventory. The file is shown whole — the table
 * is the page — for the same reason the mechanism and the doctrine are.
 */

const DOC = path.join(/*turbopackIgnore: true*/ process.cwd(), 'docs', 'STATUS.md');

export default async function StatusPage() {
  let blocks: Block[] | null = null;
  let fault: string | null = null;
  try {
    blocks = parseMarkdown(resolveRecordLinks(await fs.readFile(DOC, 'utf8')));
  } catch (cause) {
    fault = cause instanceof Error ? cause.message : 'unknown failure';
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 sm:py-16">
      <header className="mb-6">
        <div className="kicker">
          <b>{DOCUMENTS.mechanism.kicker}</b> ·{' '}
          <Link href="/mechanism" className="hover:text-(--color-paper)">
            {DOCUMENTS.mechanism.title}
          </Link>{' '}
          · {DOCUMENTS.status.kicker}
        </div>
        <h1 className="display mt-4 max-w-3xl text-4xl text-(--color-paper) sm:text-5xl">{DOCUMENTS.status.headline}</h1>
      </header>

      {fault !== null || blocks === null ? (
        <p className="mt-8 text-base leading-relaxed" style={{ color: 'var(--color-state-stale)' }}>
          {DOCUMENTS.unread} <span className="text-(--color-paper-faint)">({fault ?? 'no content'})</span>
        </p>
      ) : (
        <FoldedDocument blocks={blocks} />
      )}
    </main>
  );
}
