/**
 * Record the compiled contracts for the site to verify deployments against
 * (blueprint G02, the contract verification procedure): the runtime
 * bytecode the compiler produced, where each immutable sits in it, the
 * compiler version and the commit. One record per contract:
 *
 *   evidence/CompanySeries.build.json — the series (five immutables)
 *   evidence/CreditDesk.build.json    — the credit desk (two immutables)
 *
 * A deployed contract matches when its code equals this bytecode everywhere
 * but the immutable slots, and the immutable slots hold exactly what the
 * reviewed record says. Neither Etherscan nor anyone's word is needed for
 * that; the site does it on every tick.
 *
 *   npm run build && node scripts/record-build.mjs
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const config = readFileSync(new URL('../hardhat.config.ts', import.meta.url), 'utf8');
const solc = /version:\s*"([0-9.]+)"/.exec(config)?.[1] ?? null;
const commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
const dirty = execSync('git status --porcelain -- src hardhat.config.ts', { encoding: 'utf8' }).trim().length > 0;

// Immutables in declaration order: AST ids rise with source position, and
// each contract declares exactly these, in this order.
const CONTRACTS = [
  { artifact: '../artifacts/src/CompanySeries.sol/CompanySeries.json', names: ['componentA', 'componentB', 'qA', 'qB', 'capLots'], out: '../evidence/CompanySeries.build.json' },
  { artifact: '../artifacts/src/CreditDesk.sol/CreditDesk.json', names: ['curb', 'treasury'], out: '../evidence/CreditDesk.build.json' },
];

for (const c of CONTRACTS) {
  const artifact = JSON.parse(readFileSync(new URL(c.artifact, import.meta.url), 'utf8'));
  const refs = Object.entries(artifact.immutableReferences).sort(([a], [b]) => Number(a) - Number(b));
  if (refs.length !== c.names.length) throw new Error(`${artifact.contractName}: expected ${c.names.length} immutables, the artifact has ${refs.length}`);
  const immutables = refs.map(([id, slots], i) => ({ name: c.names[i], astId: Number(id), slots: slots.map((s) => ({ start: s.start, length: s.length })) }));
  const record = {
    contract: artifact.contractName,
    source: artifact.sourceName,
    solc,
    commit,
    workingTreeClean: !dirty,
    recordedAt: new Date().toISOString(),
    deployedBytecode: artifact.deployedBytecode,
    immutables,
    note: 'runtime bytecode as compiled; a deployment matches when its code equals this outside the immutable slots and the slots hold the reviewed record’s values',
  };
  writeFileSync(new URL(c.out, import.meta.url), `${JSON.stringify(record, null, 2)}\n`);
  console.error(`recorded ${artifact.contractName} runtime bytecode (${(artifact.deployedBytecode.length - 2) / 2} bytes, ${immutables.length} immutables) at ${commit.slice(0, 10)}`);
}
