/**
 * Measure a JSON-RPC endpoint for Robinhood Chain before it is set as
 * CURB_RPC_URL: which chain it says it is, how deep its state goes, how
 * wide an eth_getLogs it serves and how it words a refusal, and whether
 * twenty reads in a row are rate-limited. Read-only; nothing is sent.
 *
 *     node scripts/probe-rpc.ts [url]          (default: CURB_RPC_URL, else the public node)
 *     node --env-file=.env.local scripts/probe-rpc.ts
 *
 * Only the endpoint's host is printed — a keyed URL never is. The desk's
 * readers need: chain id 4663; eth_getLogs of at least 100,000 blocks or a
 * refusal worded so the reader halves on it (lib/chain/logs.ts
 * isTooManyLogs); the tick's own budget of a few seconds per read.
 * Measured 13 September 2026: the public node serves any width with fewer
 * than 10,000 matches and ~6,200 blocks of state; dRPC with a key serves full
 * archive state and up to 100,000 blocks, refusing wider with "range over
 * 100000 blocks" on HTTP 500; dRPC without a key about 200 blocks.
 */

export {};

const url = process.argv[2] ?? process.env.CURB_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com';
let host: string;
try {
  host = new URL(url).host;
} catch {
  // Node's own error would quote the value; a keyed URL is never printed, valid or not.
  console.error('the endpoint is not a valid URL (its value is not printed); check the argument or CURB_RPC_URL');
  process.exit(1);
}
console.log('endpoint host:', host, process.argv[2] ? '(argument)' : process.env.CURB_RPC_URL ? '(CURB_RPC_URL)' : '(the public node)');

const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const SAFE_FACTORY = '0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67';
let id = 0;
const rpc = async (method: string, params: unknown[]): Promise<{ http: number; ms: number; result?: unknown; error?: { code: number; message: string } }> => {
  const t0 = Date.now();
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
  const text = await r.text();
  try {
    const j = JSON.parse(text) as { result?: unknown; error?: { code: number; message: string } };
    return { http: r.status, ms: Date.now() - t0, result: j.result, error: j.error };
  } catch {
    return { http: r.status, ms: Date.now() - t0, error: { code: 0, message: `not JSON: ${text.slice(0, 80)}` } };
  }
};
const hex = (n: number) => `0x${n.toString(16)}`;
const say = (label: string, r: Awaited<ReturnType<typeof rpc>>, ok: (v: unknown) => string) => console.log(label.padEnd(44), r.error ? `REFUSED (HTTP ${r.http}) ${r.error.message.slice(0, 110)}` : `ok ${ok(r.result)}`, `${r.ms} ms`);

const chain = await rpc('eth_chainId', []);
say('chain id', chain, (v) => `${Number.parseInt(String(v), 16)} (the desk expects 4663)`);
const head = Number.parseInt(String((await rpc('eth_blockNumber', [])).result), 16);
console.log('head', head);

console.log('\nstate depth — eth_call totalSupply() on USDG at head minus N:');
for (const back of [100, 5_000, 7_000, 50_000, 2_000_000, 30_000_000]) {
  say(`  head − ${back.toLocaleString('en-US')}`, await rpc('eth_call', [{ to: USDG, data: '0x18160ddd' }, hex(Math.max(1, head - back))]), () => 'served');
}

console.log('\neth_getLogs width — a quiet address (Safe factory) and a busy one (USDG transfers):');
for (const [label, address, topics, width] of [
  ['  factory, 200 blocks', SAFE_FACTORY, [], 200],
  ['  factory, 10,000 blocks', SAFE_FACTORY, [], 10_000],
  ['  factory, 35,000 blocks (guard window)', SAFE_FACTORY, [], 35_000],
  ['  factory, 100,000 blocks (a sync)', SAFE_FACTORY, [], 100_000],
  ['  factory, 2,000,000 blocks', SAFE_FACTORY, [], 2_000_000],
  ['  USDG transfers, 100 blocks', USDG, [TRANSFER], 100],
  ['  USDG transfers, 2,000 blocks (>10,000 logs)', USDG, [TRANSFER], 2_000],
] as const) {
  say(label, await rpc('eth_getLogs', [{ address, topics, fromBlock: hex(Math.max(0, head - width)), toBlock: hex(head) }]), (v) => `${Array.isArray(v) ? v.length : '?'} logs`);
}

console.log('\nrate — twenty header reads in a row:');
const t0 = Date.now();
let refused = 0;
for (let i = 0; i < 20; i += 1) if ((await rpc('eth_getBlockByNumber', [hex(head - i), false])).error) refused += 1;
console.log(`  ${Date.now() - t0} ms in all, ${refused} refused`);
