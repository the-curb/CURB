import Link from 'next/link';
import { sectionsOf, type Block, type Inline } from '@/lib/docs/markdown';

/**
 * A document, rendered block by block. Used by the pages that show a file
 * from the repository rather than a copy of it — the doctrine and the
 * mechanism — so what the site says the rules are cannot drift from what
 * the file says.
 */

export function Inlines({ inlines }: { inlines: readonly Inline[] }) {
  return (
    <>
      {inlines.map((inline, i) => {
        switch (inline.kind) {
          case 'code':
            return (
              <code key={i} className="rounded-sm bg-(--color-ink-3) px-1 py-0.5 font-mono text-[0.85em] text-(--color-paper)">
                {inline.text}
              </code>
            );
          case 'strong':
            return (
              <strong key={i} className="font-medium text-(--color-paper)">
                {inline.inlines ? <Inlines inlines={inline.inlines} /> : inline.text}
              </strong>
            );
          case 'em':
            return (
              <em key={i} className="italic">
                {inline.text}
              </em>
            );
          case 'link':
            return inline.url.startsWith('http') ? (
              <a key={i} href={inline.url} className="text-(--color-paper) underline decoration-(--color-accent) decoration-1 underline-offset-4 hover:text-(--color-accent)" rel="noopener noreferrer" target="_blank">
                {inline.text}
              </a>
            ) : (
              <Link key={i} href={inline.url} className="text-(--color-paper) underline decoration-(--color-accent) decoration-1 underline-offset-4 hover:text-(--color-accent)">
                {inline.text}
              </Link>
            );
          default:
            return <span key={i}>{inline.text}</span>;
        }
      })}
    </>
  );
}

export function BlockView({ block }: { block: Block }) {
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
              ? 'display mt-14 scroll-mt-28 border-t border-(--color-rule) pt-8 text-2xl text-(--color-paper) sm:text-3xl'
              : 'kicker mt-8 scroll-mt-28'
          }
          style={block.level === 3 ? { color: 'var(--color-paper)' } : undefined}
        >
          {block.text}
        </Tag>
      );
    }
    case 'paragraph':
      return (
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-(--color-paper-dim)">
          <Inlines inlines={block.inlines} />
        </p>
      );
    case 'list':
      return (
        <ul className="mt-4 max-w-3xl space-y-2">
          {block.items.map((item, i) => (
            <li key={i} className="grid grid-cols-[1.75rem_minmax(0,1fr)] text-base leading-relaxed text-(--color-paper-dim)">
              <span className="tabular text-(--color-accent)">{block.ordered ? `${i + 1}.` : '—'}</span>
              <span>
                <Inlines inlines={item} />
              </span>
            </li>
          ))}
        </ul>
      );
    case 'code':
      return (
        <pre className="tabular mt-4 overflow-x-auto border border-(--color-rule) bg-(--color-ink) p-4 text-xs leading-relaxed text-(--color-paper)">
          {block.text}
        </pre>
      );
    case 'table':
      return (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-sm">
            <thead>
              <tr className="kicker text-left">
                {block.header.map((cell, i) => (
                  <th key={i} className="pb-2 pr-6 font-normal">
                    <Inlines inlines={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-t border-(--color-rule)">
                  {row.map((cell, c) => (
                    <td key={c} className="py-2 pr-6 align-baseline leading-relaxed text-(--color-paper-dim)">
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

export function Contents({ sections }: { sections: readonly { id: string; text: string }[] }) {
  if (sections.length === 0) return null;
  return (
    <ol className="mb-8 grid gap-x-8 gap-y-1.5 border-t border-(--color-rule) pt-6 sm:grid-cols-2">
      {sections.map((s) => (
        <li key={s.id} className="text-sm">
          <a href={`#${s.id}`} className="text-(--color-paper-dim) hover:text-(--color-paper)">
            {s.text}
          </a>
        </li>
      ))}
    </ol>
  );
}

/**
 * The whole document, every word of it, with each section folded under its
 * own heading. A reader sees the shape of the document first — its sections,
 * in order — and opens the one they came for. It is the file, not a summary
 * of it: nothing is cut and nothing is written in its place.
 */
export function FoldedDocument({ blocks }: { blocks: readonly Block[] }) {
  const { preamble, sections } = sectionsOf(blocks);
  return (
    <article>
      {preamble.map((block, i) => (
        <BlockView key={`p${i}`} block={block} />
      ))}
      <div className="mt-8 border-b border-(--color-rule)">
        {sections.map(({ heading, body }) => (
          <details key={heading.id} id={heading.id} className="group scroll-mt-28 border-t border-(--color-rule)">
            <summary className="flex cursor-pointer items-baseline justify-between gap-6 py-4">
              <span className="display text-xl text-(--color-paper) group-open:text-(--color-accent) sm:text-2xl">{heading.text}</span>
              <span aria-hidden="true" className="tabular text-sm text-(--color-paper-faint) group-open:rotate-45">
                +
              </span>
            </summary>
            <div className="pb-8">
              {body.map((block, i) => (
                <BlockView key={i} block={block} />
              ))}
            </div>
          </details>
        ))}
      </div>
    </article>
  );
}
