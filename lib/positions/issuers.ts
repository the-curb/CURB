/**
 * Readers for what the issuers publish about the candidate components.
 *
 * Each reader fetches one documented endpoint, keeps the raw text exactly as
 * received, and parses only the fields the series needs. A refusal (401 or
 * 403), an outage, or a body that is not the shape the parser expects each
 * become their own explicit status — never an empty result, and never an
 * address copied from an example in the documentation.
 */

import { createHash } from 'node:crypto';
import { getText } from '../chain/transport.ts';

export type FetchStatus = 'OK' | 'ACCESS_DENIED' | 'HTTP_ERROR' | 'UNREACHABLE' | 'NOT_JSON' | 'SCHEMA_CHANGED';

export interface Fetched {
  readonly url: string;
  readonly status: FetchStatus;
  readonly httpStatus: number | null;
  readonly readAt: string;
  /** The body exactly as received, or null when there was none. */
  readonly raw: string | null;
  /** sha256 of the raw body, hex. */
  readonly hash: string | null;
  readonly detail: string | null;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

const isAddress = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

async function fetchWith(url: string, now: Date, headers: Readonly<Record<string, string>>, deniedDetail: (status: number) => string): Promise<Fetched> {
  const readAt = now.toISOString();
  try {
    const response = await getText(url, { timeoutMs: 20_000, headers });
    const raw = response.text || null;
    const hash = raw === null ? null : sha256Hex(raw);
    if (response.status === 401 || response.status === 403) {
      return { url, status: 'ACCESS_DENIED', httpStatus: response.status, readAt, raw, hash, detail: deniedDetail(response.status) };
    }
    if (!response.ok) {
      return { url, status: 'HTTP_ERROR', httpStatus: response.status, readAt, raw, hash, detail: `HTTP ${response.status}` };
    }
    return { url, status: 'OK', httpStatus: response.status, readAt, raw: response.text, hash: sha256Hex(response.text), detail: null };
  } catch (cause) {
    return { url, status: 'UNREACHABLE', httpStatus: null, readAt, raw: null, hash: null, detail: cause instanceof Error ? cause.message : 'unknown transport failure' };
  }
}

/** A documented public endpoint, read as any reader could. */
export async function fetchDocumented(url: string, now: Date): Promise<Fetched> {
  return fetchWith(url, now, {}, (status) => `HTTP ${status} — the endpoint refuses this reader; nothing is inferred from an example instead`);
}

/* ── xStocks ─────────────────────────────────────────────────────────────── */

export const XSTOCKS_ASSET_URL = (symbol: string) => `https://api.xstocks.fi/api/v2/public/assets/${encodeURIComponent(symbol)}`;

export interface XstocksDeployment {
  readonly network: string;
  /** The raw token — not the unit the series would hold. As the issuer writes it; not every network is an EVM. */
  readonly address: string;
  /** True when the address is a 20-byte hex address, i.e. the network is an EVM the verification can read. */
  readonly evm: boolean;
  readonly wrapperAddress: string | null;
  readonly wrapperAddressV2: string | null;
}

export interface XstocksAsset {
  readonly symbol: string;
  readonly name: string;
  readonly isin: string | null;
  readonly underlyingSymbol: string | null;
  readonly underlyingIsin: string | null;
  readonly isTradingHalted: boolean | null;
  readonly deployments: readonly XstocksDeployment[];
}

/**
 * The fields the series needs, and only those. The parser refuses a body
 * whose shape has moved: a renamed field is a change worth an explicit
 * status, not a silent null.
 */
export function parseXstocksAsset(raw: string): { ok: true; asset: XstocksAsset } | { ok: false; status: 'NOT_JSON' | 'SCHEMA_CHANGED'; detail: string } {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, status: 'NOT_JSON', detail: 'the body is not JSON' };
  }
  if (typeof body !== 'object' || body === null) return { ok: false, status: 'SCHEMA_CHANGED', detail: 'the body is not an object' };
  const o = body as Record<string, unknown>;
  const symbol = str(o.symbol);
  const name = str(o.name);
  if (symbol === null || name === null) return { ok: false, status: 'SCHEMA_CHANGED', detail: 'symbol or name is missing' };
  if (!Array.isArray(o.deployments)) return { ok: false, status: 'SCHEMA_CHANGED', detail: 'deployments is not an array' };

  const deployments: XstocksDeployment[] = [];
  for (const d of o.deployments as unknown[]) {
    if (typeof d !== 'object' || d === null) return { ok: false, status: 'SCHEMA_CHANGED', detail: 'a deployment is not an object' };
    const dep = d as Record<string, unknown>;
    const network = str(dep.network);
    const address = str(dep.address);
    if (network === null || address === null) return { ok: false, status: 'SCHEMA_CHANGED', detail: 'a deployment lacks network or address' };
    deployments.push({
      network,
      address: isAddress(address) ? address.toLowerCase() : address,
      evm: isAddress(address),
      wrapperAddress: isAddress(dep.wrapperAddress) ? dep.wrapperAddress.toLowerCase() : null,
      wrapperAddressV2: isAddress(dep.wrapperAddressV2) ? dep.wrapperAddressV2.toLowerCase() : null,
    });
  }
  return {
    ok: true,
    asset: {
      symbol,
      name,
      isin: str(o.isin),
      underlyingSymbol: str(o.underlyingSymbol),
      underlyingIsin: str(o.underlyingIsin),
      isTradingHalted: typeof o.isTradingHalted === 'boolean' ? o.isTradingHalted : null,
      deployments,
    },
  };
}

