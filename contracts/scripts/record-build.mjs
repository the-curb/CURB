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
 * The immutables' names come from the compiler's own AST, by node id, not
 * from an assumed declaration order. A record is written from a clean tree
 * only, so its `sourceCommit` — the last commit that changed the source or
 * the compiler settings — is the commit that compiles to these bytes;
 * `--allow-dirty` writes one anyway, with `sourceCommit` null, for a local
 * rehearsal, and the checks refuse such a record.
 *
 *   npm run build && node scripts/record-build.mjs [--allow-dirty]
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Everything is resolved from this file, the git checks included: the record must not depend on where the script was run from.
const here = fileURLToPath(new URL('.', import.meta.url));
const allowDirty = process.argv.includes('--allow-dirty');

const config = readFileSync(new URL('../hardhat.config.ts', import.meta.url), 'utf8');
const solc = /version:\s*"([0-9.]+)"/.exec(config)?.[1] ?? null;
const commit = execSync('git rev-parse HEAD', { encoding: 'utf8', cwd: here }).trim();
// A shallow clone answers HEAD for "the last commit that touched this file": the record would name a commit that did not change the source.
if (execSync('git rev-parse --is-shallow-repository', { encoding: 'utf8', cwd: here }).trim() === 'true') {
  console.error('refused: this is a shallow clone, so the commit that last changed the source cannot be known; fetch the full history (fetch-depth: 0) and run again');
  process.exit(1);
}
const dirty = execSync('git status --porcelain -- ../src ../hardhat.config.ts', { encoding: 'utf8', cwd: here }).trim().length > 0;
if (dirty && !allowDirty) {
  console.error('refused: contracts/src or hardhat.config.ts has uncommitted changes; a record names the commit that compiles to its bytes, so commit first (or --allow-dirty for a local rehearsal, which the checks refuse)');
  process.exit(1);
}

const CONTRACTS = [
  { artifact: '../artifacts/src/CompanySeries.sol/CompanySeries.json', source: '../src/CompanySeries.sol', names: ['componentA', 'componentB', 'qA', 'qB', 'capLots'], out: '../evidence/CompanySeries.build.json' },
  { artifact: '../artifacts/src/CreditDesk.sol/CreditDesk.json', source: '../src/CreditDesk.sol', names: ['curb', 'treasury'], out: '../evidence/CreditDesk.build.json' },
];

/** Every immutable the compiler's AST declares in a source, by node id. */
function immutableNames(buildInfoId, inputSourceName) {
  const out = JSON.parse(readFileSync(new URL(`../artifacts/build-info/${buildInfoId}.output.json`, import.meta.url), 'utf8'));
  const ast = out.output.sources[inputSourceName]?.ast;
  if (!ast) throw new Error(`no AST for ${inputSourceName} in build-info ${buildInfoId}`);
  const found = new Map();
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (n.nodeType === 'VariableDeclaration' && n.mutability === 'immutable') found.set(String(n.id), n.name);
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') walk(v);
    }
  })(ast);
  return found;
}

for (const c of CONTRACTS) {
  const artifact = JSON.parse(readFileSync(new URL(c.artifact, import.meta.url), 'utf8'));
  const byId = immutableNames(artifact.buildInfoId, artifact.inputSourceName);
  const refs = Object.entries(artifact.immutableReferences).sort(([a], [b]) => Number(a) - Number(b));
  if (refs.length !== c.names.length) throw new Error(`${artifact.contractName}: expected ${c.names.length} immutables, the artifact has ${refs.length}`);
  const immutables = refs.map(([id, slots]) => {
    const name = byId.get(id);
    if (name === undefined) throw new Error(`${artifact.contractName}: immutable node ${id} is not in the AST`);
    if (!c.names.includes(name)) throw new Error(`${artifact.contractName}: the AST names an immutable "${name}" this recorder does not expect (${c.names.join(', ')})`);
    return { name, astId: Number(id), slots: slots.map((s) => ({ start: s.start, length: s.length })) };
  });
  const named = immutables.map((im) => im.name);
  if (named.join(',') !== c.names.join(',')) throw new Error(`${artifact.contractName}: the immutables are ${named.join(', ')} in the AST, not ${c.names.join(', ')}`);
  // The commit that last changed the source (and the compiler setting) is what a deployment is "the build at": it does not move when the record is merely re-run.
  const sourceCommit = dirty ? null : execSync(`git log -1 --format=%H -- ${c.source} ../hardhat.config.ts`, { encoding: 'utf8', cwd: here }).trim();
  const record = {
    contract: artifact.contractName,
    source: artifact.sourceName,
    solc,
    commit,
    sourceCommit,
    workingTreeClean: !dirty,
    recordedAt: new Date().toISOString(),
    deployedBytecode: artifact.deployedBytecode,
    immutables,
    note: 'runtime bytecode as compiled; a deployment matches when its code equals this outside the immutable slots and the slots hold the reviewed record’s values',
  };
  writeFileSync(new URL(c.out, import.meta.url), `${JSON.stringify(record, null, 2)}\n`);
  console.error(`recorded ${artifact.contractName} runtime bytecode (${(artifact.deployedBytecode.length - 2) / 2} bytes, ${immutables.length} immutables: ${named.join(', ')}) at ${commit.slice(0, 10)}${dirty ? ' from a dirty tree (sourceCommit null)' : ` from source at ${sourceCommit.slice(0, 10)}`}`);
}
