/**
 * Every string a copy module holds, and every sentence among them.
 *
 * The first copy modules each listed their own sentences by hand for the
 * tests. That list can fall behind the module; walking the object cannot. A
 * string that ends in a full stop, a question mark or an exclamation mark is
 * split into sentences; a label — a column name, a button — is a string but
 * not a sentence, and is checked for claims without being held to a length.
 */

export function copyStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(copyStrings);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(copyStrings);
  return [];
}

/** Placeholders written in with a plain stand-in, so a sentence is measured as a reader sees it. */
function filled(line: string): string {
  return line.replace(/\{(\w+)\}/g, '12');
}

export function copySentences(value: unknown): string[] {
  return copyStrings(value)
    .map(filled)
    .filter((s) => /[.!?]["”’)]?$/.test(s.trim()))
    .flatMap((s) => s.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
