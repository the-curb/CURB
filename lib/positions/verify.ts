/**
 * What the chain says about the addresses the issuers publish.
 *
 * For every candidate address in the latest evidence — the raw token and
 * each wrapper xStocks lists, the address Ondo lists when its endpoint
 * answers — this reads, on the position product's network: whether there is
 * code, the hash of that code, `symbol()`, `decimals()`, and for a wrapper
 * `asset()`, compared with the raw token the issuer named beside it.
 *
 * What this proves is narrow and stated: an address is a contract, it
 * answers as a token, and a wrapper points at the raw token it claims to
 * wrap. It does not prove a static balance under a corporate action, holder
 * eligibility, or anything about the issuer's reserves. Those are separate
 * gates and stay marked as such.
 */

import { decodeAddressWord, SELECTORS } from '../chain/abi.ts';
import { keccak256, toHex } from '../chain/keccak.ts';
import { positionsNetwork } from '../chain/networks.ts';
import { readCode, rpcCall, type RpcOptions } from '../chain/rpc.ts';
import { readTokenString, readTokenUint } from '../chain/token-read.ts';
import { isRead, unread, type Reading } from '../doctrine/reading.ts';
import type { SnapshotRecord, Store } from '../store/types.ts';
import { latestEvidence, type EvidenceSource } from './evidence.ts';
import type { OndoAsset, XstocksAsset } from './issuers.ts';

/** The reads are on request; this is the interval they are aged against. */
export const VERIFY_INTERVAL_SECONDS = 24 * 3600;

export type AddressRole = 'RAW_TOKEN' | 'WRAPPER_V1' | 'WRAPPER_V2' | 'ISSUER_TOKEN';

export interface Candidate {
  readonly sourceId: string;
  readonly component: 'A' | 'B';
  readonly role: AddressRole;
  readonly address: string;
  /** For a wrapper: the raw token the issuer lists beside it. */
  readonly claimedAsset: string | null;
  readonly networkChainId: number | null;
}

export interface Field<T> {
  readonly value: T | null;
  readonly state: 'VERIFIED' | 'UNREAD';
  readonly reason: string | null;
}

export interface AddressVerification extends Candidate {
  readonly chainId: number;
  readonly readAt: string;
  readonly source: string;
  readonly hasCode: Field<boolean>;
  readonly codeHash: Field<string>;
  readonly symbol: Field<string>;
  readonly decimals: Field<number>;
  readonly asset: Field<string>;
  /** MATCHES when asset() equals the raw token the issuer named; DRIFT when it does not; UNREAD when it could not be read; NOT_APPLICABLE for a raw token. */
  readonly assetMatchesClaim: 'MATCHES' | 'DRIFT' | 'UNREAD' | 'NOT_APPLICABLE';
  /** True only when the address has code, answers symbol() and decimals(), and — for a wrapper — asset() matches. */
  readonly answersAsToken: boolean;
  readonly notProven: readonly string[];
}

export const NOT_PROVEN = [
  'that the unit balance stays static under a corporate action (needs a fork test at a recorded block)',
  'that a Curb series contract or its receipt holders would be eligible holders',
  'anything about the issuer’s reserves, custody, or the value of a unit',
] as const;

const VERIFY_KEY = (seriesId: string) => `positions:verify:${seriesId}`;

function field<T>(reading: Reading<T>): Field<T> {
  return isRead(reading)
    ? { value: reading.value, state: 'VERIFIED', reason: null }
    : { value: null, state: 'UNREAD', reason: `${reading.reason}${reading.detail ? ` — ${reading.detail}` : ''}` };
}

