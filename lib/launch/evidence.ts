import type { DeskCodeVerification } from '../credits/code.ts';
import { expectedDeskImmutables } from '../credits/code.ts';
import type { CreditsConfig } from '../credits/config.ts';
import type { RateSnapshot } from '../credits/maintenance.ts';
import type { ObservationRecord } from '../store/types.ts';
import type { Reading } from '../doctrine/reading.ts';

/** Display freshness limit. This is not a transaction quote or an uptime SLA. */
export const LAUNCH_READ_MAX_AGE_MS = 30 * 60 * 1000;
export function recentRead(at: string, now: Date): boolean {
  if (typeof at !== 'string') return false;
  const age = now.getTime() - Date.parse(at);
  return Number.isFinite(age) && age >= 0 && age <= LAUNCH_READ_MAX_AGE_MS;
}
export function currentDeskCode(code: DeskCodeVerification | null | undefined, config: CreditsConfig, now: Date): boolean {
  if (code?.state !== 'MATCHES' || code.chainId !== config.network.chainId || typeof code.address !== 'string' || code.address.toLowerCase() !== config.desk || !recentRead(code.readAt, now) || !Array.isArray(code.immutables)) return false;
  const expected = Object.entries(expectedDeskImmutables(config));
  return code.immutables.length === expected.length && expected.every(([name, word]) => {
    const checks = code.immutables.filter((i) => i !== null && typeof i === 'object' && i.name === name);
    // expectedDeskImmutables supplies raw words to compareAgainst; its public
    // ImmutableCheck output prefixes both expected and onChain with 0x.
    const encoded = `0x${word}`;
    return checks.length === 1 && checks[0]!.matches === true && checks[0]!.expected === encoded && checks[0]!.onChain === encoded;
  });
}
export function currentRate(snapshot: RateSnapshot | null | undefined, config: CreditsConfig, now: Date): boolean {
  if (snapshot?.state !== 'READ' || snapshot.chainId !== config.network.chainId || config.priceSource === null || !recentRead(snapshot.at, now)) return false;
  const rate = snapshot.rate;
  if (!rate || typeof rate !== 'object' || !Number.isSafeInteger(rate.block) || rate.block < 0 || !rate.token || !rate.pool || !rate.quote || typeof rate.token.address !== 'string' || typeof rate.pool.address !== 'string' || typeof rate.usdPerCurb18 !== 'string') return false;
  return recentRead(rate.readAt, now) && rate.token.address.toLowerCase() === config.token && rate.pool.address.toLowerCase() === config.priceSource.pair && rate.pool.kind === config.priceSource.kind && rate.quote.kind === config.priceSource.quote.kind && (rate.quote.kind !== 'chainlink-feed' || (config.priceSource.quote.kind === 'chainlink-feed' && typeof rate.quote.feed === 'string' && rate.quote.feed.toLowerCase() === config.priceSource.quote.feed)) && /^[1-9]\d*$/.test(rate.usdPerCurb18);
}

/** A failed/malformed history must not be described as a single observation. */
export function rateHistory(read: Reading<readonly ObservationRecord[]> | null, now: Date, expectedKey: string | null): { state: 'UNREAD'; detail: string } | { state: 'READ'; count: number; low: bigint | null; high: bigint | null } {
  if (read === null || expectedKey === null) return { state: 'UNREAD', detail: 'history is not configured' };
  if (read.state === 'UNREAD') return { state: 'UNREAD', detail: `${read.reason}${read.detail ? ` — ${read.detail}` : ''}` };
  if (!Array.isArray(read.value)) return { state: 'UNREAD', detail: 'history is not an array of observations' };
  const values: bigint[] = [];
  for (const row of read.value) {
    if (!row || typeof row.observedAt !== 'string') return { state: 'UNREAD', detail: 'history contains a malformed observation' };
    const age = now.getTime() - Date.parse(row.observedAt);
    if (!Number.isFinite(age) || age < 0) return { state: 'UNREAD', detail: 'history contains an invalid observation time' };
    if (age > 24 * 3600 * 1000) continue;
    if (row.key !== expectedKey || row.decimals !== 18 || typeof row.raw !== 'string' || !/^[1-9]\d*$/.test(row.raw)) return { state: 'UNREAD', detail: 'history contains a different pricing source, malformed rate or unit scale' };
    values.push(BigInt(row.raw));
  }
  return { state: 'READ', count: values.length, low: values.length ? values.reduce((a, b) => a < b ? a : b) : null, high: values.length ? values.reduce((a, b) => a > b ? a : b) : null };
}
