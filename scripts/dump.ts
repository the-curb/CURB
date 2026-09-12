/**
 * Export the store — the record — to files, and read such an export back.
 *
 *     CURB_POSTGRES_URL=postgres://... node scripts/dump.ts <directory>
 *     CURB_POSTGRES_URL=postgres://... node scripts/dump.ts --restore <directory>
 *
 * One gzipped JSONL file per table (heartbeats, publications, blocks,
 * observations, narrations, snapshots — the run lock is not the record),
 * plus a manifest with the counts, the time and the schema's columns. Rows
 * are streamed in pages so a large table needs no memory to speak of. A
 * restore inserts every row and leaves an existing one alone (on conflict
 * do nothing): it fills an empty store or adds what is missing, and never
 * replaces what is there. The dump is what a backup is; a provider's own
 * backups are the provider's, and this is the operator's.
 */

import { createReadStream, createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip, createGzip } from 'node:zlib';
import { buildSql } from '../lib/store/postgres.ts';

const url = process.env.CURB_POSTGRES_URL;
if (!url) {
  console.error('CURB_POSTGRES_URL is not set. Nothing was read.');
  process.exit(1);
}
const args = process.argv.slice(2);
const restore = args.includes('--restore');
const dir = args.find((a) => !a.startsWith('--'));
if (!dir) {
  console.error('usage: node scripts/dump.ts [--restore] <directory>');
  process.exit(2);
}

/** The tables that are the record, with the column that orders a page. */
const TABLES: readonly { name: string; order: string }[] = [
  { name: 'heartbeats', order: 'id' },
  { name: 'publications', order: 'published_at, id' },
  { name: 'blocks', order: 'blocked_at, id' },
  { name: 'observations', order: 'id' },
  { name: 'narrations', order: 'day' },
  { name: 'snapshots', order: 'key' },
];
const PAGE = 5_000;

// CURB_POSTGRES_SCHEMA names another schema for a restore into a fresh one (the conformance suite's habit); unset, the store's own.
const sql = buildSql(url, process.env.CURB_POSTGRES_SCHEMA ? { schema: process.env.CURB_POSTGRES_SCHEMA } : {});

try {
  if (!restore) {
    mkdirSync(dir, { recursive: true });
    const manifest: Record<string, unknown> = { dumpedAt: new Date().toISOString(), tables: {} as Record<string, unknown> };
    for (const t of TABLES) {
      const columns = await sql<{ column_name: string; data_type: string }[]>`select column_name, data_type from information_schema.columns where table_schema = current_schema() and table_name = ${t.name} order by ordinal_position`;
      const out = createWriteStream(path.join(dir, `${t.name}.jsonl.gz`));
      const gz = createGzip();
      gz.pipe(out);
      let offset = 0;
      let count = 0;
      for (;;) {
        const rows = await sql.unsafe(`select * from ${t.name} order by ${t.order} limit ${PAGE} offset ${offset}`);
        for (const row of rows) {
          if (!gz.write(`${JSON.stringify(row)}\n`)) await new Promise((resolve) => gz.once('drain', resolve));
          count += 1;
        }
        if (rows.length < PAGE) break;
        offset += PAGE;
      }
      await new Promise<void>((resolve, reject) => {
        out.on('finish', () => resolve());
        out.on('error', reject);
        gz.end();
      });
      (manifest.tables as Record<string, unknown>)[t.name] = { rows: count, columns: columns.map((c) => `${c.column_name}:${c.data_type}`) };
      console.error(`${t.name}: ${count} rows`);
    }
    writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    console.error(`written ${path.resolve(dir)}`);
  } else {
    const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as { dumpedAt: string; tables: Record<string, { rows: number }> };
    console.error(`restoring the dump of ${manifest.dumpedAt} from ${path.resolve(dir)}; existing rows are left as they are`);
    for (const t of TABLES) {
      const file = path.join(dir, `${t.name}.jsonl.gz`);
      const lines = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Number.POSITIVE_INFINITY });
      let batch: Record<string, unknown>[] = [];
      let inserted = 0;
      let seen = 0;
      const flush = async () => {
        if (batch.length === 0) return;
        const columns = Object.keys(batch[0]!);
        const values = batch.map((r) => columns.map((c) => r[c]));
        const placeholders = values.map((row, i) => `(${row.map((_, j) => `$${i * columns.length + j + 1}`).join(', ')})`).join(', ');
        const result = await sql.unsafe(`insert into ${t.name} (${columns.join(', ')}) values ${placeholders} on conflict do nothing`, values.flat() as never[]);
        inserted += result.count;
        batch = [];
      };
      for await (const line of lines) {
        if (line.trim() === '') continue;
        batch.push(JSON.parse(line) as Record<string, unknown>);
        seen += 1;
        if (batch.length >= 500) await flush();
      }
      await flush();
      console.error(`${t.name}: ${seen} rows in the dump, ${inserted} inserted, ${seen - inserted} already present`);
    }
  }
} finally {
  await sql.end({ timeout: 5 });
}