/** Candidate addresses on the given chain, drawn from the parsed evidence and nothing else. */
export function candidatesFrom(chainId: number, evidence: readonly { source: EvidenceSource; observation: { parsed: XstocksAsset | OndoAsset | null } | null }[]): Candidate[] {
  const out: Candidate[] = [];
  for (const { source, observation } of evidence) {
    const parsed = observation?.parsed ?? null;
    if (parsed === null) continue;
    if (source.kind === 'xstocks-asset') {
      const asset = parsed as XstocksAsset;
      const chainName = chainId === 1 ? 'ethereum' : chainId === 11155111 ? 'sepolia' : null;
      for (const d of asset.deployments) {
        if (chainName === null || !d.evm || d.network.toLowerCase() !== chainName) continue;
        out.push({ sourceId: source.id, component: source.component, role: 'RAW_TOKEN', address: d.address, claimedAsset: null, networkChainId: chainId });
        if (d.wrapperAddress) out.push({ sourceId: source.id, component: source.component, role: 'WRAPPER_V1', address: d.wrapperAddress, claimedAsset: d.address, networkChainId: chainId });
        if (d.wrapperAddressV2) out.push({ sourceId: source.id, component: source.component, role: 'WRAPPER_V2', address: d.wrapperAddressV2, claimedAsset: d.address, networkChainId: chainId });
      }
    } else {
      const asset = parsed as OndoAsset;
      for (const a of asset.addresses) {
        if (a.chainId !== chainId) continue;
        out.push({ sourceId: source.id, component: source.component, role: 'ISSUER_TOKEN', address: a.address, claimedAsset: null, networkChainId: chainId });
      }
    }
  }
  return out;
}

async function readAsset(address: string, opts: RpcOptions): Promise<Reading<string>> {
  const raw = await rpcCall<string>('eth_call', [{ to: address, data: SELECTORS.asset }, 'latest'], opts);
  if (raw.state === 'UNREAD') return raw;
  if (raw.value === '0x' || raw.value === '') {
    return unread('FIELD_ABSENT', { source: raw.source, detail: 'asset() returned no data — the function reverted or is not implemented' });
  }
  const decoded = decodeAddressWord(raw.value);
  if (decoded === null) return unread('SOURCE_MALFORMED', { source: raw.source, detail: 'asset() undecodable as an address' });
  return { ...raw, value: decoded.toLowerCase() };
}

export async function verifyCandidate(candidate: Candidate, opts: RpcOptions, now: Date): Promise<AddressVerification> {
  const chainId = (opts.profile ?? positionsNetwork()).chainId;
  const [code, codeHex, symbol, decimals, asset] = await Promise.all([
    readCode(candidate.address, opts),
    rpcCall<string>('eth_getCode', [candidate.address, 'latest'], opts),
    readTokenString(candidate.address, 'symbol', opts),
    readTokenUint(candidate.address, 'decimals', opts),
    candidate.claimedAsset === null ? Promise.resolve(null) : readAsset(candidate.address, opts),
  ]);

  const codeHash: Field<string> =
    isRead(codeHex) && codeHex.value.length > 2
      ? { value: toHex(keccak256(Buffer.from(codeHex.value.slice(2), 'hex'))), state: 'VERIFIED', reason: null }
      : isRead(codeHex)
        ? { value: null, state: 'UNREAD', reason: 'no code at the address' }
        : field(codeHex);

  const hasCode = field(code.state === 'UNREAD' ? code : { ...code, value: code.value.hasCode });
  const decimalsField: Field<number> = isRead(decimals) ? { value: Number(decimals.value), state: 'VERIFIED', reason: null } : field(decimals);
  const assetField: Field<string> = asset === null ? { value: null, state: 'UNREAD', reason: 'not a wrapper — asset() is not asked' } : field(asset);

  const assetMatchesClaim: AddressVerification['assetMatchesClaim'] =
    candidate.claimedAsset === null ? 'NOT_APPLICABLE' : asset === null || !isRead(asset) ? 'UNREAD' : asset.value === candidate.claimedAsset ? 'MATCHES' : 'DRIFT';

  const answersAsToken =
    hasCode.value === true && symbol.state === 'VERIFIED' && decimalsField.state === 'VERIFIED' && (assetMatchesClaim === 'NOT_APPLICABLE' || assetMatchesClaim === 'MATCHES');

  return {
    ...candidate,
    chainId,
    readAt: now.toISOString(),
    source: isRead(code) ? code.source : isRead(symbol) ? symbol.source : `chain ${chainId}`,
    hasCode,
    codeHash,
    symbol: field(symbol),
    decimals: decimalsField,
    asset: assetField,
    assetMatchesClaim,
    answersAsToken,
    notProven: NOT_PROVEN,
  };
}

export interface Drift {
  readonly address: string;
  readonly role: AddressRole;
  readonly component: 'A' | 'B';
  readonly field: 'hasCode' | 'codeHash' | 'symbol' | 'decimals' | 'asset' | 'answersAsToken';
  readonly from: string;
  readonly to: string;
}

