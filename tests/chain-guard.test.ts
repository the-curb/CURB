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

  it('carries a transport failure on the chain id itself as the reading', async () => {
    globalThis.fetch = (async () => new Response('down', { status: 503 })) as unknown as typeof globalThis.fetch;

    const head = await readBlockNumber(opts);

    assert.equal(head.state, 'UNREAD');
    assert.equal(head.reason, 'SOURCE_UNREACHABLE');
  });
});
