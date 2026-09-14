#!/usr/bin/env node
/**
 * Repeatable local production-HTTP rehearsal. Node 24+, installed dependencies,
 * and a disposable loopback PostgreSQL server with CREATEDB permission required.
 * No .env file is loaded; no private signing key is needed. The runner creates
 * and drops only its own randomly named database and owns every child it stops.
 * Build tools may fetch their compiler/fonts; app/payment/webhook traffic is local.
 */
import { createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptance } from './rehearsal-acceptance.mjs';
import { creditToolFixture } from './rehearsal-credit-tool.mjs';
import { assertOwnedDatabase, copySource, isolatedEnvironment, linkDependencies, localUrl, requireDependencies, scrubLog, unusedPort } from './rehearsal-safety.mjs';

const HELP = 'Usage: node scripts/rehearsal-local.mjs --postgres-url postgres://USER@127.0.0.1:PORT/postgres?sslmode=disable [--out report.json] [--failure-drill]\nCreates a fresh disposable database, local Hardhat31337 node and sanitized Next production build. Stops owned processes and drops its database even on failure. No public transactions or .env files. --failure-drill intentionally fails after creating the owned database to exercise cleanup.';
if (Number(process.versions.node.split('.')[0]) < 24) { console.error('The local rehearsal requires Node 24 or newer for native TypeScript execution.'); process.exit(2); }
const args = process.argv.slice(2);
if (args.length === 1 && ['--help', '-h'].includes(args[0])) { console.log(HELP); process.exit(0); }
const options = {};
for (let i = 0; i < args.length; i += 1) {
  const flag = args[i];
  if (flag === '--failure-drill' && !options[flag]) { options[flag] = true; continue; }
  const value = args[++i];
  if (!['--postgres-url', '--out'].includes(flag) || !value || options[flag]) { console.error(HELP); process.exit(2); }
  options[flag] = value;
}
let adminUrl;
try { adminUrl = localUrl(options['--postgres-url'], 'postgres'); } catch (error) { console.error(scrubLog(error.message)); console.error(HELP); process.exit(2); }
// Native entrypoint imports only Node and CLI helpers before removing ambient config.
const clean = isolatedEnvironment();
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, clean);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
requireDependencies(root);
const scratch = path.join(root, '.scratch');
mkdirSync(scratch, { recursive: true });
const runDirectory = mkdtempSync(path.join(scratch, 'rehearsal-'));
// A sibling avoids copying a tree into itself; source copying never traverses it.
const stage = mkdtempSync(path.join(path.dirname(root), '.curb-rehearsal-'));
const reportPath = options['--out'] ? path.resolve(options['--out']) : path.join(runDirectory, 'report.json');
const databaseName = `curb_rehearsal_${randomBytes(12).toString('hex')}`;
assertOwnedDatabase(databaseName);
const databaseUrl = new URL(adminUrl.href);
databaseUrl.pathname = `/${databaseName}`;
const children = new Set();
const aborted = new AbortController();
const interrupt = () => { aborted.abort(); for (const child of children) child.kill(); };
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
const startedAt = new Date().toISOString();
const git = (...arguments_) => spawnSync('git', arguments_, { cwd: root, env: clean, encoding: 'utf8', windowsHide: true }).stdout?.trim() ?? null;
const source = { commit: git('rev-parse', 'HEAD'), workingTreeClean: git('status', '--porcelain') === '', snapshotDirectory: stage, snapshotSha256: null };
let admin, createdDatabase = false, report;

function tracked(args, cwd, env = clean, { discardOutput = false } = {}) {
  const child = spawn(process.execPath, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { if (!discardOutput && stdout.length < 16_777_216) stdout += data; });
  child.stderr.on('data', data => { if (!discardOutput && stderr.length < 16_777_216) stderr += data; });
  const done = new Promise(resolve => {
    child.once('error', error => resolve({ code: 1, stdout, stderr: `${stderr}\n${error.message}` }));
    child.once('close', code => { children.delete(child); resolve({ code, stdout, stderr }); });
  });
  return { child, done };
}

