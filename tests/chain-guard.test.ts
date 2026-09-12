import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { forgetChainConfirmations, readBlockNumber } from '../lib/chain/rpc.ts';
import { NETWORKS } from '../lib/chain/networks.ts';

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

  beforeEach(() => {
    forgetChainConfirmations();
    process.env.CURB_RPC_URL = 'https://node.test.invalid/rpc';
    delete process.env.CURB_DNS_OVER_HTTPS;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realUrl === undefined) delete process.env.CURB_RPC_URL;
    else process.env.CURB_RPC_URL = realUrl;
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
});
