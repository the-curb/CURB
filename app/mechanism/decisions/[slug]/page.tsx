import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DECISIONS, decisionBySlug, readDecision, resolveRecordLinks, statusOf } from '@/lib/docs/decisions';
import { parseMarkdown } from '@/lib/docs/markdown';
import { FoldedDocument } from '../../../components/markdown-view';
import { HashOpener } from '../../../components/hash-opener';
import { DOCUMENTS } from '@/lib/copy/documents';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const record = decisionBySlug(slug);
  return { title: record ? record.title : DOCUMENTS.decisions.title };
}

/**
 * One decision record, read from its file. The title the file opens with is
 * printed in the header — the document view leaves a first-level heading to
 * the page — and each section is folded under its own heading. A link to
 * another record by its file name becomes a link to its page.
 */
export default async function DecisionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const record = decisionBySlug(slug);
  if (record === null) notFound();
  const { source, fault } = await readDecision(record);
  const blocks = source === null ? null : parseMarkdown(resolveRecordLinks(source));
  const index = DECISIONS.findIndex((d) => d.slug === record.slug);
  const previous = DECISIONS[index - 1] ?? null;
  const next = DECISIONS[index + 1] ?? null;

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 sm:py-16">
      <header className="mb-6">
        <div className="kicker">
          <b>{DOCUMENTS.mechanism.kicker}</b> ·{' '}
          <Link href="/mechanism" className="hover:text-(--color-paper)">
            {DOCUMENTS.mechanism.title}
          </Link>{' '}
          ·{' '}
          <Link href="/mechanism/decisions" className="hover:text-(--color-paper)">
            {DOCUMENTS.decisions.kicker}
          </Link>{' '}
          · {record.backlog} · {statusOf(record) === 'proposed' ? DOCUMENTS.decisions.proposed : statusOf(record)}
        </div>
        <h1 className="display mt-4 max-w-3xl text-3xl text-(--color-paper) sm:text-4xl">{record.title}</h1>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-(--color-paper-dim)">{record.asks}.</p>
      </header>
      {blocks === null ? (
        <p className="mt-8 text-base leading-relaxed" style={{ color: 'var(--color-state-stale)' }}>
          {DOCUMENTS.unread} <span className="text-(--color-paper-faint)">({fault ?? 'no content'})</span>
        </p>
      ) : (
        <>
          <HashOpener />
          <FoldedDocument blocks={blocks} />
        </>
      )}
      <nav className="mt-12 flex items-baseline justify-between gap-6 border-t border-(--color-rule) pt-4 text-[13px]">
        <span>
          {previous ? (
            <Link href={`/mechanism/decisions/${previous.slug}`} className="text-(--color-paper-dim) hover:text-(--color-paper)">
              ← {previous.title}
            </Link>
          ) : null}
        </span>
        <span>
          {next ? (
            <Link href={`/mechanism/decisions/${next.slug}`} className="text-(--color-paper-dim) hover:text-(--color-paper)">
              {next.title} →
            </Link>
          ) : null}
        </span>
      </nav>
    </main>
  );
}
