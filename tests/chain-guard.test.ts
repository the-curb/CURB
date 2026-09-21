import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { forgetChainConfirmations, readBlockNumber, rpcCall } from '../lib/chain/rpc.ts';
import { NETWORKS, prefersOwnEndpoint, rpcUrls } from '../lib/chain/networks.ts';

/**
 * The endpoint is asked which chain it is before anything else it says is
 * trusted. Multicall3 has the same bytecode everywhere, so this is the only
 * check that tells a mistyped RPC URL for another chain apart from the real one.
 */
const mainnet = NETWORKS['robinhood-mainnet'];
const opts = { profile: mainnet, intervalSeconds: 300 };

function fakeNode(chainIdHex: string) {
  const calls: string[] = [];
  const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    const { method, id } = JSON.parse(String(init?.body)) as { method: string; id: number };
    calls.push(method);
    const result = method === 'eth_chainId' ? chainIdHex : method === 'eth_blockNumber' ? '0x10' : null;
    return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
}

describe('the chain guard', () => {
  const realFetch = globalThis.fetch;
  const realUrl = process.env.CURB_RPC_URL;
  const realDoh = process.env.CURB_DNS_OVER_HTTPS;

  const realRoute = process.env.CURB_RPC_ROUTE;

  beforeEach(() => {
    forgetChainConfirmations();
    process.env.CURB_RPC_URL = 'https://node.test.invalid/rpc';
    // These tests are about the fallback itself, so every read starts on the
    // operator's endpoint; the default routing has its own tests below.
    process.env.CURB_RPC_ROUTE = 'all';
    delete process.env.CURB_DNS_OVER_HTTPS;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realUrl === undefined) delete process.env.CURB_RPC_URL;
    else process.env.CURB_RPC_URL = realUrl;
    if (realRoute === undefined) delete process.env.CURB_RPC_ROUTE;
    else process.env.CURB_RPC_ROUTE = realRoute;
    if (realDoh === undefined) delete process.env.CURB_DNS_OVER_HTTPS;
    else process.env.CURB_DNS_OVER_HTTPS = realDoh;
    forgetChainConfirmations();
  });

  it('asks the chain id once, then lets reads through on the right chain', async () => {
    const node = fakeNode(mainnet.chainIdHex);
    globalThis.fetch = node.fetch;

    const first = await readBlockNumber(opts);
    const second = await readBlockNumber(opts);

    assert.equal(first.state, 'VERIFIED');
    assert.equal(first.value, 16);
    assert.equal(second.state, 'VERIFIED');
    assert.deepEqual(node.calls, ['eth_chainId', 'eth_blockNumber', 'eth_blockNumber']);
  });

  it('reads nothing from an endpoint on another chain, and says which chain it found', async () => {
    const node = fakeNode('0x1'); // Ethereum mainnet, where Multicall3 also lives
    globalThis.fetch = node.fetch;

    const head = await readBlockNumber(opts);

    assert.equal(head.state, 'UNREAD');
    assert.equal(head.value, null);
    assert.equal(head.reason, 'SOURCE_MALFORMED');
    assert.match(head.detail ?? '', /reports chain 1/);
    assert.match(head.detail ?? '', /expects 4663/);
    assert.deepEqual(node.calls, ['eth_chainId'], 'the block was never asked for');
  });

  it('carries a transport failure on the chain id itself as the reading, naming the fallback that did not answer either', async () => {
    globalThis.fetch = (async () => new Response('down', { status: 503 })) as unknown as typeof globalThis.fetch;

    const head = await readBlockNumber(opts);

    assert.equal(head.state, 'UNREAD');
    assert.equal(head.reason, 'SOURCE_UNREACHABLE');
    assert.match(head.detail ?? '', /HTTP 503; the fallback did not answer either \(rpc\.mainnet\.chain\.robinhood\.com: HTTP 503\)/);
  });

  it('falls back to the public node when the operator’s endpoint does not answer, and not when it answers wrongly', async () => {
    // The operator's endpoint (the override) is down or out of quota; the profile's public node answers.
    const calls: string[] = [];
    let primary: 'down' | 'quota' | 'revert' | 'up' = 'down';
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const { method, id } = JSON.parse(String(init?.body)) as { method: string; id: number };
      const host = new URL(String(url)).host;
      calls.push(`${host} ${method}`);
      if (host === 'node.test.invalid') {
        if (primary === 'down') return new Response('down', { status: 503 });
        if (primary === 'quota') return new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32005, message: 'daily quota exceeded for this plan' } }), { status: 429, headers: { 'content-type': 'application/json' } });
        if (primary === 'revert') return new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code: 3, message: 'execution reverted' } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      const result = method === 'eth_chainId' ? mainnet.chainIdHex : method === 'eth_blockNumber' ? '0x20' : null;
      return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof globalThis.fetch;

    const head = await readBlockNumber(opts);
    assert.equal(head.state, 'VERIFIED');
    assert.equal(head.value, 32);
    assert.match(head.source, /^rpc.mainnet.chain.robinhood.com/);
    assert.deepEqual(calls, ['node.test.invalid eth_chainId', 'rpc.mainnet.chain.robinhood.com eth_chainId', 'rpc.mainnet.chain.robinhood.com eth_blockNumber']);
    // Demoted: the next read goes straight to the fallback.
    calls.length = 0;
    const again = await readBlockNumber(opts);
    assert.equal(again.state, 'VERIFIED');
    assert.deepEqual(calls, ['rpc.mainnet.chain.robinhood.com eth_blockNumber']);
    // A quota refusal on the primary is the same: the next endpoint is asked.
    forgetChainConfirmations();
    primary = 'quota';
    calls.length = 0;
    const quota = await readBlockNumber(opts);
    assert.equal(quota.state, 'VERIFIED');
    assert.equal(calls[0], 'node.test.invalid eth_chainId');
    assert.equal(calls.at(-1), 'rpc.mainnet.chain.robinhood.com eth_blockNumber');
    // A timed-out eth_getLogs page is the reader's signal to halve, not a dead endpoint: no fallback, no demotion.
    forgetChainConfirmations();
    primary = 'up';
    await readBlockNumber(opts);
    calls.length = 0;
    const realFetchHere = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const { method } = JSON.parse(String(init?.body)) as { method: string };
      if (new URL(String(url)).host === 'node.test.invalid' && method === 'eth_getLogs') {
        // Answers late; honours the abort the transport sends at its timeout, as a real fetch does.
        return new Promise<Response>((resolve, reject) => {
          const t = setTimeout(() => resolve(new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: [] }), { status: 200 })), 500);
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(t);
            const e = new Error('aborted');
            e.name = 'AbortError';
            reject(e);
          });
        });
      }
      return realFetchHere(url, init);
    }) as unknown as typeof globalThis.fetch;
    const logs = await rpcCall('eth_getLogs', [{ fromBlock: '0x1', toBlock: '0x2' }], { ...opts, timeoutMs: 50 });
    assert.equal(logs.state, 'UNREAD');
    assert.equal(logs.reason, 'SOURCE_TIMEOUT');
    assert.ok(!calls.some((c) => c.startsWith('rpc.mainnet')), 'not tried on the public node');
    calls.length = 0;
    const stillPrimary = await readBlockNumber(opts);
    assert.equal(stillPrimary.state, 'VERIFIED');
    assert.deepEqual(calls, ['node.test.invalid eth_blockNumber'], 'the primary was not demoted');
    globalThis.fetch = realFetchHere;

    // An answer — a revert — is the reading; nothing is asked elsewhere.
    forgetChainConfirmations();
    primary = 'up';
    await readBlockNumber(opts);
    primary = 'revert';
    calls.length = 0;
    const reverted = await readBlockNumber(opts);
    assert.equal(reverted.state, 'UNREAD');
    assert.equal(reverted.reason, 'FIELD_ABSENT');
    assert.deepEqual(calls, ['node.test.invalid eth_blockNumber']);
  });

  // 21 September 2026: the operator's dRPC balance ran low. A paid endpoint
  // that has run out must hand its reads to the public node, not answer every
  // read with a billing message the desk would print as the reading.
  it('hands the reads to the public node when the operator’s endpoint is out of balance', async () => {
    for (const refusal of [
      { status: 402, body: 'Payment Required' },
      { status: 402, body: JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'payment required' } }) },
      { status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'Insufficient balance: top up your account' } }) },
      { status: 403, body: JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: 32002, message: 'your balance is too low' } }) },
    ]) {
      forgetChainConfirmations();
      const calls: string[] = [];
      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const { method, id } = JSON.parse(String(init?.body)) as { method: string; id: number };
        const host = new URL(String(url)).host;
        calls.push(`${host} ${method}`);
        if (host === 'node.test.invalid' && method !== 'eth_chainId') return new Response(refusal.body, { status: refusal.status });
        const result = method === 'eth_chainId' ? mainnet.chainIdHex : '0x21';
        return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { status: 200 });
      }) as unknown as typeof globalThis.fetch;
      const head = await readBlockNumber(opts);
      assert.equal(head.state, 'VERIFIED', `${refusal.status} ${refusal.body}`);
      assert.match(head.source, /^rpc.mainnet.chain.robinhood.com/);
      assert.equal(calls.at(-1), 'rpc.mainnet.chain.robinhood.com eth_blockNumber');
    }
  });

  it('does not mistake a contract’s own "insufficient balance" revert for the endpoint running out', async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const { method, id } = JSON.parse(String(init?.body)) as { method: string; id: number };
      calls.push(`${new URL(String(url)).host} ${method}`);
      if (method === 'eth_chainId') return new Response(JSON.stringify({ jsonrpc: '2.0', id, result: mainnet.chainIdHex }), { status: 200 });
      return new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code: 3, message: 'execution reverted: insufficient balance' } }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const r = await rpcCall('eth_call', [{ to: '0x0000000000000000000000000000000000000001', data: '0x' }, 'latest'], opts);
    assert.equal(r.state, 'UNREAD');
    assert.equal(r.reason, 'FIELD_ABSENT');
    assert.ok(!calls.some((c) => c.startsWith('rpc.mainnet') && !c.endsWith('eth_chainId')), 'the answer was not asked again elsewhere');
  });
});

