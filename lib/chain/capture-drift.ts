/**
 * Whether the world has moved on from the capture.
 *
 * The two registries this system reads from are generated modules: what the
 * issuer's asset registry and the vendor's feed directory said on the day
 * they were captured. Tokens get listed; feeds get added; a proxy gets
 * re-pointed. None of that reaches an agent that only reads the capture —
 * the system would go on saying "194 tokens, 57 feeds" while the world said
 * otherwise, and nothing would be wrong in any reading it produced.
 *
 * So the live sources are fetched once a day and diffed against the capture.
 * The diff is a measurement with a source and a time; the fix is a
 * re-capture (scripts/capture-*.ts), never an edit by hand, and never an
 * agent quietly reading an address the capture has not verified on chain.
 */

import { getText } from './transport.ts';
import { read, unread, type Reading } from '../doctrine/reading.ts';
import { STOCK_TOKENS, STOCK_TOKENS_SOURCE } from './stock-tokens.ts';
import { FEED_DIRECTORY, FEED_DIRECTORY_SOURCE } from './feed-directory.ts';
import { activeNetwork } from './networks.ts';

export interface ListedToken {
  readonly id: string;
  readonly ticker: string;
  readonly address: string;
}

export interface TokenDrift {
  readonly listed: number;
  readonly captured: number;
  /** Listed by the issuer, absent from the capture. Not read by any agent until re-captured. */
  readonly added: readonly ListedToken[];
  /** In the capture, no longer listed. Still read by agents until re-captured. */
  readonly removed: readonly { readonly ticker: string; readonly address: string }[];
  /** Same registry id, different contract address: the capture points at the wrong contract. */
  readonly moved: readonly { readonly ticker: string; readonly captured: string; readonly listed: string }[];
}

/** Pure: the issuer's current list against the capture, joined by registry id. */
export function diffTokens(listed: readonly ListedToken[]): TokenDrift {
  const byId = new Map(listed.map((t) => [t.id.toLowerCase(), t]));
  const capturedIds = new Set(STOCK_TOKENS.map((t) => t.registryId.toLowerCase()));
  const added = listed.filter((t) => !capturedIds.has(t.id.toLowerCase())).sort((a, b) => a.ticker.localeCompare(b.ticker));
  const removed = STOCK_TOKENS.filter((t) => !byId.has(t.registryId.toLowerCase()))
    .map((t) => ({ ticker: t.ticker, address: t.address }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
  const moved = STOCK_TOKENS.flatMap((t) => {
    const now = byId.get(t.registryId.toLowerCase());
    if (!now || now.address.toLowerCase() === t.address.toLowerCase()) return [];
    return [{ ticker: t.ticker, captured: t.address, listed: now.address }];
  });
  return { listed: listed.length, captured: STOCK_TOKENS.length, added, removed, moved };
}

export interface ListedFeed {
  readonly name: string;
  readonly proxy: string;
}

export interface FeedDrift {
  readonly listed: number;
  readonly captured: number;
  readonly added: readonly ListedFeed[];
  readonly removed: readonly ListedFeed[];
}

/** Pure: the vendor's current directory against the capture, joined by proxy address. */
export function diffFeeds(listed: readonly ListedFeed[]): FeedDrift {
  const listedProxies = new Set(listed.map((f) => f.proxy.toLowerCase()));
  const capturedProxies = new Set(FEED_DIRECTORY.map((f) => f.proxy.toLowerCase()));
  return {
    listed: listed.length,
    captured: FEED_DIRECTORY.length,
    added: listed.filter((f) => !capturedProxies.has(f.proxy.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name)),
    removed: FEED_DIRECTORY.filter((f) => !listedProxies.has(f.proxy.toLowerCase()))
      .map((f) => ({ name: f.name, proxy: f.proxy }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

const opts = { timeoutMs: 30_000 };

export async function fetchListedTokens(intervalSeconds: number): Promise<Reading<ListedToken[]>> {
  const url = STOCK_TOKENS_SOURCE.url;
  const source = `${new URL(url).host} · asset registry`;
  const startedAt = new Date();
  try {
    const response = await getText(url, opts);
    if (!response.ok) return unread('SOURCE_UNREACHABLE', { source, detail: `HTTP ${response.status}` });
    const body = JSON.parse(response.text) as { assets?: unknown };
    if (!Array.isArray(body.assets)) return unread('SOURCE_MALFORMED', { source, detail: 'no assets array in the response' });
    const chainId = activeNetwork().chainId;
    const listed: ListedToken[] = [];
    for (const raw of body.assets as Record<string, unknown>[]) {
      const deployments = Array.isArray(raw.deployments) ? (raw.deployments as Record<string, unknown>[]) : [];
      const here = deployments.find((d) => d.chainId === chainId);
      if (!here || typeof here.contractAddress !== 'string' || typeof raw.id !== 'string' || typeof raw.tokenSymbol !== 'string') continue;
      listed.push({ id: raw.id, ticker: raw.tokenSymbol, address: here.contractAddress });
    }
    return read({ value: listed, source, retrievedAt: startedAt, intervalSeconds });
  } catch (cause) {
    const aborted = cause instanceof Error && cause.name === 'AbortError';
    return unread(aborted ? 'SOURCE_TIMEOUT' : 'SOURCE_UNREACHABLE', { source, detail: cause instanceof Error ? cause.message : 'unknown transport failure' });
  }
}

export async function fetchListedFeeds(intervalSeconds: number): Promise<Reading<ListedFeed[]>> {
  const url = FEED_DIRECTORY_SOURCE.url;
  const source = `${new URL(url).host} · feed directory`;
  const startedAt = new Date();
  try {
    const response = await getText(url, opts);
    if (!response.ok) return unread('SOURCE_UNREACHABLE', { source, detail: `HTTP ${response.status}` });
    const body = JSON.parse(response.text) as unknown;
    if (!Array.isArray(body)) return unread('SOURCE_MALFORMED', { source, detail: 'the directory is not an array' });
    const listed: ListedFeed[] = [];
    for (const raw of body as Record<string, unknown>[]) {
      if (typeof raw.name !== 'string' || typeof raw.proxyAddress !== 'string') continue;
      listed.push({ name: raw.name, proxy: raw.proxyAddress });
    }
    return read({ value: listed, source, retrievedAt: startedAt, intervalSeconds });
  } catch (cause) {
    const aborted = cause instanceof Error && cause.name === 'AbortError';
    return unread(aborted ? 'SOURCE_TIMEOUT' : 'SOURCE_UNREACHABLE', { source, detail: cause instanceof Error ? cause.message : 'unknown transport failure' });
  }
}
