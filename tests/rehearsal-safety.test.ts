import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
// @ts-expect-error Standalone CLI helper; imported by native Node without transpilation.
import { assertOwnedDatabase, copySource, isolatedEnvironment, localUrl, scrubLog } from '../scripts/rehearsal-safety.mjs';

describe('local release rehearsal boundaries', () => {
  it('rejects remote, ambiguous, credentialed and redirectable HTTP origins', () => {
    for (const url of ['https://127.0.0.1:8000', 'http://localhost:8000', 'http://example.com', 'http://user:password@127.0.0.1', 'http://127.0.0.1/proxy', 'http://127.0.0.1?target=mainnet', 'http://127.0.0.1#x']) assert.throws(() => localUrl(url));
    assert.equal(localUrl('http://127.0.0.1:8000').origin, 'http://127.0.0.1:8000');
  });
  it('rejects Postgres host/service overrides and refuses existing database names', () => {
    for (const url of ['postgres://u@db.example/db', 'postgres://u@127.0.0.1/db?host=remote', 'postgres://u@127.0.0.1/db?options=-c%20search_path%3Dpublic', 'postgres://u@127.0.0.1/db?service=production']) assert.throws(() => localUrl(url, 'postgres'));
    assert.equal(localUrl('postgres://test@127.0.0.1:54391/postgres', 'postgres').search, '?sslmode=disable');
    assert.throws(() => assertOwnedDatabase('curb_mainnet_test'));
    assert.throws(() => assertOwnedDatabase('curb_rehearsal_a;drop database postgres'));
    assert.doesNotThrow(() => assertOwnedDatabase('curb_rehearsal_0123456789abcdef01234567'));
  });
  it('drops secrets, dotenv loaders and proxy routing from child processes', () => {
    const env = isolatedEnvironment({ PATH: 'test-path', HOME: 'test-home', CURB_POSTGRES_URL: 'production', DEPLOYER_PRIVATE_KEY: 'secret', ANTHROPIC_API_KEY: 'secret', NODE_OPTIONS: '--import dotenv', NODE_PATH: 'elsewhere', HTTP_PROXY: 'remote', HTTPS_PROXY: 'remote', VERCEL: '1', ETH_RPC_URL: 'public' });
    assert.equal(env.PATH, 'test-path');
    assert.equal(env.HOME, 'test-home');
    assert.equal(env.NEXT_TELEMETRY_DISABLED, '1');
    for (const key of ['CURB_POSTGRES_URL', 'DEPLOYER_PRIVATE_KEY', 'ANTHROPIC_API_KEY', 'NODE_OPTIONS', 'NODE_PATH', 'HTTP_PROXY', 'HTTPS_PROXY', 'VERCEL', 'ETH_RPC_URL']) assert.equal(env[key], undefined);
  });
  it('redacts generated API keys and local database credentials in evidence logs', () => {
    const key = `curb_${'A'.repeat(43)}`;
    const log = scrubLog(`failure ${key} postgres://user:localpass@127.0.0.1/test?sslmode=disable`);
    assert.ok(!log.includes(key)); assert.ok(!log.includes('localpass'));
  });
  it('excludes environment files and historical deployment journals without deleting originals', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'curb-rehearsal-copy-'));
    const original = path.join(directory, 'original'), snapshot = path.join(directory, 'snapshot');
    try {
      mkdirSync(path.join(original, 'contracts/evidence/deployments'), { recursive: true });
      writeFileSync(path.join(original, '.env.local'), 'do not copy');
      writeFileSync(path.join(original, 'contracts/.env.production'), 'do not copy');
      writeFileSync(path.join(original, 'contracts/evidence/deployments/credit-desk.31337.json'), 'historical');
      writeFileSync(path.join(original, 'contracts/evidence/CreditDesk.build.json'), 'compiled evidence');
      copySource(original, snapshot);
      assert.equal(existsSync(path.join(snapshot, '.env.local')), false);
      assert.equal(existsSync(path.join(snapshot, 'contracts/.env.production')), false);
      assert.equal(existsSync(path.join(snapshot, 'contracts/evidence/deployments')), false);
      assert.equal(readFileSync(path.join(snapshot, 'contracts/evidence/CreditDesk.build.json'), 'utf8'), 'compiled evidence');
      assert.equal(readFileSync(path.join(original, 'contracts/evidence/deployments/credit-desk.31337.json'), 'utf8'), 'historical');
    } finally {
      assert.ok(path.dirname(directory) === tmpdir() && path.basename(directory).startsWith('curb-rehearsal-copy-'));
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
