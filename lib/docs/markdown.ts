/**
 * The smallest markdown parser that renders DOCTRINE.md.
 *
 * The document is the source of truth for the rules the code enforces, and the
 * site shows it from the file rather than from a copy, so the page cannot drift
 * from the document. The parser handles exactly what the document uses —
 * headings, paragraphs, bullet lists, pipe tables, indented code, inline code
 * and bold — and treats anything else as a paragraph. It does not try to be a
 * markdown implementation; it tries to render one file faithfully.
 */

export type Inline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'strong'; readonly text: string };

export type Block =
  | { readonly kind: 'heading'; readonly level: 1 | 2 | 3; readonly text: string; readonly id: string }
  | { readonly kind: 'paragraph'; readonly inlines: readonly Inline[] }
  | { readonly kind: 'list'; readonly items: readonly (readonly Inline[])[] }
  | { readonly kind: 'table'; readonly header: readonly (readonly Inline[])[]; readonly rows: readonly (readonly Inline[])[][] }
  | { readonly kind: 'code'; readonly text: string };

export function slugOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `code` and **strong**, nothing nested. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ kind: 'text', text: text.slice(last, index) });
    if (match[1] !== undefined) out.push({ kind: 'code', text: match[1] });
    else if (match[2] !== undefined) out.push({ kind: 'strong', text: match[2] });
    last = index + match[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

const SEPARATOR_ROW = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  const flushParagraph = (buffer: string[]) => {
    if (buffer.length === 0) return;
    blocks.push({ kind: 'paragraph', inlines: parseInline(buffer.join(' ')) });
    buffer.length = 0;
  };

  const paragraph: string[] = [];
  while (i < lines.length) {
    const line = lines[i]!;

    if (line.trim() === '') {
      flushParagraph(paragraph);
      i += 1;
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph(paragraph);
      const level = heading[1]!.length as 1 | 2 | 3;
      const text = heading[2]!.trim();
      blocks.push({ kind: 'heading', level, text, id: slugOf(text) });
      i += 1;
      continue;
    }

    if (/^    \S/.test(line)) {
      flushParagraph(paragraph);
      const code: string[] = [];
      while (i < lines.length && (/^    /.test(lines[i]!) || lines[i]!.trim() === '')) {
        if (lines[i]!.trim() === '' && !(i + 1 < lines.length && /^    /.test(lines[i + 1]!))) break;
        code.push(lines[i]!.replace(/^    /, ''));
        i += 1;
      }
      blocks.push({ kind: 'code', text: code.join('\n').trimEnd() });
      continue;
    }

    if (/^- /.test(line)) {
      flushParagraph(paragraph);
      const items: Inline[][] = [];
      while (i < lines.length && /^- /.test(lines[i]!)) {
        let item = lines[i]!.slice(2);
        i += 1;
        // A wrapped item continues on indented lines.
        while (i < lines.length && /^  \S/.test(lines[i]!) && !/^- /.test(lines[i]!)) {
          item += ` ${lines[i]!.trim()}`;
          i += 1;
        }
        items.push(parseInline(item.trim()));
      }
      blocks.push({ kind: 'list', items });
      continue;
    }

    if (/^\|/.test(line) && i + 1 < lines.length && SEPARATOR_ROW.test(lines[i + 1]!)) {
      flushParagraph(paragraph);
      const header = splitRow(line).map(parseInline);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && /^\|/.test(lines[i]!)) {
        rows.push(splitRow(lines[i]!).map(parseInline));
        i += 1;
      }
      blocks.push({ kind: 'table', header, rows });
      continue;
    }

    paragraph.push(line.trim());
    i += 1;
  }
  flushParagraph(paragraph);
  return blocks;
}
