/**
 * The issuer's own product page for an asset — app.ondo.finance/assets/<symbol>,
 * the page Ondo's trust document points holders to for reports.
 *
 * The page is a server-rendered React payload that carries the asset's
 * record as escaped JSON: symbol, underlying, ticker, the deployments per
 * network with chain id and decimals, and the live shares-per-token
 * multiplier. That record is published by the issuer, on the issuer's page,
 * for this asset. It is not an example in a specification, and it is the
 * source the candidate address for component B is taken from. A page whose
 * payload no longer carries the record is SCHEMA_CHANGED, not a silent null.
 */

import type { OndoAddress, OndoAsset } from './issuers.ts';

export const ONDO_ASSET_PAGE_URL = (symbol: string) => `https://app.ondo.finance/assets/${encodeURIComponent(symbol.toLowerCase())}`;

export interface OndoAssetPage extends OndoAsset {
  readonly underlyingName: string | null;
  readonly ticker: string | null;
}

/** Fields the page publishes that move by design and are not part of the record's identity. */
export interface OndoAssetPageLive {
  /** Shares of the underlying per token, as the issuer states it: a decimal string. */
  readonly sharesMultiplier: string | null;
}

const isAddress = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** The payload escapes quotes and backslashes once; undo that and nothing else. */
function unescapeRsc(fragment: string): string {
  return fragment.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

/** `\"name\":\"value\"` inside the escaped payload. */
function escapedField(window: string, name: string): string | null {
  const m = new RegExp(`\\\\"${name}\\\\":\\\\"([^"\\\\]*)\\\\"`).exec(window);
  return m ? m[1]! : null;
}

export function parseOndoAssetPage(
  raw: string,
  expectedSymbol: string,
): { ok: true; asset: OndoAssetPage; live: OndoAssetPageLive } | { ok: false; status: 'NOT_JSON' | 'SCHEMA_CHANGED'; detail: string } {
  const symbolAt = raw.indexOf(`\\"symbol\\":\\"${expectedSymbol}\\"`);
  if (symbolAt < 0) return { ok: false, status: 'SCHEMA_CHANGED', detail: `the page carries no record for ${expectedSymbol}` };
  const window = raw.slice(Math.max(0, symbolAt - 400), symbolAt + 4000);
  const networksAt = window.indexOf('\\"supportedNetworks\\":[');
  if (networksAt < 0) return { ok: false, status: 'SCHEMA_CHANGED', detail: 'the record carries no supportedNetworks' };
  const arrayStart = window.indexOf('[', networksAt);
  let depth = 0;
  let arrayEnd = -1;
  for (let i = arrayStart; i < window.length; i += 1) {
    const ch = window[i];
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        arrayEnd = i;
        break;
      }
    }
  }
  if (arrayEnd < 0) return { ok: false, status: 'SCHEMA_CHANGED', detail: 'supportedNetworks does not close' };
  let networks: unknown;
  try {
    networks = JSON.parse(unescapeRsc(window.slice(arrayStart, arrayEnd + 1)));
  } catch {
    return { ok: false, status: 'NOT_JSON', detail: 'supportedNetworks is not JSON once unescaped' };
  }
  if (!Array.isArray(networks)) return { ok: false, status: 'SCHEMA_CHANGED', detail: 'supportedNetworks is not an array' };
  const addresses: OndoAddress[] = [];
  for (const n of networks as unknown[]) {
    if (typeof n !== 'object' || n === null) return { ok: false, status: 'SCHEMA_CHANGED', detail: 'a network entry is not an object' };
    const e = n as Record<string, unknown>;
    const network = str(e.network);
    const address = str(e.address);
    const chainId = typeof e.chainId === 'number' && Number.isInteger(e.chainId) ? e.chainId : null;
    if (network === null || address === null) return { ok: false, status: 'SCHEMA_CHANGED', detail: 'a network entry lacks network or address' };
    addresses.push({
      networkChainId: `${network.toLowerCase()}-${chainId ?? 'unknown'}`,
      // Only an EVM address on a numbered chain is a candidate anywhere; the rest is kept as published.
      chainId: isAddress(address) ? chainId : null,
      address: isAddress(address) ? address.toLowerCase() : address,
      decimals: typeof e.decimals === 'number' && Number.isInteger(e.decimals) ? e.decimals : null,
    });
  }
  return {
    ok: true,
    asset: { symbol: expectedSymbol, addresses, underlyingName: escapedField(window, 'underlyingName'), ticker: escapedField(window, 'ticker') },
    live: { sharesMultiplier: escapedField(window, 'sharesMultiplier') },
  };
}
