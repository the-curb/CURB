/**
 * Is the committed build record the code this source compiles to?
 *
 * record-build.mjs stamps the artifact on disk with HEAD's commit; nothing
 * else stops a record from going stale when a contract changes and the
 * record is not re-run, or from being written from an old artifact or a
 * dirty tree. This check compares the committed records' runtime bytecode
 * and immutable slots — by name — with the artifacts a fresh compile
 * produced, and refuses a record written from a dirty tree or without the
 * commit that compiles to it. The checks workflow runs it after
 * `npm run build`, before anything is verified against the records.
 *
 *   npm run build && node scripts/check-build-record.mjs
 */
import { readFileSync } from 'node:fs';
import { assertRecordedSourceCommit, buildCurrentContracts, currentSourceCommit } from './lib/build-provenance.mjs';

buildCurrentContracts();

const CONTRACTS = [
  { artifact: '../artifacts/src/CompanySeries.sol/CompanySeries.json', record: '../evidence/CompanySeries.build.json', names: ['componentA', 'componentB', 'qA', 'qB', 'capLots'] },
  { artifact: '../artifacts/src/CreditDesk.sol/CreditDesk.json', record: '../evidence/CreditDesk.build.json', names: ['curb', 'treasury'] },
];

let failed = false;
const refuse = (name, why) => {
  failed = true;
  console.error(`${name}: ${why}; run npm run record:build from a clean tree and commit the record`);
};
for (const c of CONTRACTS) {
  const artifact = JSON.parse(readFileSync(new URL(c.artifact, import.meta.url), 'utf8'));
  const record = JSON.parse(readFileSync(new URL(c.record, import.meta.url), 'utf8'));
  const now = artifact.deployedBytecode.toLowerCase();
  const then = String(record.deployedBytecode).toLowerCase();
  if (now !== then) {
    let at = 0;
    while (at < Math.min(now.length, then.length) && now[at] === then[at]) at += 1;
    refuse(artifact.contractName, `the committed record (commit ${String(record.commit).slice(0, 10)}) is NOT this source's bytecode: lengths ${(now.length - 2) / 2} vs ${(then.length - 2) / 2} bytes, first difference at byte ${Math.floor((at - 2) / 2)}`);
    continue;
  }
  if ((artifact.contractName === 'CompanySeries' || record.creationBytecode !== undefined) && record.creationBytecode?.toLowerCase() !== artifact.bytecode.toLowerCase()) {
    refuse(artifact.contractName, 'the recorded creation bytecode differs from the compiled artifact or is missing');
    continue;
  }
  // The slots, by the names the site reads: the artifact's references keyed by AST id must map, in order, to the record's named slots.
  const slotsNow = Object.entries(artifact.immutableReferences)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, slots]) => slots.map((s) => `${s.start}:${s.length}`).sort().join('+'));
  const recorded = Array.isArray(record.immutables) ? record.immutables : [];
  const slotsRecorded = recorded.map((im) => im.slots.map((s) => `${s.start}:${s.length}`).sort().join('+'));
  const namesRecorded = recorded.map((im) => im.name);
  if (namesRecorded.join(',') !== c.names.join(',')) {
    refuse(artifact.contractName, `the record's immutables are named ${namesRecorded.join(', ') || 'nothing'}, not ${c.names.join(', ')}`);
    continue;
  }
  if (slotsNow.join('|') !== slotsRecorded.join('|')) {
    refuse(artifact.contractName, 'the immutable slots differ from the artifact');
    continue;
  }
  if (record.workingTreeClean !== true || typeof record.sourceCommit !== 'string' || !/^[0-9a-f]{40}$/.test(record.sourceCommit)) {
    refuse(artifact.contractName, 'the record was written from a dirty tree or names no source commit');
    continue;
  }
  try { assertRecordedSourceCommit(record, currentSourceCommit(`../src/${artifact.contractName}.sol`)); }
  catch (cause) { refuse(artifact.contractName, cause.message); continue; }
  console.error(`${artifact.contractName}: the committed record (source at ${record.sourceCommit.slice(0, 10)}, recorded at ${String(record.commit).slice(0, 10)}) is this source's bytecode, slots ${c.names.join(', ')}`);
}
process.exit(failed ? 1 : 0);