/** A field that moved between two runs, for every address both runs read. */
export function driftBetween(before: readonly AddressVerification[], after: readonly AddressVerification[]): Drift[] {
  const out: Drift[] = [];
  for (const b of before) {
    const a = after.find((x) => x.address === b.address && x.role === b.role);
    if (!a) continue;
    const fields = ['hasCode', 'codeHash', 'symbol', 'decimals', 'asset'] as const;
    for (const field of fields) {
      const x = b[field];
      const y = a[field];
      if (x.state === 'VERIFIED' && y.state === 'VERIFIED' && String(x.value) !== String(y.value)) {
        out.push({ address: a.address, role: a.role, component: a.component, field, from: String(x.value), to: String(y.value) });
      }
    }
    if (b.answersAsToken && !a.answersAsToken) {
      out.push({ address: a.address, role: a.role, component: a.component, field: 'answersAsToken', from: 'true', to: 'false' });
    }
  }
  return out;
}

export interface VerificationRun {
  readonly seriesId: string;
  readonly chainId: number;
  readonly network: string;
  readonly ranAt: string;
  readonly candidates: number;
  readonly verifications: readonly AddressVerification[];
  readonly recorded: boolean;
  readonly note: string | null;
  readonly drift: readonly Drift[];
}

export interface StoredVerification {
  readonly seriesId: string;
  readonly chainId: number;
  readonly network: string;
  readonly ranAt: string;
  readonly verifications: readonly AddressVerification[];
  readonly drift?: readonly Drift[];
  readonly previousRanAt?: string | null;
  readonly driftSince?: string | null;
  readonly lastDrift?: readonly Drift[];
}

/** Verify every candidate the latest evidence names for a series, and record the run. */
export async function verifySeriesCandidates(store: Store, seriesId: string, now: Date): Promise<VerificationRun> {
  const profile = positionsNetwork();
  const opts: RpcOptions = { profile, intervalSeconds: VERIFY_INTERVAL_SECONDS };
  const evidence = (await latestEvidence(store)).filter((e) => e.source.seriesId === seriesId);
  const candidates = candidatesFrom(profile.chainId, evidence);
  const verifications: AddressVerification[] = [];
  for (const candidate of candidates) verifications.push(await verifyCandidate(candidate, opts, now));

  // What moved since the last run: a code hash, a symbol, decimals, the asset
  // behind a wrapper, or an address that answered as a token and no longer
  // does. Recorded with the run, so the conditions can name it (T15).
  const previous = await latestVerification(store, seriesId);
  const drift = previous.run === null ? [] : driftBetween(previous.run.verifications, verifications);

  const record: SnapshotRecord = {
    key: VERIFY_KEY(seriesId),
    observedAt: now.toISOString(),
    payload: {
      seriesId,
      chainId: profile.chainId,
      network: profile.id,
      ranAt: now.toISOString(),
      verifications,
      drift,
      previousRanAt: previous.run?.ranAt ?? null,
      // A drift found earlier stays on the record for two days even when the
      // next run sees nothing new, so a person has time to read it.
      driftSince: drift.length > 0 ? now.toISOString() : previous.run?.driftSince ?? null,
      lastDrift: drift.length > 0 ? drift : previous.run?.lastDrift ?? [],
    } as unknown as Record<string, unknown>,
  };
  const written = await store.writeSnapshots([record]);
  return {
    seriesId,
    chainId: profile.chainId,
    network: profile.id,
    ranAt: now.toISOString(),
    candidates: candidates.length,
    verifications,
    recorded: written.state === 'WRITTEN',
    note: candidates.length === 0 ? 'no candidate address on this network in the archived evidence — nothing was read' : null,
    drift,
  };
}

export async function latestVerification(store: Store, seriesId: string): Promise<{ run: StoredVerification | null; storeFault: string | null }> {
  const read = await store.snapshots(VERIFY_KEY(seriesId));
  if (read.state === 'UNREAD') return { run: null, storeFault: `${read.reason}${read.detail ? ` — ${read.detail}` : ''}` };
  const snap = read.value.find((s) => s.key === VERIFY_KEY(seriesId));
  if (!snap) return { run: null, storeFault: null };
  return { run: snap.payload as unknown as StoredVerification, storeFault: null };
}
