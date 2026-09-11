/**
 * Apply the retention horizon to the observation series.
 *
 *     npm run db:prune            # report only, deletes nothing
 *     npm run db:prune -- --apply # actually delete
 *
 * It reports before it deletes, and deletes nothing unless told to. Retention is
 * the only destructive operation this system performs on its own record, so it
 * does not happen as a side effect of anything else and it is never the default.
 *
 * What this removes changes what the Surveyor can compute later, which is why
 * the horizon is published in every one of its reports rather than living only
 * in an operator's cron.
 */

import { getStoreAsync, describeStore } from '../lib/store/index.ts';
import {
  describeRetention,
  OBSERVATION_RETENTION_DAYS,
  retentionCutoff,
} from '../lib/store/retention.ts';
import { FEEDS } from '../lib/chain/feeds.ts';

const apply = process.argv.includes('--apply');
const store = await getStoreAsync();
const cutoff = retentionCutoff();

console.log(`store    : ${describeStore()}`);
console.log(`horizon  : ${OBSERVATION_RETENTION_DAYS} days`);
console.log(`cutoff   : ${cutoff.toISOString()}`);
console.log(`mode     : ${apply ? 'APPLY — rows will be deleted' : 'report only — nothing deleted'}`);
console.log('');

// Show what each series holds first, so the effect is visible before it happens
// rather than inferred from a count afterwards.
for (const feed of FEEDS) {
  const read = await store.observations(feed.key, 10_000);
  if (read.state === 'UNREAD') {
    console.log(`  ${feed.key.padEnd(30)} unreadable (${read.reason})`);
    continue;
  }
  const total = read.value.length;
  if (total === 0) continue;
  const expiring = read.value.filter((r) => new Date(r.observedAt) < cutoff).length;
  const oldest = read.value[0]?.observedAt ?? '—';
  console.log(
    `  ${feed.key.padEnd(12)} ${String(total).padStart(6)} observations, oldest ${oldest}, ${expiring} past the horizon`,
  );
}

console.log('');

if (!apply) {
  console.log('Nothing was deleted. Re-run with --apply to prune.');
  await store.close();
  process.exit(0);
}

const pruned = await store.pruneObservations(cutoff);
if (pruned.state === 'UNREAD') {
  // A prune we could not confirm is not a prune of zero.
  console.error(`prune could not be confirmed: ${pruned.reason} — ${pruned.detail ?? ''}`);
  process.exitCode = 1;
} else {
  console.log(`removed ${pruned.value} observations.`);
  console.log('');
  console.log(describeRetention());
}

await store.close();
