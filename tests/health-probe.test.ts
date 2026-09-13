import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { it } from 'node:test';
import { AGENTS } from '../lib/agents/registry.ts';
import { assessHealth, healthTarget, probeHealth, HEALTH_MAX_AGE_MS, HEALTH_CLOCK_SKEW_MS } from '../lib/ops/health-probe.ts';

const NOW = new Date('2026-09-13T12:00:00.000Z');
const good = (now = NOW) => ({
  state: 'READ', observedAt: now.toISOString(), warden: { reportingLastHour: 2 }, storeSchema: { state: 'CURRENT', detail: null }, conditions: [],
  agents: AGENTS.map(a => ({ id: a.id, health: a.intervalSeconds === null ? 'ON_REQUEST' : 'LIVE' })),
});
it('accepts a complete fresh operational reading without requiring idle on-request agents to run', () => {
  const result = assessHealth(good(), NOW);
  assert.equal(result.state, 'HEALTHY'); assert.deepEqual(result.reasons, []);
  assert.deepEqual(result.freshness, { maxAgeSeconds: 120, allowedClockSkewSeconds: 30 });
});
it('fails closed for missing fields and non-finite, nonpositive or fractional last-hour counts', () => {
  for (const field of ['state', 'observedAt', 'warden', 'storeSchema', 'conditions', 'agents']) {
    const value: Record<string, unknown> = good(); delete value[field];
    assert.equal(assessHealth(value, NOW).state, 'UNHEALTHY', field);
  }
  for (const reportingLastHour of [undefined, null, '2', 0, -1, 0.5, NaN, Infinity, AGENTS.length + 1]) {
    assert.equal(assessHealth({ ...good(), warden: { reportingLastHour } }, NOW).state, 'UNHEALTHY', String(reportingLastHour));
  }
  for (const raw of [null, [], 'READ', 123]) assert.equal(assessHealth(raw, NOW).state, 'UNHEALTHY');
});
it('rejects stale or malformed response times and states the small permitted clock skew explicitly', () => {
  const at = (offset: number) => ({ ...good(), observedAt: new Date(NOW.getTime() + offset).toISOString() });
  assert.equal(assessHealth(at(-HEALTH_MAX_AGE_MS), NOW).state, 'HEALTHY');
  assert.equal(assessHealth(at(-HEALTH_MAX_AGE_MS - 1), NOW).state, 'UNHEALTHY');
  assert.equal(assessHealth(at(HEALTH_CLOCK_SKEW_MS), NOW).state, 'HEALTHY');
  assert.equal(assessHealth(at(HEALTH_CLOCK_SKEW_MS + 1), NOW).state, 'UNHEALTHY');
  for (const observedAt of ['not-a-date', null, '2026-02-30T12:00:00.000Z']) assert.equal(assessHealth({ ...good(), observedAt }, NOW).state, 'UNHEALTHY');
});
it('rejects unread store, behind schema, DARK conditions and malformed condition arrays', () => {
  for (const value of [
    { ...good(), state: 'STORE_UNREADABLE' }, { ...good(), storeSchema: { state: 'BEHIND' } },
    { ...good(), conditions: [{ id: 'outage', severity: 'DARK', text: 'not copied into probe output' }] },
    { ...good(), conditions: null }, { ...good(), conditions: [{}] },
    { ...good(), conditions: [{ id: 'bad', severity: 'nonsense', text: '' }] },
  ]) assert.equal(assessHealth(value, NOW).state, 'UNHEALTHY');
});
it('rejects missing, duplicate, malformed, absent and never-observed scheduled agents', () => {
  const value = good();
  const scheduled = AGENTS.findIndex(a => a.intervalSeconds !== null);
  for (const health of ['ABSENT', 'NOT_OBSERVED', 'ON_REQUEST', 'unknown']) {
    const agents = value.agents.map((a, i) => i === scheduled ? { ...a, health } : a);
    assert.equal(assessHealth({ ...value, agents }, NOW).state, 'UNHEALTHY', health);
  }
  for (const agents of [[], value.agents.slice(1), [...value.agents, value.agents[0]], [{}]]) assert.equal(assessHealth({ ...value, agents }, NOW).state, 'UNHEALTHY');
});
it('allows public HTTPS and loopback HTTP, safely converts the legacy tick path and refuses other protocols', () => {
  assert.equal(healthTarget('https://curb.example/api/tick?credential=hidden').pathname, '/api/state');
  assert.equal(healthTarget('http://127.0.0.1:3000/').pathname, '/api/state');
  assert.equal(healthTarget('http://[::1]:3000/api/state').hostname, '[::1]');
  for (const url of ['http://curb.example/api/state', 'file:///api/state', 'https://name:secret@curb.example/api/state', 'https://curb.example/api/tick/extra']) assert.throws(() => healthTarget(url));
});
it('turns HTTP errors, non-JSON, malformed JSON, excessive bodies and thrown errors into safe failures', async () => {
  const secret = 'do-not-print-this-query-value';
  const responses = [new Response(secret, { status: 503 }), new Response(secret), new Response(secret, { headers: { 'content-type': 'application/json' } }), new Response('x'.repeat(1_048_577), { headers: { 'content-type': 'application/json' } })];
  for (const response of responses) {
    const result = await probeHealth(`https://curb.example/api/state?key=${secret}`, { now: () => NOW, fetcher: (async () => response) as typeof fetch });
    assert.equal(result.state, 'UNHEALTHY'); assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  }
  const failed = await probeHealth(`https://curb.example/api/state?key=${secret}`, { fetcher: (async () => { throw new Error(secret); }) as typeof fetch });
  assert.equal(failed.state, 'UNHEALTHY'); assert.doesNotMatch(JSON.stringify(failed), new RegExp(secret));
});
it('uses one real read-only loopback GET, refuses redirects and times out without exposing credentials', async () => {
  let mode: 'good' | 'redirect' | 'hang' = 'good';
  let requests = 0;
  const server = createServer((req, res) => {
    requests += 1; assert.equal(req.method, 'GET');
    if (req.url === '/redirect-target?key=hidden') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(good())); return; }
    assert.equal(req.url, '/api/state?key=hidden');
    if (mode === 'hang') return;
    if (mode === 'redirect') { res.writeHead(302, { location: '/redirect-target?key=hidden' }); res.end(); return; }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(good()));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/state?key=hidden`;
  try {
    assert.equal((await probeHealth(url, { now: () => NOW })).state, 'HEALTHY');
    assert.equal(requests, 1);
    mode = 'redirect';
    const redirected = await probeHealth(url, { now: () => NOW });
    assert.equal(redirected.state, 'UNHEALTHY'); assert.match(redirected.reasons.join(' '), /redirect/);
    assert.equal(requests, 2, 'the local redirect target was not requested');
    mode = 'hang';
    const timedOut = await probeHealth(url, { timeoutMs: 40 });
    assert.equal(timedOut.state, 'UNHEALTHY'); assert.match(timedOut.reasons.join(' '), /timed out/);
    assert.doesNotMatch(JSON.stringify({ redirected, timedOut }), /hidden/);
    // Under concurrent full-suite load the timeout may expire before the GET
    // reaches this server. Both connect-time and body-time expiry are valid;
    // no retry or additional request may be made in either case.
    assert.ok(requests === 2 || requests === 3, 'the timed-out probe made at most one request');
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
it('the CLI accepts an environment URL, returns a failure exit code and never prints its query', async () => {
  let healthy = true;
  const server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(healthy ? good(new Date()) : { state: 'READ' })); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const script = fileURLToPath(new URL('../scripts/check-health.ts', import.meta.url));
  const env = { NODE_ENV: 'test' as const, SystemRoot: process.env.SystemRoot ?? 'C:/Windows', CURB_HEALTH_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/tick?key=never-print-me` };
  const run = () => new Promise<{ code: number; stdout: string; stderr: string }>(resolve => execFile(process.execPath, [script], { env, timeout: 10_000, encoding: 'utf8' }, (error, stdout, stderr) => resolve({ code: typeof error?.code === 'number' ? error.code : error ? -1 : 0, stdout, stderr })));
  try {
    const ok = await run(); assert.equal(ok.code, 0); assert.equal(JSON.parse(ok.stdout).state, 'HEALTHY');
    healthy = false; const no = await run(); assert.equal(no.code, 1); assert.equal(JSON.parse(no.stdout).state, 'UNHEALTHY');
    assert.doesNotMatch(ok.stdout + ok.stderr + no.stdout + no.stderr, /never-print-me/);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
