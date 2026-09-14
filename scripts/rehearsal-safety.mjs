import { createServer } from 'node:net';
import { cpSync, existsSync, linkSync, mkdirSync, readdirSync, realpathSync, symlinkSync } from 'node:fs';
import path from 'node:path';

// Explicit numeric loopback avoids DNS rebinding and unusual localhost aliases.
const LOOPBACK = new Set(['127.0.0.1', '[::1]']);
export function localUrl(raw, kind = 'http') {
  let url;
  try { url = new URL(raw); } catch { throw new Error(`Invalid ${kind} rehearsal URL`); }
  const protocols = kind === 'postgres' ? ['postgres:', 'postgresql:'] : ['http:'];
  if (!protocols.includes(url.protocol) || !LOOPBACK.has(url.hostname) || url.hash) {
    throw new Error(`${kind} rehearsal URL must use an explicit numeric loopback address`);
  }
  if (kind !== 'postgres' && (url.username || url.password || url.search || url.pathname !== '/')) {
    throw new Error('HTTP rehearsal URL must be an uncredentialed loopback origin');
  }
  if (kind === 'postgres') {
    for (const [key, value] of url.searchParams) {
      // Reject host/service/options overrides: the URL host must be the actual server.
      if (key !== 'sslmode' || value !== 'disable') throw new Error('Local Postgres accepts only sslmode=disable');
    }
    url.search = '?sslmode=disable';
  }
  return url;
}

const OS_ENV = /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|LANG|LC_ALL|TERM|NO_COLOR|CI)$/i;
export function isolatedEnvironment(source = process.env) {
  return { ...Object.fromEntries(Object.entries(source).filter(([key, value]) => OS_ENV.test(key) && value !== undefined)), NEXT_TELEMETRY_DISABLED: '1', NO_COLOR: '1' };
}

export function assertOwnedDatabase(name) {
  if (!/^curb_rehearsal_[a-f0-9]{24}$/.test(name)) throw new Error('Refusing a database not named by this rehearsal');
}

export function scrubLog(value) {
  return String(value)
    .replace(/curb_[A-Za-z0-9_-]{43}/g, '[REDACTED TEST KEY]')
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[REDACTED LOCAL DATABASE URL]');
}

export async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (!address || typeof address === 'string') throw new Error('No local port allocated');
  return address.port;
}

const OMIT = new Set(['.git', '.next', '.scratch', '.data', '.vercel', 'node_modules', 'artifacts', 'cache', 'out']);
export function copySource(root, stage) {
  cpSync(root, stage, { recursive: true, filter: source => {
    const parts = path.relative(root, source).split(path.sep);
    // Historical journals refer to other nodes. Fresh local tooling must start
    // with an empty deployment-journal directory, without removing the originals.
    const historicalDeployments = parts[0] === 'contracts' && parts[1] === 'evidence' && parts[2] === 'deployments';
    return !historicalDeployments && !parts.some(part => OMIT.has(part) || part.startsWith('.env') || part.endsWith('.tsbuildinfo'));
  } });
}

/** Dependencies are read-only inputs. Hard links keep the sanitized copy cheap. */
export function linkDependencies(source, destination, boundary = source) {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name), to = path.join(destination, entry.name);
    if (entry.isDirectory()) linkDependencies(from, to, boundary);
    else if (entry.isFile()) linkSync(from, to);
    else if (entry.isSymbolicLink()) {
      const resolved = realpathSync(from), relative = path.relative(boundary, resolved);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Dependency link escapes its dependency tree');
      const stagedRoot = path.resolve(destination, path.relative(source, boundary));
      symlinkSync(path.join(stagedRoot, relative), to, 'junction');
    } else throw new Error('Unsupported dependency entry');
  }
}

export function requireDependencies(root) {
  for (const relative of ['node_modules/next/dist/bin/next', 'node_modules/postgres/package.json', 'contracts/node_modules/hardhat/dist/src/cli.js']) {
    if (!existsSync(path.join(root, relative))) throw new Error('Install both root and contracts dependencies before running the rehearsal');
  }
}
