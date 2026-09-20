/**
 * A local rehearsal of the pair that makes a basis: the Pillar reads the feeds,
 * then the Specialist reads the pools and prints the distance between them.
 *
 * It runs against the local append-only store, never production, so the record
 * an operator judges production by is untouched. Delete `.curb-store` after.
 *
 *   CURB_DNS_OVER_HTTPS=1 node scripts/rehearse-specialist.mjs
 */

import { AGENT_BY_ID } from '../lib/agents/registry.ts';
import { PRODUCERS } from '../lib/agents/producers/index.ts';
import { runAgent } from '../lib/agents/runtime.ts';
import { getStoreAsync } from '../lib/store/index.ts';

const store = await getStoreAsync();

for (const id of ['pillar', 'specialist']) {
  const record = await runAgent(AGENT_BY_ID[id], PRODUCERS[id], { store });
  console.log('='.repeat(72));
  console.log(`${AGENT_BY_ID[id].name} — ${record.outcome} · sources ${record.heartbeat.sourcesReached}/${AGENT_BY_ID[id].sourcesExpected}`);
  if (record.heartbeat.detail) console.log(`why: ${record.heartbeat.detail}`);
  if (record.publication) {
    console.log('-'.repeat(72));
    console.log(record.publication.headline);
    console.log(record.publication.body);
  }
  if (record.breaches && record.breaches.length > 0) {
    console.log('-'.repeat(72));
    for (const b of record.breaches) console.log(`BLOCKED ${b.rule}: ${b.matched} — ${b.explanation}`);
  }
}

const pools = await store.snapshots('pool:');
if (pools.state !== 'UNREAD') {
  console.log('='.repeat(72));
  console.log('THE BOARD, as a page would draw it');
  console.log('ticker    pool USD    feed USD   basis   depth USD   venue');
  const rows = pools.value
    .map((s) => s.payload)
    .sort((a, b) => Math.abs(Number(b.basisBps ?? 0)) - Math.abs(Number(a.basisBps ?? 0)));
  for (const p of rows) {
    const bps = typeof p.basisBps === 'number' ? `${p.basisBps > 0 ? '+' : ''}${Math.round(p.basisBps)}bp` : '—';
    const pool = typeof p.priceUsd === 'number' ? p.priceUsd.toFixed(2) : '—';
    const ref = typeof p.referenceUsd === 'number' ? p.referenceUsd.toFixed(2) : '—';
    const depth = typeof p.depthUsd === 'number' ? Math.round(p.depthUsd).toLocaleString('en-US') : '—';
    console.log(
      String(p.ticker).padEnd(9),
      pool.padStart(10),
      ref.padStart(10),
      bps.padStart(8),
      depth.padStart(11),
      '  ' + String(p.venueLabel ?? ''),
    );
  }
}
