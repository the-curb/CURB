/**
 * The smallest markdown parser that renders DOCTRINE.md.
 *
 * The document is the source of truth for the rules the code enforces, and the
 * site shows it from the file rather than from a copy, so the page cannot drift
 * from the document. The parser handles exactly what the document uses —
 * headings, paragraphs, bullet and numbered lists, pipe tables, indented code,
 * inline code, bold, emphasis and links — and treats anything else as a
 * paragraph. It does not try to be a
 * markdown implementation; it tries to render one file faithfully.
 */

export type Inline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'strong'; readonly text: string; readonly inlines?: readonly Inline[] }
  | { readonly kind: 'em'; readonly text: string }
  | { readonly kind: 'link'; readonly text: string; readonly url: string };

export type Block =
  | { readonly kind: 'heading'; readonly level: 1 | 2 | 3; readonly text: string; readonly id: string }
  | { readonly kind: 'paragraph'; readonly inlines: readonly Inline[] }
  | { readonly kind: 'list'; readonly items: readonly (readonly Inline[])[]; readonly ordered?: boolean }
  | { readonly kind: 'table'; readonly header: readonly (readonly Inline[])[]; readonly rows: readonly (readonly Inline[])[][] }
  | { readonly kind: 'code'; readonly text: string };

export function slugOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * `code`, **strong** (which may hold code, emphasis and links), *emphasis* and
 * [links](url) — to http(s), a site path or an anchor. A relative link the
 * page did not resolve first is left as text, so nothing links nowhere.
 */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const pattern = /`([^`]+)`|\*\*((?:[^*]|\*(?!\*))+)\*\*|(?<![\w*])\*([^*\s](?:[^*]*[^*\s])?)\*(?![\w*])|\[([^\]]+)\]\(((?:https?:|\/|#)[^)\s]+)\)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ kind: 'text', text: text.slice(last, index) });
    if (match[1] !== undefined) out.push({ kind: 'code', text: match[1] });
    else if (match[2] !== undefined) {
      const inner = match[2];
      const inlines = /[`*[]/.test(inner) ? parseInline(inner) : undefined;
      out.push(inlines && inlines.some((x) => x.kind !== 'text') ? { kind: 'strong', text: inner, inlines } : { kind: 'strong', text: inner });
    } else if (match[3] !== undefined) out.push({ kind: 'em', text: match[3] });
    else if (match[4] !== undefined && match[5] !== undefined) out.push({ kind: 'link', text: match[4], url: match[5] });
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

    const marker = /^(- |\d+\. )/.exec(line);
    if (marker) {
      flushParagraph(paragraph);
      const ordered = marker[1] !== '- ';
      const isItem = (l: string) => (ordered ? /^\d+\. /.test(l) : /^- /.test(l));
      const items: Inline[][] = [];
      while (i < lines.length && isItem(lines[i]!)) {
        let item = lines[i]!.replace(/^(- |\d+\. )/, '');
        i += 1;
        // A wrapped item continues on indented lines.
        while (i < lines.length && /^ {2,3}\S/.test(lines[i]!) && !isItem(lines[i]!)) {
          item += ` ${lines[i]!.trim()}`;
          i += 1;
        }
        items.push(parseInline(item.trim()));
      }
      blocks.push(ordered ? { kind: 'list', items, ordered: true } : { kind: 'list', items });
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
