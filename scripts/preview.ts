/**
 * Rehearse one agent and show what it would publish. Writes nothing.
 *
 *   node scripts/preview.ts registrar
 *
 * It runs the real producer against real sources and puts the candidate through
 * the real gates, then prints the verdict. It bypasses only the interval — a
 * developer should not have to wait a day to see whether their prose passes.
 * Nothing is persisted, so the state you use to judge production stays clean.
 */

import { AGENT_BY_ID, type AgentId } from '../lib/agents/registry.ts';
import { PRODUCERS } from '../lib/agents/producers/index.ts';
import { screen } from '../lib/doctrine/policy.ts';
import { getStoreAsync } from '../lib/store/index.ts';

const id = process.argv[2] as AgentId | undefined;

if (!id || !(id in AGENT_BY_ID)) {
  console.error(`usage: node scripts/preview.ts <agentId> [--fresh]`);
  console.error('  --fresh  rehearse as if the agent had never filed: an agent that stays quiet on an unchanged reading files in full');
  console.error(`known: ${Object.keys(AGENT_BY_ID).join(', ')}`);
  process.exit(1);
}

const spec = AGENT_BY_ID[id];
const producer = PRODUCERS[id];

if (!producer) {
  console.error(`${spec.name} is described in the registry but has no producer wired.`);
  process.exit(1);
}

const now = new Date();
const real = await getStoreAsync();
// --fresh hides the agent's own memory of what it last filed — the shape
// snapshots the Bell and the Pillar compare against — so the rehearsal shows
// the filing rather than the decision to stay quiet. Nothing else is altered,
// and nothing is written either way.
const fresh = process.argv.includes('--fresh');
const store: typeof real = fresh
  ? {
      ...real,
      snapshots: async (prefix: string) => (prefix.startsWith(`${id}:`) ? { state: 'VERIFIED' as const, value: [], source: 'rehearsal · hidden', retrievedAt: now.toISOString(), ageSeconds: 0, intervalSeconds: 60 } : real.snapshots(prefix)),
      publicationsByAgent: async (agentId, limit) => (agentId === id ? { state: 'VERIFIED' as const, value: [], source: 'rehearsal · hidden', retrievedAt: now.toISOString(), ageSeconds: 0, intervalSeconds: 60 } : real.publicationsByAgent(agentId, limit)),
    }
  : real;
const result = await producer({ spec, now, store });
// The rehearsal is over; nothing else touches the store. Closing it here means
// the process exits when the output ends, not when the pool times out.
await real.close();

console.log(`\n${'='.repeat(72)}`);
console.log(`${spec.name} · rehearsal at ${now.toISOString()} · nothing written`);
console.log('='.repeat(72));
console.log(
  `sources reached ${result.sourcesReached}/${spec.sourcesExpected} · minimum ${spec.minimumSources}`,
);
console.log(`oldest input    ${result.oldestInputAt?.toISOString() ?? '— (nothing read)'}`);

if (result.sourcesReached < spec.minimumSources) {
  console.log('\nCOVERAGE_BELOW_MINIMUM — it would declare unknown and publish nothing.\n');
  process.exit(0);
}
if (result.publication === null) {
  console.log('\nNOTHING_TO_SAY — a real outcome, and it would still leave a heartbeat.\n');
  process.exit(0);
}

const { headline, body, figures, readings, allowedLiterals } = result.publication;
console.log(`\n${headline}\n${'-'.repeat(72)}\n${body}\n`);

console.log('-'.repeat(72));
console.log(`declared figures (${figures.length}):`);
for (const figure of figures) {
  console.log(`  ${figure.token.padEnd(24)} ${figure.source}  @ ${figure.retrievedAt}`);
}

const verdict = screen({
  text: `${headline}\n${body}`,
  figures,
  ...(readings === undefined ? {} : { readings }),
  ...(allowedLiterals === undefined ? {} : { allowedLiterals }),
});

console.log('-'.repeat(72));
if (verdict.decision === 'ALLOW') {
  console.log('POLICY: ALLOW — this would publish.\n');
} else {
  console.log(`POLICY: BLOCK — ${verdict.breaches.length} breach(es), nothing would publish.`);
  for (const breach of verdict.breaches) {
    console.log(`  ${breach.rule}  "${breach.matched}"`);
    console.log(`    ${breach.explanation}`);
  }
  console.log('');
  process.exitCode = 1;
}
