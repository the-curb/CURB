/**
 * Capture the Chainlink feed directory for the active network and verify every
 * entry against the chain, then emit `lib/chain/feed-directory.ts`.
 *
 *   node --env-file-if-exists=.env.local scripts/capture-feeds.ts          # dry run: report, write nothing
 *   node --env-file-if-exists=.env.local scripts/capture-feeds.ts --write  # write the module
 *
 * What "verify" means here: each proxy is asked `description()` and
 * `decimals()` in one batched call, and what it answered is recorded next to
 * what the directory claimed. The on-chain description is the tripwire the
 * Pillar checks at run time — the directory's name is a label, the contract's
 * is a fact. Nine equity feeds already differ ("RHNVDA / USD" on chain against
 * "Robinhood NVDA / USD" in the directory), which is exactly why both are kept.
 *
 * The raw directory file is not committed; its SHA-256 and Last-Modified are,
 * so a later capture can say whether the source changed or only this module.
 */

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { getText } from '../lib/chain/transport.ts';
import { readMany } from '../lib/chain/multicall.ts';
import { readBlockNumber } from '../lib/chain/rpc.ts';
import { SELECTORS, decodeString, decodeUint } from '../lib/chain/abi.ts';
import { activeNetwork } from '../lib/chain/networks.ts';

const DIRECTORY_URL = 'https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json';
const LINKED_FROM = 'https://docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood';
const OUTPUT = 'lib/chain/feed-directory.ts';

interface RawFeed {
  readonly name: string;
  readonly assetName?: string;
  readonly path: string;
  readonly proxyAddress: string;
  readonly contractAddress: string;
  readonly secondaryProxyAddress?: string | null;
  readonly decimals: number;
  readonly heartbeat: number;
  readonly threshold: number;
  readonly feedCategory?: string;
  readonly docs?: { readonly marketHours?: string; readonly assetClass?: string };
}

function marketHoursOf(raw: RawFeed): 'equity' | 'crypto' {
  const hours = raw.docs?.marketHours;
  if (hours === 'us_equities_24/5') return 'equity';
  if (hours === 'Crypto') return 'crypto';
  // An unfamiliar clock is not guessed at. The script stops and says so.
  throw new Error(`unknown marketHours "${hours}" on ${raw.name} — extend marketHoursOf before capturing`);
}

/** "Robinhood AAPL / USD" → AAPL; "Robinhood DELL-USD" → DELL. */
function tickerOf(raw: RawFeed): string {
  const ticker = raw.name.replace(/^Robinhood /, '').replace(/\s*\/\s*USD$|-USD$/, '');
  if (!/^[A-Z]{1,6}$/.test(ticker)) throw new Error(`could not derive a ticker from "${raw.name}"`);
  return ticker;
}

function keyOf(raw: RawFeed, hours: 'equity' | 'crypto'): string {
  if (hours === 'equity') return `rh-${tickerOf(raw).toLowerCase()}-usd`;
  return raw.path.replace(/-shared-svr$/, '').replace(/\./g, '');
}

const write = process.argv.includes('--write');
const network = activeNetwork();
const opts = { intervalSeconds: 900, timeoutMs: 30_000 };

const response = await getText(DIRECTORY_URL);
if (!response.ok) throw new Error(`directory fetch failed: HTTP ${response.status}`);
const retrievedAt = new Date().toISOString();
const sha256 = createHash('sha256').update(response.text).digest('hex');
const raws = JSON.parse(response.text) as RawFeed[];

const block = await readBlockNumber(opts);
const calls = raws.flatMap((f) => [
  { target: f.proxyAddress, data: SELECTORS.description },
  { target: f.proxyAddress, data: SELECTORS.decimals },
]);
const answers = await readMany(calls, opts);

const records = raws.map((raw, i) => {
  const hours = marketHoursOf(raw);
  const description = answers[i * 2]!;
  const decimals = answers[i * 2 + 1]!;
  const observedDescription = description.state === 'VERIFIED' ? decodeString(description.value) : null;
  const observedDecimals = decimals.state === 'VERIFIED' ? decodeUint(decimals.value) : null;
  return {
    key: keyOf(raw, hours),
    name: raw.name,
    assetName: raw.assetName ?? raw.name,
    marketHours: hours,
    ticker: hours === 'equity' ? tickerOf(raw) : null,
    proxy: raw.proxyAddress,
    aggregator: raw.contractAddress,
    svrProxy: raw.secondaryProxyAddress ?? null,
    decimals: raw.decimals,
    heartbeatSeconds: raw.heartbeat,
    deviationThresholdPct: raw.threshold,
    feedCategory: raw.feedCategory ?? '',
    observedDescription,
    observedDecimals: observedDecimals === null ? null : Number(observedDecimals),
  };
});

