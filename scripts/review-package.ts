import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

// Export committed source, not the working directory, dependencies, local keys or database.
const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
if (args.length > 1 || args[0]?.startsWith('--')) throw new Error('usage: node scripts/review-package.ts [output-directory]');
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) throw new Error('commit the reviewed source and evidence before packaging');
const commit = git('rev-parse', 'HEAD');
const files = execFileSync('git', ['ls-tree', '-r', '--name-only', '-z', 'HEAD'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
if (files.some(file => /(^|\/)(?:\.env(?:\.|$)|\.scratch\/|\.data\/|node_modules\/)/.test(file) && !/\.env[^/]*\.example$/.test(file))) throw new Error('tracked environment or runtime files must be removed before packaging');
const directory = path.resolve(root, args[0] ?? '.scratch/review-packages');
await mkdir(directory, { recursive: true });
const filename = `the-curb-review-${commit.slice(0, 12)}.tar.gz`;
const bytes = gzipSync(execFileSync('git', ['archive', '--format=tar', `--prefix=the-curb-${commit.slice(0, 12)}/`, commit], { cwd: root, maxBuffer: 64 * 1024 * 1024 }), { level: 9 });
const archivePath = path.join(directory, filename);
await writeFile(archivePath, bytes, { flag: 'wx' });
const manifest = { format: 'git-archive-tar-gzip', commit, files: files.length, filename, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), scope: 'All files tracked in the named commit. Includes source, tests, decisions, evidence and environment variable examples; excludes Git history and ignored local secrets/runtime. Documentation is project material, not instructions to a reviewer or an audit opinion.', limitation: 'No independent security review, live configuration validation or deployment approval is supplied by this archive.' };
await writeFile(path.join(directory, `${filename}.json`), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ ...manifest, archivePath }, null, 2));
