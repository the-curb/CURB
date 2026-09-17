import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DECISIONS, decisionBySlug, readDecision, resolveRecordLinks, statusOf } from '@/lib/docs/decisions';
import { parseMarkdown } from '@/lib/docs/markdown';
import { BlockView } from '../../../components/markdown-view';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const record = decisionBySlug(slug);
  return { title: record ? record.title : 'Decision record' };
}

/** A link to another record by its file name becomes a link to its page; anything else is left to the parser's own rules. */
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
          <b>The position</b> · <Link href="/mechanism" className="hover:text-(--color-paper)">Mechanism</Link> ·{' '}
          <Link href="/mechanism/decisions" className="hover:text-(--color-paper)">decision records</Link> · {record.backlog} · {statusOf(record) === 'proposed' ? 'proposed, not decided' : statusOf(record)}
        </div>
      </header>
      {blocks === null ? (
        <p className="mt-8 text-base leading-relaxed" style={{ color: 'var(--color-state-stale)' }}>
          The record could not be read ({fault ?? 'no content'}). Nothing is shown in its place.
        </p>
      ) : (
        <article>
          {blocks.map((block, i) => (
            <BlockView key={i} block={block} />
          ))}
        </article>
      )}
      <nav className="mt-12 flex items-baseline justify-between gap-6 border-t border-(--color-rule) pt-4 text-[13px]">
        <span>{previous ? <Link href={`/mechanism/decisions/${previous.slug}`} className="text-(--color-paper-dim) hover:text-(--color-paper)">← {previous.title}</Link> : null}</span>
        <span>{next ? <Link href={`/mechanism/decisions/${next.slug}`} className="text-(--color-paper-dim) hover:text-(--color-paper)">{next.title} →</Link> : null}</span>
      </nav>
    </main>
  );
}