/* ── Ondo ────────────────────────────────────────────────────────────────── */

/**
 * Ondo's documented API (https://docs.ondo.finance/api-reference/overview,
 * OpenAPI at https://docs.ondo.finance/openapi.json): the addresses of one
 * asset across networks, behind an `x-api-key` header. Without a key the
 * endpoint answers 401 or 403, and that answer is the finding — the example
 * address in the specification is never promoted to configuration.
 */
export const ONDO_API_BASE = 'https://api.gm.ondo.finance';
export const ONDO_ADDRESSES_URL = (symbol: string) => `${ONDO_API_BASE}/v1/assets/${encodeURIComponent(symbol)}/addresses`;

export interface OndoAddress {
  /** As the API names it: "<chain name>-<chain id>", e.g. "ethereum-1". */
  readonly networkChainId: string;
  readonly chainId: number | null;
  readonly address: string;
  readonly decimals: number | null;
}

export interface OndoAsset {
  readonly symbol: string;
  readonly addresses: readonly OndoAddress[];
}

export function parseOndoAddresses(raw: string): { ok: true; asset: OndoAsset } | { ok: false; status: 'NOT_JSON' | 'SCHEMA_CHANGED'; detail: string } {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, status: 'NOT_JSON', detail: 'the body is not JSON' };
  }
  if (typeof body !== 'object' || body === null) return { ok: false, status: 'SCHEMA_CHANGED', detail: 'the body is not an object' };
  const o = body as Record<string, unknown>;
  const symbol = str(o.symbol);
  if (symbol === null || !Array.isArray(o.addresses)) return { ok: false, status: 'SCHEMA_CHANGED', detail: 'symbol or addresses is missing' };
  const addresses: OndoAddress[] = [];
  for (const a of o.addresses as unknown[]) {
    if (typeof a !== 'object' || a === null) return { ok: false, status: 'SCHEMA_CHANGED', detail: 'an address entry is not an object' };
    const entry = a as Record<string, unknown>;
    const networkChainId = str(entry.networkChainId);
    if (networkChainId === null || !isAddress(entry.address)) return { ok: false, status: 'SCHEMA_CHANGED', detail: 'an entry lacks networkChainId or address' };
    const tail = networkChainId.split('-').pop() ?? '';
    const chainId = /^[0-9]+$/.test(tail) ? Number(tail) : null;
    addresses.push({
      networkChainId,
      chainId,
      address: entry.address.toLowerCase(),
      decimals: typeof entry.decimals === 'number' && Number.isInteger(entry.decimals) ? entry.decimals : null,
    });
  }
  return { ok: true, asset: { symbol, addresses } };
}

/** The same fetch, with the key the issuer requires when one is configured. */
export async function fetchOndo(url: string, now: Date): Promise<Fetched> {
  const key = process.env.CURB_ONDO_API_KEY;
  return fetchWith(url, now, key ? { 'x-api-key': key } : {}, (status) =>
    key ? `HTTP ${status} with the configured key` : `HTTP ${status} — the endpoint requires an x-api-key and none is configured (CURB_ONDO_API_KEY)`,
  );
}