describe('which endpoint a read goes to first', () => {
  const realUrl = process.env.CURB_RPC_URL;
  const realRoute = process.env.CURB_RPC_ROUTE;
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    forgetChainConfirmations();
    process.env.CURB_RPC_URL = 'https://node.test.invalid/rpc';
    delete process.env.CURB_RPC_ROUTE;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realUrl === undefined) delete process.env.CURB_RPC_URL;
    else process.env.CURB_RPC_URL = realUrl;
    if (realRoute === undefined) delete process.env.CURB_RPC_ROUTE;
    else process.env.CURB_RPC_ROUTE = realRoute;
    forgetChainConfirmations();
  });

  it('sends history to the paid endpoint and the head to the public node', () => {
    assert.equal(prefersOwnEndpoint('eth_getLogs', [{ fromBlock: '0x1', toBlock: '0x2' }]), true);
    assert.equal(prefersOwnEndpoint('eth_call', [{ to: '0x1', data: '0x' }, '0x4a2f11']), true, 'state at a past block');
    assert.equal(prefersOwnEndpoint('eth_getStorageAt', ['0x1', '0x0', '0x4a2f11']), true);
    assert.equal(prefersOwnEndpoint('eth_call', [{ to: '0x1', data: '0x' }, 'latest']), false);
    assert.equal(prefersOwnEndpoint('eth_blockNumber', []), false);
    assert.equal(prefersOwnEndpoint('eth_getBlockByNumber', ['0x4a2f11', false]), false, 'a block header is history the public node serves');
    process.env.CURB_RPC_ROUTE = 'all';
    assert.equal(prefersOwnEndpoint('eth_blockNumber', []), true, 'CURB_RPC_ROUTE=all puts the paid endpoint first for everything');
  });

  it('orders the endpoints by that preference, and uses the public node alone when no endpoint is set', () => {
    assert.deepEqual(rpcUrls(mainnet, true), ['https://node.test.invalid/rpc', mainnet.defaultRpcUrl]);
    assert.deepEqual(rpcUrls(mainnet, false), [mainnet.defaultRpcUrl, 'https://node.test.invalid/rpc']);
    delete process.env.CURB_RPC_URL;
    assert.deepEqual(rpcUrls(mainnet, true), [mainnet.defaultRpcUrl]);
  });

  it('reads the head from the public node without touching the paid endpoint', async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const { method, id } = JSON.parse(String(init?.body)) as { method: string; id: number };
      calls.push(`${new URL(String(url)).host} ${method}`);
      const result = method === 'eth_chainId' ? mainnet.chainIdHex : method === 'eth_blockNumber' ? '0x30' : [];
      return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const head = await readBlockNumber(opts);
    assert.equal(head.state, 'VERIFIED');
    assert.ok(calls.every((c) => c.startsWith('rpc.mainnet')), calls.join(' | '));
    calls.length = 0;
    await rpcCall('eth_getLogs', [{ fromBlock: '0x1', toBlock: '0x2' }], opts);
    assert.equal(calls.at(-1), 'node.test.invalid eth_getLogs', 'logs go to the paid endpoint first');
  });
});
