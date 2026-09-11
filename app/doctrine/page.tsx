import { promises as fs } from 'node:fs';
import path from 'node:path';
import { RULE_COUNT } from '@/lib/doctrine/policy';
import { AGENT_COUNTS } from '@/lib/agents/registry';
import { parseMarkdown, type Block, type Inline } from '@/lib/docs/markdown';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Doctrine' };

/**
 * DOCTRINE.md, rendered from the file. The document names the file that
 * enforces each rule, and this page shows the document rather than a copy of
 * it, so what the site says the rules are cannot drift from what they are.
 * If the file cannot be read, the page says so; it does not fall back to a
 * summary written by hand.
 */

const DOC = path.join(/*turbopackIgnore: true*/ process.cwd(), 'DOCTRINE.md');

function Inlines({ inlines }: { inlines: readonly Inline[] }) {
  return (
    <>
      {inlines.map((inline, i) => {
        switch (inline.kind) {
          case 'code':
            return (
              <code key={i} className="rounded-sm bg-[--color-ink-3] px-1 py-0.5 font-mono text-[0.85em] text-[--color-paper]">
                {inline.text}
              </code>
            );
          case 'strong':
            return (
              <strong key={i} className="font-medium text-[--color-paper]">
                {inline.text}
              </strong>
            );
          default:
            return <span key={i}>{inline.text}</span>;
        }
      })}
    </>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case 'heading': {
      if (block.level === 1) {
        return null; // the page header carries the title
      }
      const Tag = block.level === 2 ? 'h2' : 'h3';
      return (
        <Tag
          id={block.id}
          className={
            block.level === 2
              ? 'mt-14 scroll-mt-8 border-t border-[--color-rule] pt-8 text-lg leading-snug text-[--color-paper]'
              : 'mt-8 scroll-mt-8 text-[11px] uppercase tracking-[0.24em] text-[--color-brass]'
          }
        >
          {block.text}
        </Tag>
      );
    }
    case 'paragraph':
      return (
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-[--color-paper-dim]">
          <Inlines inlines={block.inlines} />
        </p>
      );
    case 'list':
      return (
        <ul className="mt-4 max-w-3xl space-y-2">
          {block.items.map((item, i) => (
            <li key={i} className="text-sm leading-relaxed text-[--color-paper-dim]">
              <span className="mr-2 text-[--color-paper-faint]">—</span>
              <Inlines inlines={item} />
            </li>
          ))}
        </ul>
      );
    case 'code':
      return (
        <pre className="mt-4 overflow-x-auto border border-[--color-rule] bg-[--color-ink] p-4 font-mono text-xs leading-relaxed text-[--color-paper]">
          {block.text}
        </pre>
      );
    case 'table':
      return (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.16em] text-[--color-paper-faint]">
                {block.header.map((cell, i) => (
                  <th key={i} className="pb-2 pr-6 font-normal">
                    <Inlines inlines={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-t border-[--color-rule]">
                  {row.map((cell, c) => (
                    <td key={c} className="py-2 pr-6 align-baseline text-[--color-paper-dim]">
                      <Inlines inlines={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export default async function DoctrinePage() {
  let blocks: Block[] | null = null;
  let fault: string | null = null;
  try {
    blocks = parseMarkdown(await fs.readFile(DOC, 'utf8'));
  } catch (cause) {
    fault = cause instanceof Error ? cause.message : 'unknown failure';
  }
  const sections = blocks?.filter((b): b is Extract<Block, { kind: 'heading' }> => b.kind === 'heading' && b.level === 2) ?? [];

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 sm:py-16">

      <header className="mb-6">
        <div className="tracking-mark text-xs text-[--color-brass]">DOCTRINE</div>
        <h1 className="mt-4 max-w-2xl text-2xl leading-snug text-[--color-paper] sm:text-3xl">
          The rules this system is built on. Each one names the file that enforces it.
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-[--color-paper-dim]">
          {RULE_COUNT} policy rules as code. {AGENT_COUNTS.measure} agents measure, {AGENT_COUNTS.promote} promotes,{' '}
          {AGENT_COUNTS.execute} execute. This page is the document itself, read from the repository at request time —
          not a summary of it.
        </p>
      </header>

      {fault !== null || blocks === null ? (
        <p className="mt-8 text-sm leading-relaxed" style={{ color: 'var(--color-state-stale)' }}>
          The doctrine file could not be read ({fault ?? 'no content'}). Nothing is shown in its place: a summary
          written by hand would be a second document that could disagree with the first.
        </p>
      ) : (
        <>
          {sections.length > 0 ? (
            <ol className="mb-8 grid gap-x-8 gap-y-1 border-t border-[--color-rule] pt-6 sm:grid-cols-2">
              {sections.map((s) => (
                <li key={s.id} className="text-xs">
                  <a href={`#${s.id}`} className="text-[--color-paper-faint] hover:text-[--color-paper]">
                    {s.text}
                  </a>
                </li>
              ))}
            </ol>
          ) : null}
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