// Equity first, then crypto; alphabetical inside each. Stable output makes the
// diff of a re-capture say what changed in the world, not in the sort.
records.sort((a, b) =>
  a.marketHours === b.marketHours ? a.name.localeCompare(b.name) : a.marketHours === 'equity' ? -1 : 1,
);

const keys = new Set(records.map((r) => r.key));
if (keys.size !== records.length) throw new Error('feed keys are not unique');
const proxies = new Set(records.map((r) => r.proxy.toLowerCase()));
if (proxies.size !== records.length) throw new Error('feed proxies are not unique');

const verified = records.filter((r) => r.observedDescription !== null && r.observedDecimals !== null);
const decimalsAgree = records.filter((r) => r.observedDecimals === r.decimals);
const nameAgrees = records.filter((r) => r.observedDescription === r.name);

console.log(`directory: ${records.length} feeds · sha256 ${sha256.slice(0, 16)}… · last-modified ${response.headers['last-modified'] ?? 'absent'}`);
console.log(`chain ${network.label}: block ${block.state === 'UNREAD' ? `unread (${block.reason})` : block.value}`);
console.log(`verified on chain: ${verified.length}/${records.length} · decimals agree ${decimalsAgree.length} · description equals directory name ${nameAgrees.length}`);
console.log(`equity ${records.filter((r) => r.marketHours === 'equity').length} · crypto ${records.filter((r) => r.marketHours === 'crypto').length}`);
for (const r of records) {
  if (r.observedDescription === null) console.log(`  UNREAD  ${r.name} — description not read`);
  else if (r.observedDescription !== r.name) console.log(`  DIFFERS ${r.name} — chain says "${r.observedDescription}"`);
  if (r.observedDecimals !== null && r.observedDecimals !== r.decimals) console.log(`  DECIMALS ${r.name} — directory ${r.decimals}, chain ${r.observedDecimals}`);
}

if (verified.length !== records.length) {
  console.log('\nNot every feed was verified on chain. Nothing written: re-run when the chain answers.');
  process.exit(write ? 1 : 0);
}

const lines = records.map((r) => `  ${JSON.stringify(r).replace(/"([a-zA-Z]+)":/g, '$1: ').replace(/,/g, ', ')},`);

const module = `/**
 * Chainlink feeds on ${network.label}, as the vendor directory listed them and as
 * the chain answered for each one. GENERATED by scripts/capture-feeds.ts — do
 * not edit by hand; re-run the capture and commit the diff.
 *
 * Every entry was verified on chain at capture: the proxy answered
 * \`description()\` and \`decimals()\`, and both answers are recorded beside the
 * directory's claim. \`observedDescription\` is the tripwire the Pillar checks
 * at run time. The directory's \`name\` is a label for humans.
 *
 * The heartbeat and deviation threshold are the directory's published
 * parameters. For an equity feed the heartbeat is stated for the 24/5 session
 * the feed follows; the vendor's own guidance is that these feeds hold the last
 * price and do not heartbeat while the underlying market is closed.
 */

export type FeedMarketHours = 'equity' | 'crypto';

export interface DirectoryFeed {
  /** Stable key for observations and links: rh-<ticker>-usd for equity feeds. */
  readonly key: string;
  /** The directory's name for the feed. A label, not what the contract says. */
  readonly name: string;
  readonly assetName: string;
  readonly marketHours: FeedMarketHours;
  /** For an equity feed: the stock-token symbol it prices. Null for crypto. */
  readonly ticker: string | null;
  readonly proxy: string;
  readonly aggregator: string;
  readonly svrProxy: string | null;
  readonly decimals: number;
  readonly heartbeatSeconds: number;
  readonly deviationThresholdPct: number;
  /** The directory's own tier label, reproduced verbatim. Not this project's rating. */
  readonly feedCategory: string;
  /** What \`description()\` returned at capture. The run-time tripwire. */
  readonly observedDescription: string | null;
  readonly observedDecimals: number | null;
}

export const FEED_DIRECTORY_SOURCE = {
  url: ${JSON.stringify(DIRECTORY_URL)},
  linkedFrom: ${JSON.stringify(LINKED_FROM)},
  retrievedAt: ${JSON.stringify(retrievedAt)},
  lastModified: ${JSON.stringify(response.headers['last-modified'] ?? null)},
  sha256: ${JSON.stringify(sha256)},
  listed: ${records.length},
  verifiedOnChain: ${verified.length},
  verifiedAtBlock: ${block.state === 'UNREAD' ? 'null' : block.value},
  network: ${JSON.stringify(network.label)},
} as const;

export const FEED_DIRECTORY: readonly DirectoryFeed[] = [
${lines.join('\n')}
];
`;

if (write) {
  writeFileSync(OUTPUT, module);
  console.log(`\nwrote ${OUTPUT} (${records.length} feeds)`);
} else {
  console.log(`\ndry run — ${OUTPUT} not written. Pass --write to write it.`);
}
