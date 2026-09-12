/**
 * An indicative value, in the mechanism's sense (§8): an estimate from dated
 * sources, each named with both of its times, never a quote, and never
 * totalled while a component has no price.
 *
 * Component A (the current xStocks wrapper) is valued from two inputs the
 * desk already holds: the wrapper's own conversion rate, as the fork test
 * read it at a recorded block (shares → raw AAPLx), and the Chainlink
 * "Robinhood AAPL / USD" reading the Pillar last sampled on Robinhood Chain.
 * The assumption between them is stated on the record: one raw AAPLx, as
 * balanceOf reports it, is treated as exposure to one AAPL share, because
 * the issuer's multiplier is already applied to balances on EVM chains. The
 * feed is an equity price on another chain, not the token's own market.
 *
 * Component B has no address this desk can read and no conversion, so it
 * is NOT_AVAILABLE with the reason, and the lot is INCOMPLETE. A missing
 * price is never shown as zero.
 */

import { AGENT_BY_ID } from '../agents/registry.ts';
import { freshnessSeconds } from '../doctrine/reading.ts';
import type { Store } from '../store/types.ts';
import { forkEvidenceOf } from './fork-evidence.ts';
import type { SeriesSpec } from './series.ts';

export interface PriceInput {
  readonly unit: string;
  readonly price: string;
  readonly priceRaw: string;
  readonly decimals: number;
  readonly source: string;
  readonly feedUpdatedAt: string;
  readonly sampledAt: string;
  readonly feedAgeSeconds: number;
  readonly sampleAgeSeconds: number;
}

export interface ConversionInput {
  readonly from: string;
  readonly to: string;
  /** Raw per 1e18 shares, as a string of base units. */
  readonly rawPerShare: string;
  readonly source: string;
  readonly atBlock: number;
  readonly atTime: string;
}

export type ComponentValue =
  | { readonly state: 'INDICATIVE'; readonly perUnitUsd: string; readonly price: PriceInput; readonly conversion: ConversionInput | null; readonly assumption: string }
  | { readonly state: 'NOT_AVAILABLE'; readonly reason: string };

export interface LotValuation {
  readonly state: 'INDICATIVE' | 'INCOMPLETE' | 'NOT_AVAILABLE';
  readonly perUnit: { readonly A: ComponentValue; readonly B: ComponentValue };
  /** Units of each component per lot, as whole units (illustrative or from the deployment's q at 18 decimals). */
  readonly unitsPerLot: { readonly A: string; readonly B: string };
  /** The value of one lot's A, when A is indicative; B likewise. */
  readonly perLotUsd: { readonly A: string | null; readonly B: string | null };
  /** The same as integers at `scale` decimal places, for arithmetic on lots without re-rounding. */
  readonly perLotUsdRaw: { readonly A: string | null; readonly B: string | null; readonly scale: number };
  /** Never filled while any component is missing. */
  readonly perLotTotalUsd: string | null;
  readonly note: string;
  readonly computedAt: string;
}

const FEED_KEY = 'feed:rh-aapl-usd';
const E18 = 10n ** 18n;

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A number of `scale` decimals as a string with two places, rounded half up. */
export function toUsd2(value: bigint, scale: number): string {
  const drop = scale - 2;
  const rounded = drop > 0 ? (value + 5n * 10n ** BigInt(drop - 1)) / 10n ** BigInt(drop) : value * 10n ** BigInt(-drop);
  const whole = rounded / 100n;
  const cents = (rounded % 100n).toString().padStart(2, '0');
  return `${whole.toLocaleString('en-US')}.${cents}`;
}

