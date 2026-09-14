import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { assertOwnedDatabase, localUrl } from './rehearsal-safety.mjs';

/** Used only by the local CLI. Nothing here is imported by the application. */
export async function acceptance({ stage, base, databaseUrl, rpcUrl, fixture, deployments }) {
  localUrl(base); localUrl(rpcUrl);
  const database = localUrl(databaseUrl, 'postgres');
  assertOwnedDatabase(decodeURIComponent(database.pathname.slice(1)));
  assert.equal(fixture.credits.network, 'hardhat-local');
  assert.equal(deployments['apple-s1'].chainId, 31337);
  const rpc = async (method, params = []) => {
    const response = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), redirect: 'error', signal: AbortSignal.timeout(10_000) });
    assert.equal(response.ok, true);
    const body = await response.json();
    assert.equal(body.error, undefined, `Local RPC ${method} failed`);
    return body.result;
  };
  assert.equal(await rpc('eth_chainId'), '0x7a69');
  Object.assign(process.env, { CURB_CREDITS: JSON.stringify(fixture.credits), CURB_RPC_URL_LOCAL: rpcUrl, CURB_POSITIONS_NETWORK: 'hardhat-local', CURB_SERIES_DEPLOYMENTS: JSON.stringify(deployments), CURB_POSTGRES_URL: database.href });
  const moduleAt = relative => import(pathToFileURL(path.join(stage, relative)).href);
  const { buildSql, PostgresStore } = await moduleAt('lib/store/postgres.ts');
  const { runCredits } = await moduleAt('lib/credits/maintenance.ts');
  const { keyAccount } = await moduleAt('lib/credits/keys.ts');
  const { fanOut, deliveryCheck, webhookFault } = await moduleAt('lib/credits/subscriptions.ts');
  const { deliver } = await moduleAt('lib/ops/alerts.ts');
  const { syncIndex, reduceLedger } = await moduleAt('lib/positions/index.ts');
  const { deploymentOf } = await moduleAt('lib/positions/deployments.ts');
  const { reconcileSeries } = await moduleAt('lib/positions/reconcile.ts');
  const { selector } = await moduleAt('lib/chain/keccak.ts');
  const { NETWORKS } = await moduleAt('lib/chain/networks.ts');
  const sql = buildSql(database.href);
  const store = new PostgresStore(sql);
  const checks = [];
  const check = (name, value) => { assert.ok(value, name); checks.push({ name, passed: true }); };
  const auth = { 'x-curb-key': fixture.key };
  const http = (route, options = {}) => fetch(`${base}${route}`, { ...options, redirect: 'error', signal: AbortSignal.timeout(15_000) });
  const account = async () => { const response = await http(`/api/keys/${fixture.keyHash}`, { headers: auth }); assert.equal(response.status, 200); return response.json(); };
  let receiver;
  try {
    // This database was exclusively created by the parent; no existing schema is migrated.
    await sql.unsafe(readFileSync(path.join(stage, 'lib/store/schema.sql'), 'utf8'));
    const indexed = await runCredits(store, new Date(), null);
    check('Fresh local deployed CreditDesk bytecode matches the committed build', indexed.code?.state === 'MATCHES');
    check('Fresh pool rate and top-up receipts index successfully', indexed.rate?.state === 'READ' && indexed.index?.state === 'SYNCED');
    const parsedDeployment = deploymentOf('apple-s1');
    assert.equal(parsedDeployment.state, 'CONFIGURED');
    const deployment = parsedDeployment.deployment;
    const options = { profile: NETWORKS['hardhat-local'], intervalSeconds: 0 };
    const positionIndex = await syncIndex(store, 'apple-s1', deployment, options, new Date());
    check('Fresh mock position transactions index successfully', positionIndex.report.state === 'SYNCED' && positionIndex.report.newEvents > 0);
    const { ledger, disagreements } = reduceLedger(positionIndex.index, deployment.q, deployment.capLots);
    const matched = await reconcileSeries(store, 'apple-s1', deployment, ledger, disagreements, positionIndex.index.cursor, options, new Date());
    assert.ok(matched.reconciliation.components.every(component => component.finding === 'MATCHED'));
    // Donate one mock base unit to produce a real MATCHED -> SURPLUS journal entry.
    assert.equal(await rpc('eth_chainId'), '0x7a69');
    const donation = await rpc('eth_sendTransaction', [{ from: fixture.payer, to: deployment.components.A, gas: '0x7a120', data: `${selector('mint(address,uint256)')}${deployment.address.slice(2).padStart(64, '0')}${'1'.padStart(64, '0')}` }]);
    const receipt = await rpc('eth_getTransactionReceipt', [donation]);
    assert.equal(receipt?.status, '0x1');
    const surplus = await reconcileSeries(store, 'apple-s1', deployment, ledger, disagreements, Number(BigInt(receipt.blockNumber)), options, new Date());
    check('A real mock donation creates a recorded reconciliation change', surplus.recorded && surplus.reconciliation.components.some(component => component.component === 'A' && component.finding === 'SURPLUS'));
    const before = await account();
    check('Two actual mock top-ups credit exactly 2500 cents and open the key', before.status === 'OPEN' && before.creditedCents === '2500' && before.balanceCents === '2500');
    const route = `/api/positions/apple-s1/journal?day=${new Date().toISOString().slice(0, 10)}`;
    let response = await http(route);
    check('Paid HTTP request without a key refuses with 401', response.status === 401);
    response = await http('/api/positions/apple-s1/journal?day=2026-02-31', { headers: auth });
    check('Invalid day refuses with 400 before charging', response.status === 400);
    check('Refused requests do not debit the Postgres ledger', (await account()).balanceCents === before.balanceCents);
    response = await http(route, { headers: auth });
    const journal = await response.json();
    check('Paid HTTP journal contains the actual chain-derived reconciliation change', response.status === 200 && journal.series === 'apple-s1' && Array.isArray(journal.entries) && journal.entries.some(entry => entry.kind === 'FINDING' && entry.mark === 'SURPLUS'));
    check('Successful HTTP response reports exactly a five-cent charge', response.headers.get('x-curb-charged-cents') === '5');
    const after = await account();
    check('HTTP response and independent Postgres read agree on exact debit', after.balanceCents === '2495' && after.chargeCount === before.chargeCount + 1 && (await keyAccount(store, fixture.keyHash)).balanceCents === '2495');
    check('Key holder can inspect the charged receipt', Array.isArray(after.charges) && after.charges.length === 1);
    response = await http(`/api/keys/${fixture.keyHash}`);
    check('Public key hash hides private charge references', (await response.json()).charges === null);
    const concurrent = await Promise.all([http(route, { headers: auth }), http(route, { headers: auth })]);
    check('Two concurrent funded requests both succeed', concurrent.every(item => item.status === 200));
    check('Concurrent requests debit exactly ten more cents', (await account()).balanceCents === '2485');
    response = await http('/api/keys', { method: 'POST' });
    const emptyKey = await response.json();
    check('Key creation binds its payment hint to this local desk', response.status === 201 && emptyKey.topUp?.desk === fixture.credits.desk);
    response = await http(route, { headers: { 'x-curb-key': emptyKey.key } });
    check('Unfunded HTTP request refuses with 402', response.status === 402);
    response = await http('/api/credits?usd=20');
    check('Real indexed local code and rate produce a current quote', (await response.json()).quote?.state === 'QUOTED');
    const replay = await runCredits(store, new Date(), null);
    check('Re-indexing does not replay credit or undo paid HTTP charges', replay.index?.newTopUps === 0 && (await account()).balanceCents === '2485');

    // The production registration/SSRF rules remain unchanged. Only this CLI's
    // injected resolver + exact allowlisted transport map .invalid names to a
    // local HTTP receiver; no real DNS lookup or public webhook is attempted.
    const received = [];
    let retrySucceeds = false;
    receiver = createServer(async (request, reply) => {
      let body = '';
      for await (const chunk of request) { body += chunk; if (body.length > 16_384) { reply.writeHead(413).end(); return; } }
      let parsed;
      try { parsed = JSON.parse(body); } catch { reply.writeHead(400).end(); return; }
      received.push({ url: request.url, method: request.method, type: request.headers['content-type'], body: parsed });
      if (request.url === '/retry' && !retrySucceeds) reply.writeHead(503).end();
      else reply.writeHead(204).end();
    });
    await new Promise((resolve, reject) => { receiver.once('error', reject); receiver.listen(0, '127.0.0.1', resolve); });
    const address = receiver.address();
    assert.ok(address && typeof address !== 'string');
    const receiverBase = `http://127.0.0.1:${address.port}`;
    const endpoints = new Map([
      ['https://curb-rehearsal.invalid/success', `${receiverBase}/success`],
      ['https://curb-rehearsal.invalid/retry', `${receiverBase}/retry`],
    ]);
    const resolve = async hostname => { assert.equal(hostname, 'curb-rehearsal.invalid'); return ['203.0.113.10']; };
    const post = async (message, webhook, pinTo) => {
      assert.deepEqual(pinTo, ['203.0.113.10']);
      const target = endpoints.get(webhook);
      assert.ok(target, 'the test transport refuses every non-allowlisted webhook');
      return deliver(message, target, 2_000);
    };
    check('Production URL and DNS checks still refuse loopback destinations', webhookFault(`${receiverBase}/success`) !== null && (await deliveryCheck('https://curb-rehearsal.invalid/success', async () => ['127.0.0.1'])).fault !== null);
    response = await http('/api/subscriptions', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ url: `${receiverBase}/success` }) });
    check('Real HTTP subscription API rejects a loopback webhook', response.status === 400);
    const ids = [];
    for (const url of endpoints.keys()) {
      response = await http('/api/subscriptions', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ url }) });
      const body = await response.json();
      assert.equal(response.status, 201);
      ids.push(body.subscription.id);
    }
    check('Two webhook subscriptions register through real HTTP without charging', (await account()).balanceCents === '2485');
    const condition = { id: 'rehearsal:sample', severity: 'NOTE', text: 'Local rehearsal condition only' };
    const first = await fanOut(store, new Date(), [condition], post, resolve);
    check('Real HTTP webhook delivery succeeds once and reports the 503 failure', first.delivered === 1 && first.charged === 1 && first.failed.length === 1 && received.length === 2);
    check('Successful webhook costs ten cents; failed delivery costs zero', (await account()).balanceCents === '2475');
    check('Receiver got the production JSON payload over POST', received.every(item => item.method === 'POST' && item.type === 'application/json' && item.body.content === item.body.text && typeof item.body.text === 'string' && item.body.text.includes('Local rehearsal condition only')));
    response = await http('/api/subscriptions', { headers: auth });
    const deliveryRows = (await response.json()).subscriptions;
    check('API exposes persisted delivered/charged and failed/uncharged receipts', deliveryRows.some(item => item.lastDelivery?.state === 'SENT' && item.lastDelivery.charged) && deliveryRows.some(item => item.lastDelivery?.state === 'FAILED' && !item.lastDelivery.charged));
    retrySucceeds = true;
    const second = await fanOut(store, new Date(), [condition], post, resolve);
    check('Retry sends only the previously failed subscription', second.delivered === 1 && second.charged === 1 && received.length === 3 && received.filter(item => item.url === '/success').length === 1);
    check('Retry is charged exactly once after its receiver returns 204', (await account()).balanceCents === '2465');
    const same = await fanOut(store, new Date(), [condition], post, resolve);
    check('Unchanged conditions produce no repeat delivery or debit', same.considered === 0 && received.length === 3 && (await account()).balanceCents === '2465');
    for (const id of ids) {
      response = await http('/api/subscriptions', { method: 'DELETE', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
      assert.equal(response.status, 200);
    }
    const cancelled = await fanOut(store, new Date(), [], post, resolve);
    check('HTTP cancellation prevents subsequent delivery and charge', cancelled.considered === 0 && received.length === 3 && (await account()).balanceCents === '2465');
    response = await http('/api/subscriptions', { headers: auth });
    check('Cancelled subscription rows remain inspectable', (await response.json()).subscriptions.every(item => item.cancelledAt !== null));
    return { passed: checks.length, failed: 0, checks, amounts: { creditedCents: '2500', paidHttpCents: '15', successfulWebhookCents: '20', finalBalanceCents: '2465' }, boundary: 'Production Next HTTP + disposable PostgreSQL + fresh Hardhat 31337 mocks. Webhook fanOut and deliver are production functions; CLI-only resolver/transport injection maps two .invalid endpoints to a real loopback HTTP receiver. No public TLS/DNS or actual wallet extension is exercised.' };
  } finally {
    if (receiver) { receiver.closeAllConnections(); await new Promise(resolve => receiver.close(resolve)); }
    await sql.end({ timeout: 5 });
  }
}
