/**
 * Export the store — the record — to files, and read such an export back.
 *
 *     CURB_POSTGRES_URL=postgres://... node scripts/dump.ts <directory>
 *     CURB_POSTGRES_URL=postgres://... node scripts/dump.ts --restore <directory>
 *
 * One gzipped JSONL file per table (heartbeats, publications, blocks,
 * observations, narrations, snapshots — the run lock is not the record),
 * plus a manifest with the counts, the time and the schema's columns. Rows
 * are read in pages that follow a key, never an offset, so a row the tick
 * writes or the prune removes meanwhile shifts nothing: every row present
 * when its page is read is in the dump once. Every page of one table is
 * read in one transaction at REPEATABLE READ, so a table is a snapshot of
 * one moment.
 *
 * A restore inserts every row and leaves an existing one alone (on
 * conflict do nothing): it fills an empty store or adds what is missing,
 * and never replaces what is there. The two tables with serial ids
 * (heartbeats, observations) are restored with their ids, and the sequences
 * are moved past the highest id restored, so the tick's next insert does
 * not collide. A dump restored into a store that has ticked since carries
 * ids that store may have reused for other rows: those rows are skipped and
 * counted apart, and the operator reads the count. The dump is what a
 * backup is; a provider's own backups are the provider's, and this is the
 * operator's.
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

/** The tables that are the record, with the unique key that orders and pages them, and whether the key is a serial the sequence must follow. */
const TABLES: readonly { name: string; keys: readonly string[]; serial: string | null }[] = [
  { name: 'heartbeats', keys: ['id'], serial: 'id' },
  { name: 'publications', keys: ['published_at', 'id'], serial: null },
  { name: 'blocks', keys: ['blocked_at', 'id'], serial: null },
  { name: 'observations', keys: ['id'], serial: 'id' },
  { name: 'narrations', keys: ['day'], serial: null },
  { name: 'snapshots', keys: ['key'], serial: null },
];
const PAGE = 5_000;

// CURB_POSTGRES_SCHEMA names another schema for a restore into a fresh one (the conformance suite's habit); unset, the store's own.
const sql = buildSql(url, process.env.CURB_POSTGRES_SCHEMA ? { schema: process.env.CURB_POSTGRES_SCHEMA } : {});

/** A row's value for a key column, as the driver returns it (dates stay dates). */
const keyOf = (row: Record<string, unknown>, k: string): unknown => row[k];

try {
  if (!restore) {
    mkdirSync(dir, { recursive: true });
    const manifest: Record<string, unknown> = { dumpedAt: new Date().toISOString(), tables: {} as Record<string, unknown> };
    for (const t of TABLES) {
      const columns = await sql<{ column_name: string; data_type: string }[]>`select column_name, data_type from information_schema.columns where table_schema = current_schema() and table_name = ${t.name} order by ordinal_position`;
      const out = createWriteStream(path.join(dir, `${t.name}.jsonl.gz`));
      const gz = createGzip();
      gz.pipe(out);
      let count = 0;
      // One transaction per table at REPEATABLE READ: every page sees the same rows.
      await sql.begin('isolation level repeatable read read only', async (tx) => {
        let after: readonly unknown[] | null = null;
        const order = t.keys.join(', ');
        for (;;) {
          // Keyset paging: the rows after the last key seen, in key order. Tuple comparison keeps a composite key exact.
          const where = after === null ? '' : `where (${order}) > (${t.keys.map((_, i) => `$${i + 1}`).join(', ')})`;
          const rows = (await tx.unsafe(`select * from ${t.name} ${where} order by ${order} limit ${PAGE}`, (after ?? []) as never[])) as Record<string, unknown>[];
          for (const row of rows) {
            if (!gz.write(`${JSON.stringify(row)}\n`)) await new Promise((resolve) => gz.once('drain', resolve));
            count += 1;
          }
          if (rows.length < PAGE) break;
          const last = rows[rows.length - 1]!;
          after = t.keys.map((k) => keyOf(last, k));
        }
      });
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
    const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as { dumpedAt: string; tables: Record<string, { rows: number; columns: string[] }> };
    console.error(`restoring the dump of ${manifest.dumpedAt} from ${path.resolve(dir)}; existing rows are left as they are`);
    for (const t of TABLES) {
      const file = path.join(dir, `${t.name}.jsonl.gz`);
      const lines = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Number.POSITIVE_INFINITY });
      // The columns come from the manifest, so a row with a null in its first column does not narrow the list.
      const columns = (manifest.tables[t.name]?.columns ?? []).map((c) => c.split(':')[0]!);
      if (columns.length === 0) throw new Error(`the manifest names no columns for ${t.name}`);
      let batch: Record<string, unknown>[] = [];
      let inserted = 0;
      let seen = 0;
      const flush = async () => {
        if (batch.length === 0) return;
        const values = batch.map((r) => columns.map((c) => r[c] ?? null));
        const placeholders = values.map((row, i) => `(${row.map((_, j) => `$${i * columns.length + j + 1}`).join(', ')})`).join(', ');
        const result = await sql.unsafe(`insert into ${t.name} (${columns.join(', ')}) values ${placeholders} on conflict do nothing`, values.flat() as never[]);
        inserted += result.count;
        batch = [];
      };
      let maxSerial = 0n;
      for await (const line of lines) {
        if (line.trim() === '') continue;
        const row = JSON.parse(line) as Record<string, unknown>;
        if (t.serial !== null) {
          const id = BigInt(String(row[t.serial]));
          if (id > maxSerial) maxSerial = id;
        }
        batch.push(row);
        seen += 1;
        if (batch.length >= 500) await flush();
      }
      await flush();
      const skipped = seen - inserted;
      console.error(`${t.name}: ${seen} rows in the dump, ${inserted} inserted, ${skipped} already present${t.serial !== null && skipped > 0 ? ' (by key — a store that ticked since the dump may hold other rows under those ids; read the count)' : ''}`);
      if (t.serial !== null && maxSerial > 0n) {
        // The sequence follows the highest id restored, so the next insert does not collide with a restored row.
        await sql.unsafe(`select setval(pg_get_serial_sequence('${t.name}', '${t.serial}'), greatest((select coalesce(max(${t.serial}), 0) from ${t.name}), $1::bigint))`, [maxSerial.toString()] as never[]);
        console.error(`${t.name}: the ${t.serial} sequence moved past ${maxSerial}`);
      }
    }
  }
} finally {
  await sql.end({ timeout: 5 });
}
