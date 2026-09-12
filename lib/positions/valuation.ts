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
 * Component B (Ondo's AAPLon) is valued from the shares-per-token figure the
 * issuer publishes on its own product page — a total-return unit's share
 * count, read with the daily archive and dated by that read — and the same
 * AAPL / USD sample. Where an input is missing the component is
 * NOT_AVAILABLE with the reason, the lot is INCOMPLETE, and a missing price
 * is never shown as zero.
 */

import { AGENT_BY_ID } from '../agents/registry.ts';
import { freshnessSeconds } from '../doctrine/reading.ts';
import type { Store } from '../store/types.ts';
import { EVIDENCE_SOURCES, latestEvidence } from './evidence.ts';
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
  readonly atBlock: number | null;
  readonly atTime: string;
}

/** A decimal string such as "1.003376073740221058" as an integer at 18 places, or null when it is not a decimal. */
export function decimalTo18(text: string): bigint | null {
  const m = /^(\d+)(?:\.(\d{1,18}))?$/.exec(text.trim());
  if (!m) return null;
  return BigInt(m[1]!) * E18 + BigInt((m[2] ?? '').padEnd(18, '0'));
}

export type ComponentValue =
  | { readonly state: 'INDICATIVE'; readonly perUnitUsd: string; readonly price: PriceInput; readonly conversion: ConversionInput | null; readonly assumption: string }
  | { readonly state: 'NOT_AVAILABLE'; readonly reason: string };

export interface LotValuation {
  readonly state: 'INDICATIVE' | 'INCOMPLETE' | 'NOT_AVAILABLE';
  readonly perUnit: { readonly A: ComponentValue; readonly B: ComponentValue };
  /** Units of each component per lot, as a decimal string of whole units (illustrative, or the deployment's q read at 18 decimals). */
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

/** Base units at 18 places as a decimal string with the trailing zeros dropped: 10 for 10e18, 10.5 for 10.5e18. */
export function unitsText(base: bigint): string {
  const whole = base / E18;
  const frac = (base % E18).toString().padStart(18, '0').replace(/0+$/, '');
  return frac.length === 0 ? whole.toString() : `${whole.toString()}.${frac}`;
}

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
  // Kept in base units (18 places) for the arithmetic, so a lot of 10.5 units is not rounded to 10; shown as a decimal.
  const baseUnitsPerLot = { A: qIsBaseUnits ? q.A : q.A * E18, B: qIsBaseUnits ? q.B : q.B * E18 };
  const unitsPerLot = { A: unitsText(baseUnitsPerLot.A), B: unitsText(baseUnitsPerLot.B) };
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

  // ── component B: the issuer's shares-per-token figure, as archived ───────
  const pageSource = EVIDENCE_SOURCES.find((x) => x.id === 'ondo:AAPLon:page');
  const page = pageSource ? (await latestEvidence(store, [pageSource]))[0] : null;
  const multiplierText = page?.observation?.live?.sharesMultiplier ?? null;
  const multiplier = multiplierText === null ? null : decimalTo18(multiplierText);
  let B: ComponentValue;
  if (price === null) B = unavailable(priceReason ?? 'no price');
  else if (!page || page.observation === null) B = unavailable('the issuer’s product page has not been archived yet; the shares-per-token figure is not read from anywhere else');
  else if (page.observation.status !== 'OK' || multiplier === null) B = unavailable(`the issuer’s product page answered ${page.observation.status.toLowerCase().replace(/_/g, ' ')} and carries no shares-per-token figure this desk can read`);
  else if (multiplier <= 0n) B = unavailable('the issuer’s shares-per-token figure is zero; the page published nothing to price');
  else
    B = {
      state: 'INDICATIVE',
      perUnitUsd: toUsd2(multiplier * BigInt(price.priceRaw), 18 + price.decimals),
      price,
      conversion: {
        from: '1 AAPLon token',
        to: 'shares of AAPL, as the issuer states it',
        rawPerShare: multiplier.toString(),
        source: `${pageSource!.url} — sharesMultiplier as published, archived ${page.observation.readAt}`,
        atBlock: null,
        atTime: page.observation.readAt,
      },
      assumption: 'the issuer’s shares-per-token figure is taken as published on its product page; it moves with reinvested dividends and is dated by the archive’s read, not by a block; the price is an equity feed on another chain, not the token’s own market',
    };

  // Everything is kept at one scale so a total, when both sides exist, is a sum and not a re-rounding.
  const scale = A.state === 'INDICATIVE' ? 36 + A.price.decimals : B.state === 'INDICATIVE' ? 36 + B.price.decimals : 44;
  // base units (18) × raw per share (18) × price (decimals): one scale for both components, rounded once at the end.
  const perLotARaw = A.state === 'INDICATIVE' ? baseUnitsPerLot.A * BigInt(A.conversion?.rawPerShare ?? '0') * BigInt(A.price.priceRaw) : null;
  const perLotBRaw = B.state === 'INDICATIVE' ? baseUnitsPerLot.B * BigInt(B.conversion?.rawPerShare ?? '0') * BigInt(B.price.priceRaw) : null;
  const state: LotValuation['state'] = A.state === 'INDICATIVE' && B.state === 'INDICATIVE' ? 'INDICATIVE' : A.state === 'INDICATIVE' || B.state === 'INDICATIVE' ? 'INCOMPLETE' : 'NOT_AVAILABLE';
  return {
    state,
    perUnit: { A, B },
    unitsPerLot,
    perLotUsd: { A: perLotARaw === null ? null : toUsd2(perLotARaw, scale), B: perLotBRaw === null ? null : toUsd2(perLotBRaw, scale) },
    perLotUsdRaw: { A: perLotARaw === null ? null : perLotARaw.toString(), B: perLotBRaw === null ? null : perLotBRaw.toString(), scale },
    perLotTotalUsd: perLotARaw !== null && perLotBRaw !== null ? toUsd2(perLotARaw + perLotBRaw, scale) : null,
    note,
    computedAt,
  };
}
