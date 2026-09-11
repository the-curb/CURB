/**
 * Capture the issuer's stock-token registry and verify every token against the
 * chain, then emit `lib/chain/stock-tokens.ts`.
 *
 *   node --env-file-if-exists=.env.local scripts/capture-stock-tokens.ts          # dry run
 *   node --env-file-if-exists=.env.local scripts/capture-stock-tokens.ts --write  # write the module
 *
 * The issuer's contracts page says its stock-token table "is generated live
 * from the on-chain asset registry"; the page's own code reads that table from
 * the JSON endpoint below. This script reads the same endpoint and then asks
 * the chain, for every token: `symbol()`, `name()`, `decimals()`,
 * `uiMultiplier()`, the EIP-1967 beacon slot, and the hash of the proxy's
 * runtime code. Every stock token turned out to be a beacon proxy on ONE shared
 * beacon — so the beacon's `implementation()` is recorded once, as the tripwire
 * that covers all of them, and each token's beacon and code hash are recorded
 * so a later run can prove a token still belongs to that set.
 *
 * Nothing here is an endorsement or a listing. It is what two sources said.
 */

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { getText } from '../lib/chain/transport.ts';
import { readMany } from '../lib/chain/multicall.ts';
import { readBlockNumber, rpcCall } from '../lib/chain/rpc.ts';
import { EIP1967_SLOTS, SELECTORS, decodeAddressWord, decodeString, decodeUint } from '../lib/chain/abi.ts';
import { keccak256, selector, toHex } from '../lib/chain/keccak.ts';
import { MULTIPLIER_SCALE } from '../lib/chain/oracle.ts';
import { activeNetwork } from '../lib/chain/networks.ts';
import { FEED_DIRECTORY } from '../lib/chain/feed-directory.ts';

const REGISTRY_URL = 'https://api.robinhood.com/rhj/assets';
const LINKED_FROM = 'https://docs.robinhood.com/chain/contracts/';
const OUTPUT = 'lib/chain/stock-tokens.ts';

interface RawAsset {
  readonly id: string;
  readonly tokenSymbol: string;
  readonly tokenName: string;
  readonly deployments: readonly { readonly contractAddress: string; readonly chainId: number; readonly networkName: string }[];
  readonly currentMultiplier: string;
  readonly pendingMultiplier: string;
  readonly status: string;
  readonly tokenDecimals: number;
  readonly isin: string;
}

/** A few at a time. The endpoint refuses a burst; this is not a burst. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

/** 1e18-scaled → '1.000566080061092436', all eighteen places, as the registry prints it. */
function exactMultiplier(raw: bigint): string {
  const whole = raw / MULTIPLIER_SCALE;
  const fraction = (raw % MULTIPLIER_SCALE).toString().padStart(18, '0');
  return `${whole}.${fraction}`;
}

const write = process.argv.includes('--write');
const network = activeNetwork();
const opts = { intervalSeconds: 24 * 3600, timeoutMs: 30_000 };

const response = await getText(REGISTRY_URL);
if (!response.ok) throw new Error(`registry fetch failed: HTTP ${response.status}`);
const retrievedAt = new Date().toISOString();
const sha256 = createHash('sha256').update(response.text).digest('hex');
const assets = (JSON.parse(response.text) as { assets: RawAsset[] }).assets;

const onThisChain = assets.filter((a) => a.deployments.some((d) => d.chainId === network.chainId));
const elsewhere = assets.length - onThisChain.length;
const block = await readBlockNumber(opts);

// ── batched: the four view calls per token ───────────────────────────────────
const addressOf = (a: RawAsset) => a.deployments.find((d) => d.chainId === network.chainId)!.contractAddress;
const calls = onThisChain.flatMap((a) => [
  { target: addressOf(a), data: SELECTORS.symbol },
  { target: addressOf(a), data: SELECTORS.name },
  { target: addressOf(a), data: SELECTORS.decimals },
  { target: addressOf(a), data: SELECTORS.uiMultiplier },
]);
const answers = await readMany(calls, opts);

// ── direct, rate-limited: storage slot and code, which a multicall cannot read ─
const slots = await mapLimit(onThisChain, 3, async (a) => {
  const address = addressOf(a);
  const [beacon, code] = await Promise.all([
    rpcCall<string>('eth_getStorageAt', [address, EIP1967_SLOTS.beacon, 'latest'], opts),
    rpcCall<string>('eth_getCode', [address, 'latest'], opts),
  ]);
  return {
    beacon: beacon.state === 'VERIFIED' ? decodeAddressWord(beacon.value) : null,
    codeHash: code.state === 'VERIFIED' ? toHex(keccak256(Buffer.from(code.value.slice(2), 'hex'))) : null,
    codeSize: code.state === 'VERIFIED' ? (code.value.length - 2) / 2 : null,
  };
});

