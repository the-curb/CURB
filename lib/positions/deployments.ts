/**
 * Where a series lives on chain — when it lives anywhere.
 *
 * No series is deployed. A deployment is configured, never assumed: it comes
 * from `CURB_SERIES_DEPLOYMENTS`, a JSON object keyed by series id, filled
 * only from a reviewed deployment record. An entry that does not parse is
 * an explicit fault, not a silent skip, and an absent entry means the index
 * and the reconciliation report NOT_DEPLOYED rather than reading anything.
 *
 *   {
 *     "apple-s1": {
 *       "chainId": 1,
 *       "address": "0x…",
 *       "components": { "A": "0x…", "B": "0x…" },
 *       "fromBlock": 21000000,
 *       "q": { "A": "10000000000000000000", "B": "20000000000000000000" },
 *       "capLots": "1000"
 *     }
 *   }
 */

export interface SeriesDeployment {
  readonly seriesId: string;
  readonly chainId: number;
  /** The series contract. */
  readonly address: string;
  /** The component token contracts the series holds. */
  readonly components: { readonly A: string; readonly B: string };
  /** The block the contract was created in; indexing starts there. */
  readonly fromBlock: number;
  /** The contract's immutable units per lot and its lot cap, as deployed — never the illustrative figures. */
  readonly q: { readonly A: bigint; readonly B: bigint };
  readonly capLots: bigint;
}

export type DeploymentStatus =
  | { readonly state: 'NOT_DEPLOYED'; readonly detail: string }
  | { readonly state: 'CONFIG_INVALID'; readonly detail: string }
  | { readonly state: 'CONFIGURED'; readonly deployment: SeriesDeployment };

export const DEPLOYMENTS_ENV = 'CURB_SERIES_DEPLOYMENTS';

const isAddress = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);
const units = (v: unknown): bigint | null => (typeof v === 'string' && /^[1-9][0-9]*$/.test(v) ? BigInt(v) : null);

export function parseDeployments(raw: string | undefined): { ok: true; deployments: Record<string, SeriesDeployment> } | { ok: false; detail: string } {
  if (raw === undefined || raw.trim() === '') return { ok: true, deployments: {} };
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, detail: `${DEPLOYMENTS_ENV} is not JSON` };
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, detail: `${DEPLOYMENTS_ENV} must be an object keyed by series id` };
  const out: Record<string, SeriesDeployment> = {};
  for (const [seriesId, entry] of Object.entries(body as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null) return { ok: false, detail: `${seriesId}: entry is not an object` };
    const e = entry as Record<string, unknown>;
    const components = e.components as Record<string, unknown> | undefined;
    const q = e.q as Record<string, unknown> | undefined;
    if (!Number.isInteger(e.chainId) || (e.chainId as number) <= 0) return { ok: false, detail: `${seriesId}: chainId must be a positive integer` };
    if (!isAddress(e.address)) return { ok: false, detail: `${seriesId}: address is not a 20-byte hex address` };
    if (!components || !isAddress(components.A) || !isAddress(components.B)) return { ok: false, detail: `${seriesId}: components.A and components.B must be addresses` };
    if (components.A.toLowerCase() === components.B.toLowerCase()) return { ok: false, detail: `${seriesId}: the two components share an address — refused (T19)` };
    if (!Number.isInteger(e.fromBlock) || (e.fromBlock as number) < 0) return { ok: false, detail: `${seriesId}: fromBlock must be a non-negative integer` };
    const qA = q ? units(q.A) : null;
    const qB = q ? units(q.B) : null;
    const capLots = units(e.capLots);
    if (qA === null || qB === null) return { ok: false, detail: `${seriesId}: q.A and q.B must be positive integer strings of base units` };
    if (capLots === null) return { ok: false, detail: `${seriesId}: capLots must be a positive integer string` };
    out[seriesId] = {
      seriesId,
      chainId: e.chainId as number,
      address: e.address.toLowerCase(),
      components: { A: components.A.toLowerCase(), B: components.B.toLowerCase() },
      fromBlock: e.fromBlock as number,
      q: { A: qA, B: qB },
      capLots,
    };
  }
  return { ok: true, deployments: out };
}

export function deploymentOf(seriesId: string, raw: string | undefined = process.env[DEPLOYMENTS_ENV]): DeploymentStatus {
  const parsed = parseDeployments(raw);
  if (!parsed.ok) return { state: 'CONFIG_INVALID', detail: parsed.detail };
  const deployment = parsed.deployments[seriesId];
  if (!deployment) return { state: 'NOT_DEPLOYED', detail: `no reviewed deployment is configured for ${seriesId}; nothing is read from a chain for it` };
  return { state: 'CONFIGURED', deployment };
}