async function run(label, args, cwd, env = clean, json = false, expectFailure = false) {
  if (aborted.signal.aborted) throw new Error('Rehearsal interrupted');
  console.log(label);
  const process_ = tracked(args, cwd, env);
  const timer = setTimeout(() => process_.child.kill(), 300_000);
  const result = await process_.done;
  clearTimeout(timer);
  let logged = scrubLog(json ? result.stderr : `${result.stdout}\n${result.stderr}`);
  if (env.DEPLOYER_PRIVATE_KEY) logged = logged.replaceAll(env.DEPLOYER_PRIVATE_KEY, '[REDACTED EPHEMERAL SIGNER]');
  writeFileSync(path.join(runDirectory, `${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.txt`), logged);
  if (expectFailure ? result.code === 0 : result.code !== 0) throw new Error(`${label} had an unexpected exit status; inspect the redacted log in ${runDirectory}`);
  if (!json) return result;
  try { return JSON.parse(result.stdout); } catch { throw new Error(`${label} did not return the expected JSON record`); }
}

async function waitReady(test, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (aborted.signal.aborted || child.exitCode !== null || child.signalCode !== null) throw new Error('Local service stopped before it became ready');
    try { if (await test()) return; } catch { /* Startup polling is read-only and loopback. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Local service did not become ready before its deadline');
}

function snapshotDigest(directory) {
  const hash = createHash('sha256');
  const walk = at => {
    for (const entry of readdirSync(at, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) { hash.update(path.relative(directory, full).replaceAll('\\', '/')); hash.update('\0'); hash.update(readFileSync(full)); hash.update('\0'); }
    }
  };
  walk(directory);
  return hash.digest('hex');
}

try {
  console.log('Create sanitized source snapshot (environment files excluded)');
  copySource(root, stage);
  source.snapshotSha256 = snapshotDigest(stage);
  linkDependencies(path.join(root, 'node_modules'), path.join(stage, 'node_modules'));
  linkDependencies(path.join(root, 'contracts/node_modules'), path.join(stage, 'contracts/node_modules'));
  const { default: postgres } = await import('postgres');
  admin = postgres(adminUrl.href, { max: 1, prepare: false, connect_timeout: 5, ssl: false, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${databaseName}`);
  createdDatabase = true;
  console.log('Created one disposable rehearsal database');
  if (options['--failure-drill']) throw new Error('Intentional failure drill after creating the owned disposable database');
  await run('Compile mock and production contracts', ['node_modules/hardhat/dist/src/cli.js', 'build'], path.join(stage, 'contracts'));
  const rpcPort = await unusedPort(), rpcUrl = `http://127.0.0.1:${rpcPort}`;
  // Hardhat prints its public test private keys at startup. Discard all node output.
  const chain = tracked(['node_modules/hardhat/dist/src/cli.js', 'node', '--hostname', '127.0.0.1', '--port', String(rpcPort)], path.join(stage, 'contracts'), clean, { discardOutput: true });
  await waitReady(async () => {
    const response = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }), redirect: 'error', signal: AbortSignal.timeout(1_000) });
    return (await response.json()).result === '0x7a69';
  }, chain.child, 30_000);
  const local = { ...clean, REHEARSAL_RPC_URL: rpcUrl, CURB_RPC_URL_LOCAL: rpcUrl };
  const deployments = await run('Deploy fresh position mocks and run worked example', ['scripts/rehearsal.ts'], path.join(stage, 'contracts'), local, true);
  const drill = await run('Run local chain incident drill', ['scripts/drill.ts'], path.join(stage, 'contracts'), local, true);
  // Keep this fixture last: its assertion deliberately observes the old pool
  // price inside the local guard's 40-block window. The drill mines >40 blocks.
  const fixture = await run('Deploy fresh credit mocks and pay local top-ups', ['scripts/credits-rehearsal.ts'], path.join(stage, 'contracts'), local, true);
  const desk = await creditToolFixture({ stage, rpcUrl, fixture, localEnv: local, run });
  const testEnv = { ...local, CURB_POSTGRES_URL: databaseUrl.href, CURB_REHEARSAL_CREDITS: JSON.stringify(fixture), CURB_REHEARSAL_DEPLOYMENTS: JSON.stringify(deployments), CURB_DRILL_RECORD: JSON.stringify(drill), CURB_REHEARSAL_DESK_ENV: JSON.stringify(desk.config) };
  const tested = await run('Run complete application suite with every local fixture', ['--test', '--test-reporter=tap', 'tests/*.test.ts'], stage, testEnv);
  const count = name => Number(new RegExp(`^# ${name} (\\d+)$`, 'm').exec(tested.stdout)?.[1] ?? NaN);
  const suite = { tests: count('tests'), passed: count('pass'), failed: count('fail'), skipped: count('skipped') };
  if (!Number.isInteger(suite.tests) || suite.tests === 0 || suite.passed !== suite.tests || suite.failed !== 0 || suite.skipped !== 0) throw new Error('The complete application suite did not pass every test without skips');
  await run('Build sanitized production Next application', ['node_modules/next/dist/bin/next', 'build'], stage);
  const appPort = await unusedPort(), base = `http://127.0.0.1:${appPort}`;
  const appEnv = { ...local, CURB_POSTGRES_URL: databaseUrl.href, CURB_CREDITS: JSON.stringify(fixture.credits), CURB_SERIES_DEPLOYMENTS: JSON.stringify(deployments), CURB_POSITIONS_NETWORK: 'hardhat-local' };
  const app = tracked(['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(appPort)], stage, appEnv);
  await waitReady(async () => (await fetch(`${base}/api/subscriptions`, { redirect: 'error', signal: AbortSignal.timeout(2_000) })).status === 401, app.child, 30_000);
  console.log('Verify real HTTP, on-chain indexing, Postgres debits and local webhook delivery');
  const result = await acceptance({ stage, base, databaseUrl: databaseUrl.href, rpcUrl, fixture, deployments });
  report = { state: 'PASSED', startedAt, completedAt: new Date().toISOString(), source, ...result, suite, creditTool: desk.verification, localOnly: true, services: { next: base, chain: rpcUrl, chainId: 31337, database: databaseName }, logs: runDirectory, cleanup: null };
} catch (error) {
  report = { state: 'FAILED', startedAt, completedAt: new Date().toISOString(), source, error: scrubLog(error instanceof Error ? error.message : error), failureDrillRequested: options['--failure-drill'] === true, localOnly: true, logs: runDirectory, cleanup: null };
  process.exitCode = 1;
} finally {
  // Stop only process objects created in this invocation, never a port scan or name kill.
  const owned = [...children];
  for (const child of owned) child.kill();
  await Promise.all(owned.map(child => new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5_000);
    child.once('close', () => { clearTimeout(timer); resolve(); });
  })));
  let databaseDropped = !createdDatabase;
  try {
    if (createdDatabase) { assertOwnedDatabase(databaseName); await admin.unsafe(`DROP DATABASE ${databaseName} WITH (FORCE)`); databaseDropped = true; }
  } catch (error) { report.cleanupError = scrubLog(error instanceof Error ? error.message : error); process.exitCode = 1; }
  if (admin) await admin.end({ timeout: 5 });
  report.cleanup = { ownedProcessesStopped: owned.every(child => child.exitCode !== null || child.signalCode !== null), disposableDatabaseDropped: databaseDropped };
  if (!report.cleanup.ownedProcessesStopped || !databaseDropped) { report.state = 'FAILED'; process.exitCode = 1; }
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${report.state}: ${report.passed ?? 0} acceptance checks. Report: ${reportPath}`);
  if (report.error) console.error(report.error);
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
}