const feedByTicker = new Map(FEED_DIRECTORY.filter((f) => f.ticker !== null).map((f) => [f.ticker!, f.key]));

const records = onThisChain.map((a, i) => {
  const symbol = answers[i * 4]!;
  const name = answers[i * 4 + 1]!;
  const decimals = answers[i * 4 + 2]!;
  const multiplier = answers[i * 4 + 3]!;
  const multiplierRaw = multiplier.state === 'VERIFIED' ? decodeUint(multiplier.value) : null;
  return {
    key: `rh-${a.tokenSymbol.toLowerCase()}`,
    ticker: a.tokenSymbol,
    name: a.tokenName,
    address: addressOf(a),
    registryId: a.id,
    isin: a.isin,
    decimals: a.tokenDecimals,
    status: a.status,
    multiplierAtCapture: a.currentMultiplier,
    observedSymbol: symbol.state === 'VERIFIED' ? decodeString(symbol.value) : null,
    observedName: name.state === 'VERIFIED' ? decodeString(name.value) : null,
    observedDecimals: decimals.state === 'VERIFIED' ? Number(decodeUint(decimals.value)) : null,
    observedMultiplier: multiplierRaw === null ? null : exactMultiplier(multiplierRaw),
    beacon: slots[i]!.beacon,
    codeHash: slots[i]!.codeHash,
    feedKey: feedByTicker.get(a.tokenSymbol) ?? null,
  };
});
records.sort((a, b) => a.ticker.localeCompare(b.ticker));

// ── the shared beacon ────────────────────────────────────────────────────────
const beacons = [...new Set(records.map((r) => r.beacon).filter((b): b is string => b !== null))];
if (beacons.length !== 1) throw new Error(`expected one shared beacon, found ${beacons.length}: ${beacons.join(', ')}`);
const beacon = beacons[0]!;
const implementation = await rpcCall<string>('eth_call', [{ to: beacon, data: selector('implementation()') }, 'latest'], opts);
const implementationAddress = implementation.state === 'VERIFIED' ? decodeAddressWord(implementation.value) : null;
if (implementationAddress === null) throw new Error('the beacon did not answer implementation()');
const implementationCode = await rpcCall<string>('eth_getCode', [implementationAddress, 'latest'], opts);
const implementationSize = implementationCode.state === 'VERIFIED' ? (implementationCode.value.length - 2) / 2 : null;
const implementationHash = implementationCode.state === 'VERIFIED' ? toHex(keccak256(Buffer.from(implementationCode.value.slice(2), 'hex'))) : null;
const codeHashes = [...new Set(records.map((r) => r.codeHash).filter((h): h is string => h !== null))];

// ── report ───────────────────────────────────────────────────────────────────
const fullyVerified = records.filter((r) => r.observedSymbol !== null && r.observedName !== null && r.observedDecimals !== null && r.observedMultiplier !== null && r.beacon !== null && r.codeHash !== null);
const symbolAgrees = records.filter((r) => r.observedSymbol === r.ticker);
const decimalsAgree = records.filter((r) => r.observedDecimals === r.decimals);
const multiplierAgrees = records.filter((r) => r.observedMultiplier !== null && r.observedMultiplier === r.multiplierAtCapture);
const withFeed = records.filter((r) => r.feedKey !== null);
const notOne = records.filter((r) => r.multiplierAtCapture !== '1.000000000000000000');

console.log(`registry: ${assets.length} assets · ${onThisChain.length} deployed on chain ${network.chainId} · ${elsewhere} elsewhere · sha256 ${sha256.slice(0, 16)}…`);
console.log(`chain ${network.label}: block ${block.state === 'UNREAD' ? `unread (${block.reason})` : block.value}`);
console.log(`fully verified on chain: ${fullyVerified.length}/${records.length} · symbol agrees ${symbolAgrees.length} · decimals agree ${decimalsAgree.length} · multiplier agrees ${multiplierAgrees.length}`);
console.log(`beacon ${beacon} → implementation ${implementationAddress} (${implementationSize} bytes) · proxy code hashes: ${codeHashes.length} distinct`);
console.log(`with a Chainlink feed: ${withFeed.length} · multiplier other than 1: ${notOne.length} · status values: ${[...new Set(records.map((r) => r.status))].join(', ')}`);
for (const r of records) {
  const gaps = [
    r.observedSymbol === null ? 'symbol' : null, r.observedName === null ? 'name' : null, r.observedDecimals === null ? 'decimals' : null,
    r.observedMultiplier === null ? 'multiplier' : null, r.beacon === null ? 'beacon' : null, r.codeHash === null ? 'code' : null,
  ].filter(Boolean);
  if (gaps.length > 0) console.log(`  UNREAD  ${r.ticker} — ${gaps.join(', ')}`);
  if (r.observedSymbol !== null && r.observedSymbol !== r.ticker) console.log(`  SYMBOL  ${r.ticker} — chain says "${r.observedSymbol}"`);
  if (r.observedDecimals !== null && r.observedDecimals !== r.decimals) console.log(`  DECIMALS ${r.ticker} — registry ${r.decimals}, chain ${r.observedDecimals}`);
}
const feedsWithoutToken = FEED_DIRECTORY.filter((f) => f.ticker !== null && !records.some((r) => r.ticker === f.ticker));
if (feedsWithoutToken.length > 0) console.log(`  feeds with no registry token: ${feedsWithoutToken.map((f) => f.ticker).join(', ')}`);

