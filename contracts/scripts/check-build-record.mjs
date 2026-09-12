/**
 * Is the committed build record the code this source compiles to?
 *
 * record-build.mjs stamps the artifact on disk with HEAD's commit; nothing
 * else stops a record from going stale when a contract changes and the
 * record is not re-run, or from being written from an old artifact. This
 * check compares the committed records' runtime bytecode and immutable
 * slots with the artifacts a fresh compile produced, and fails when they
 * differ. The checks workflow runs it after `npm run build`, before
 * anything is verified against the records.
 *
 *   npm run build && node scripts/check-build-record.mjs
 */
import { readFileSync } from 'node:fs';

const CONTRACTS = [
  { artifact: '../artifacts/src/CompanySeries.sol/CompanySeries.json', record: '../evidence/CompanySeries.build.json' },
  { artifact: '../artifacts/src/CreditDesk.sol/CreditDesk.json', record: '../evidence/CreditDesk.build.json' },
];

let failed = false;
for (const c of CONTRACTS) {
  const artifact = JSON.parse(readFileSync(new URL(c.artifact, import.meta.url), 'utf8'));
  const record = JSON.parse(readFileSync(new URL(c.record, import.meta.url), 'utf8'));
  const sameCode = artifact.deployedBytecode.toLowerCase() === String(record.deployedBytecode).toLowerCase();
  const slotsNow = Object.values(artifact.immutableReferences)
    .flat()
    .map((s) => `${s.start}:${s.length}`)
    .sort()
    .join(',');
  const slotsRecorded = (record.immutables ?? [])
    .flatMap((im) => im.slots.map((s) => `${s.start}:${s.length}`))
    .sort()
    .join(',');
  if (sameCode && slotsNow === slotsRecorded) {
    console.error(`${artifact.contractName}: the committed record (commit ${String(record.commit).slice(0, 10)}) is this source's bytecode`);
  } else {
    failed = true;
    console.error(`${artifact.contractName}: the committed record (commit ${String(record.commit).slice(0, 10)}) is NOT this source's bytecode${sameCode ? '' : ' (code differs)'}${slotsNow === slotsRecorded ? '' : ' (immutable slots differ)'}; run npm run record:build and commit the record`);
  }
}
process.exit(failed ? 1 : 0);
