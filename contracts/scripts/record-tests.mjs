/**
 * Run the unit tests and record the run (blueprint C07: the seed, the
 * results and the commit): evidence/unit-tests.json. A green run is a
 * fact about this commit with this seed and these runs, nothing more.
 *
 *   node scripts/record-tests.mjs
 */
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const config = readFileSync(new URL('../hardhat.config.ts', import.meta.url), 'utf8');
const seed = /seed:\s*"(0x[0-9a-f]+)"/.exec(config)?.[1] ?? null;
const runs = Number(/fuzz:\s*\{[^}]*runs:\s*(\d+)/.exec(config)?.[1] ?? NaN);
const invariant = { runs: Number(/invariant:\s*\{[^}]*runs:\s*(\d+)/.exec(config)?.[1] ?? NaN), depth: Number(/invariant:\s*\{[^}]*depth:\s*(\d+)/.exec(config)?.[1] ?? NaN) };
const solc = /version:\s*"([0-9.]+)"/.exec(config)?.[1] ?? null;
const commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
const dirty = execSync('git status --porcelain -- src test hardhat.config.ts', { encoding: 'utf8' }).trim().length > 0;

const run = spawnSync('npx', ['hardhat', 'test', 'solidity', '--grep-exclude', 'Fork'], { encoding: 'utf8', shell: true });
const out = `${run.stdout}\n${run.stderr}`;
// Keep the raw evidence from this same execution available to a release log.
process.stdout.write(out);
const tests = [...out.matchAll(/^\s+(✔|✖|\d+\))\s+((?:test|invariant)[A-Za-z0-9_]*\([^)]*\))(?:\s+\(runs:\s*(\d+)\))?/gm)].map((m) => ({
  name: m[2],
  passed: m[1] === '✔',
  fuzzRuns: m[3] ? Number(m[3]) : null,
}));
const passing = Number(/(\d+) passing/.exec(out)?.[1] ?? 0);
const failing = Number(/(\d+) failing/.exec(out)?.[1] ?? 0);

const record = {
  ranAt: new Date().toISOString(),
  commit,
  workingTreeClean: !dirty,
  solc,
  fuzz: { seed, runs },
  invariant,
  command: 'hardhat test solidity --grep-exclude Fork',
  passing,
  failing,
  tests,
  limit: `a passing run is not a review and not an audit; it says these cases held ${dirty ? 'in the modified contract working tree based on this commit' : 'at this commit'} with this seed`,
};
writeFileSync(new URL('../evidence/unit-tests.json', import.meta.url), `${JSON.stringify(record, null, 2)}\n`);
console.error(`recorded ${passing} passing, ${failing} failing at ${commit.slice(0, 10)} (seed ${seed?.slice(0, 10)}…, ${runs} runs)`);
process.exit(run.status ?? 1);