if (fullyVerified.length !== records.length || implementationHash === null) {
  console.log('\nNot every token was verified on chain. Nothing written: re-run when the chain answers.');
  process.exit(write ? 1 : 0);
}

const lines = records.map((r) => `  ${JSON.stringify(r).replace(/"([a-zA-Z]+)":/g, '$1: ').replace(/,/g, ', ')},`);

const module = `/**
 * Robinhood stock and ETF tokens on ${network.label}, as the issuer's registry
 * listed them and as the chain answered for each one. GENERATED by
 * scripts/capture-stock-tokens.ts — do not edit by hand; re-run the capture
 * and commit the diff.
 *
 * Every token is an EIP-1967 beacon proxy on the one beacon recorded below.
 * That is the fact that shapes how the Registry watches them: the beacon's
 * \`implementation()\` is one read that describes the code behind every token
 * at once, and a change there is a change to all of them in one transaction.
 *
 * \`observedSymbol\`, \`observedName\`, \`beacon\` and \`codeHash\` are what the chain
 * said at capture. They are the run-time tripwires; the registry's \`ticker\`
 * and \`name\` are labels. \`multiplierAtCapture\` is the registry's figure and
 * \`observedMultiplier\` the contract's, kept together because they agreed to
 * all eighteen places on every token when this was written and should go on
 * agreeing.
 */

export interface StockTokenRecord {
  readonly key: string;
  /** The registry's symbol. The chain's is in observedSymbol. */
  readonly ticker: string;
  readonly name: string;
  readonly address: string;
  /** bytes32 id in the issuer's asset registry. */
  readonly registryId: string;
  readonly isin: string;
  readonly decimals: number;
  readonly status: string;
  /** The registry's shares-per-token figure at capture, as it printed it. */
  readonly multiplierAtCapture: string;
  readonly observedSymbol: string | null;
  readonly observedName: string | null;
  readonly observedDecimals: number | null;
  /** \`uiMultiplier()\` at capture, all eighteen places, printed as the registry prints its own. */
  readonly observedMultiplier: string | null;
  /** EIP-1967 beacon slot at capture. */
  readonly beacon: string | null;
  /** keccak256 of the proxy's runtime code at capture. */
  readonly codeHash: string | null;
  /** The Chainlink feed that prices this token, when the directory lists one. */
  readonly feedKey: string | null;
}

export const STOCK_TOKENS_SOURCE = {
  url: ${JSON.stringify(REGISTRY_URL)},
  linkedFrom: ${JSON.stringify(LINKED_FROM)},
  retrievedAt: ${JSON.stringify(retrievedAt)},
  sha256: ${JSON.stringify(sha256)},
  listed: ${assets.length},
  onThisChain: ${records.length},
  verifiedOnChain: ${fullyVerified.length},
  verifiedAtBlock: ${block.state === 'UNREAD' ? 'null' : block.value},
  network: ${JSON.stringify(network.label)},
} as const;

/** The one beacon every stock token delegates to. One read covers the set. */
export const STOCK_TOKEN_BEACON = {
  address: ${JSON.stringify(beacon)},
  observedImplementation: ${JSON.stringify(implementationAddress)},
  observedImplementationCodeHash: ${JSON.stringify(implementationHash)},
  observedImplementationSizeBytes: ${implementationSize},
  /** Every proxy shared this runtime at capture. */
  observedProxyCodeHash: ${JSON.stringify(codeHashes[0] ?? null)},
  observedAt: ${JSON.stringify(retrievedAt)},
  observedAtBlock: ${block.state === 'UNREAD' ? 'null' : block.value},
} as const;

export const STOCK_TOKENS: readonly StockTokenRecord[] = [
${lines.join('\n')}
];
`;

if (write) {
  writeFileSync(OUTPUT, module);
  console.log(`\nwrote ${OUTPUT} (${records.length} tokens)`);
} else {
  console.log(`\ndry run — ${OUTPUT} not written. Pass --write to write it.`);
}
