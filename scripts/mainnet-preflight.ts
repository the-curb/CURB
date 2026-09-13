import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assessReadiness } from '../lib/release/readiness.ts';
import { GATES } from '../lib/positions/series.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length > 1 || args[0]?.startsWith('--')) throw new Error('usage: node scripts/mainnet-preflight.ts [readiness-record.json]');
const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0');
const files = [...new Set(listed)].filter(p => /^(?:app\/|lib\/|public\/|scripts\/|tests\/|contracts\/(?:src|scripts|test)\/|docs\/decisions\/|\.github\/workflows\/)/.test(p) || /^(?:[^/]+\.md|package(?:-lock)?\.json|postcss\.config\.mjs|next\.config\.ts|tsconfig\.json|vercel\.json|contracts\/(?:package(?:-lock)?\.json|hardhat\.config\.ts)|contracts\/evidence\/(?:[^/]+\.(?:build|fork|corporate-action)\.json|drill-local\.json|unit-tests\.json|safes\/[^/]+\.json))$/.test(p)).sort();
const digest = createHash('sha256');
for (const file of files) {
  const raw = await readFile(path.join(root, file));
  const bytes = /\.(?:[cm]?[jt]sx?|json|md|ya?ml|css|svg|html|sol|txt)$/.test(file) ? raw.toString('utf8').replace(/\r\n/g, '\n') : raw;
  digest.update(file); digest.update('\0'); digest.update(bytes); digest.update('\0');
}
const sourceDigest = digest.digest('hex');
const evidenceHash = async (file: string) => {
  try {
    if (!/^(?:docs\/(?:mainnet|reviews)|contracts\/evidence)\/[A-Za-z0-9_./-]+\.(?:json|md|txt|pdf)$/.test(file) || file.split('/').includes('..')) return null;
    const resolved = await realpath(path.resolve(root, file));
    const relative = path.relative(await realpath(root), resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return createHash('sha256').update(await readFile(resolved)).digest('hex');
  } catch { return null; }
};
let raw: unknown = null;
let recordError: string | null = null;
try { raw = JSON.parse(await readFile(path.resolve(root, args[0] ?? 'docs/mainnet/readiness.example.json'), 'utf8')); }
catch { recordError = 'readiness file unavailable or invalid JSON'; }
const report = await assessReadiness(raw, sourceDigest, evidenceHash);
const clean = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, encoding: 'utf8' }).trim().length === 0;
const sourceGates = GATES.map(g => ({ id: g.id, status: g.status }));
const positionHeld = sourceGates.some(g => g.status !== 'PASSED');
const phases = report.phases.map(p => ({ ...p, state: !clean || recordError || (p.phase === 'position-pilot' && positionHeld) ? 'HELD' : p.state }));
console.log(JSON.stringify({ ...report, phases, recordError, releaseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), workingTreeClean: clean, sourceFiles: files.length, sourceGates, localHold: !clean ? 'Review and commit the release; local modifications are not a pinned release.' : null }, null, 2));
process.exitCode = phases.some(p => p.state === 'HELD') ? 2 : 0;