export async function indicativeValuation(store: Store, spec: SeriesSpec, q: { readonly A: bigint; readonly B: bigint }, qIsBaseUnits: boolean): Promise<LotValuation> {
  const computedAt = new Date().toISOString();
  const unitsPerLot = {
    A: qIsBaseUnits ? (q.A / E18).toString() : q.A.toString(),
    B: qIsBaseUnits ? (q.B / E18).toString() : q.B.toString(),
  };
  const note = 'an estimate from dated sources, each named with both of its times; not a quote, not an offer, and never totalled while a component has no price';
  const unavailable = (reason: string): ComponentValue => ({ state: 'NOT_AVAILABLE', reason });

  // ── the price: the Pillar's last sample of the AAPL / USD feed ────────────
  const read = await store.snapshots(FEED_KEY);
  const snap = read.state === 'UNREAD' ? null : (read.value.find((s) => s.key === FEED_KEY) ?? null);
  let price: PriceInput | null = null;
  let priceReason: string | null = null;
  if (read.state === 'UNREAD') priceReason = `the desk's record could not be read (${read.reason})`;
  else if (snap === null) priceReason = 'the desk has not sampled the AAPL / USD feed';
  else {
    const p = snap.payload;
    const sampleAge = Math.max(0, Math.round((Date.now() - new Date(snap.observedAt).getTime()) / 1000));
    const updatedAt = num(p.updatedAt);
    const raw = str(p.raw);
    const decimals = num(p.decimals);
    const fresh = freshnessSeconds(AGENT_BY_ID.pillar.intervalSeconds ?? 15 * 60);
    if (str(p.price) === null || raw === null || decimals === null || updatedAt === null) priceReason = str(p.notPricedBecause) ?? 'the feed sample carries no price';
    else if (p.identity !== 'MATCHES') priceReason = 'the feed no longer describes itself as recorded; its price is withheld';
    else if (p.pauseFlag === 'SET') priceReason = 'the feed is flagged paused';
    else if (sampleAge > fresh) priceReason = `the last sample is ${Math.round(sampleAge / 60)} minutes old, past the ${Math.round(fresh / 60)}-minute freshness the desk allows`;
    else
      price = {
        unit: 'AAPL / USD',
        price: str(p.price)!,
        priceRaw: raw,
        decimals,
        source: `${str(p.name) ?? 'Robinhood AAPL / USD'} — Chainlink on Robinhood Chain, as the Pillar read it`,
        feedUpdatedAt: new Date(updatedAt * 1000).toISOString(),
        sampledAt: snap.observedAt,
        feedAgeSeconds: Math.max(0, Math.round(Date.now() / 1000 - updatedAt)),
        sampleAgeSeconds: sampleAge,
      };
  }

  // ── component A: the wrapper's conversion at the recorded fork block ──────
  const fork = await forkEvidenceOf(spec.id);
  let A: ComponentValue;
  if (price === null) A = unavailable(priceReason ?? 'no price');
  else if (fork.evidence === null || fork.evidence.component !== 'A') A = unavailable('the wrapper’s conversion rate has not been read on a fork; no rate, no value');
  else {
    const quoted = BigInt(fork.evidence.findings.unwrapQuotedFor10e18);
    if (quoted <= 0n) A = unavailable('the recorded conversion is zero; the wrapper quoted nothing');
    else {
      const rawPerShare = quoted / 10n; // 10e18 shares were quoted
      const perUnit26 = rawPerShare * BigInt(price.priceRaw); // 18 + decimals places
      A = {
        state: 'INDICATIVE',
        perUnitUsd: toUsd2(perUnit26, 18 + price.decimals),
        price,
        conversion: {
          from: '1 wrapper share (wAAPLx)',
          to: 'raw AAPLx, as balanceOf reports it',
          rawPerShare: rawPerShare.toString(),
          source: 'contracts/evidence/apple-s1.fork.json — convertToAssets on a fork of Ethereum',
          atBlock: fork.evidence.block,
          atTime: new Date(fork.evidence.blockTimestamp * 1000).toISOString(),
        },
        assumption: 'one raw AAPLx, as balanceOf reports it, is treated as exposure to one AAPL share: the issuer applies its corporate-action multiplier to balances on EVM chains; the price is an equity feed on another chain, not the token’s own market',
      };
    }
  }

  // ── component B: no address, no conversion ────────────────────────────────
  const B: ComponentValue = unavailable('no address this desk can read and no conversion: the issuer’s record is behind an API key, and the token is a total-return unit whose shares per token are not read');

  // Everything is kept at one scale so a total, when both sides exist, is a sum and not a re-rounding.
  const scale = A.state === 'INDICATIVE' ? 18 + A.price.decimals : 26;
  const perLotARaw = A.state === 'INDICATIVE' ? BigInt(unitsPerLot.A) * BigInt(A.conversion?.rawPerShare ?? '0') * BigInt(A.price.priceRaw) : null;
  // B is never indicative today; the shape is kept general for the day it is.
  const perLotBRaw = (B as ComponentValue).state === 'INDICATIVE' ? 0n : null;
  const state: LotValuation['state'] = A.state === 'INDICATIVE' && B.state === 'INDICATIVE' ? 'INDICATIVE' : A.state === 'INDICATIVE' || B.state === 'INDICATIVE' ? 'INCOMPLETE' : 'NOT_AVAILABLE';
  return {
    state,
    perUnit: { A, B },
    unitsPerLot,
    perLotUsd: { A: perLotARaw === null ? null : toUsd2(perLotARaw, scale), B: perLotBRaw === null ? null : toUsd2(perLotBRaw, scale) },
    perLotUsdRaw: { A: perLotARaw === null ? null : perLotARaw.toString(), B: perLotBRaw === null ? null : String(perLotBRaw), scale },
    perLotTotalUsd: perLotARaw !== null && perLotBRaw !== null ? toUsd2(perLotARaw + perLotBRaw, scale) : null,
    note,
    computedAt,
  };
}
