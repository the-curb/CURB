/**
 * Ten agents, one job each. What each of them refuses to do is as defined as
 * what it does, and the refusal is enforced in `doctrine/policy.ts`, not in a
 * prompt.
 *
 * Each agent declares its interval as a single number. Everything else follows:
 * what the site promises, which agents are due on a given run, and when a figure
 * is too old to describe the present. Choosing those three separately is how they
 * drift apart.
 *
 * `intervalSeconds: null` means on request — never scheduled, never counted as a
 * failure for staying quiet.
 */
import { absenceSeconds, freshnessSeconds } from '../doctrine/reading.ts';

export type AgentId =
  | 'registrar'
  | 'bell'
  | 'pillar'
  | 'specialist'
  | 'archivist'
  | 'surveyor'
  | 'counsel'
  | 'tally'
  | 'warden'
  | 'herald';

export type AgentPosture = 'MEASURES' | 'PROMOTES';

export interface AgentSpec {
  readonly id: AgentId;
  readonly name: string;
  readonly district: string;
  readonly role: string;
  /** In its own voice. One line. */
  readonly line: string;
  readonly posture: AgentPosture;
  /** Null means on request. */
  readonly intervalSeconds: number | null;
  /** How many named sources it is expected to reach on a healthy run. */
  readonly sourcesExpected: number;
  /**
   * The floor below which it declares UNKNOWN instead of publishing a reading.
   * Coverage before conclusion.
   */
  readonly minimumSources: number;
  /** The single sentence describing what it will not do. Published verbatim. */
  readonly refusal: string;
  readonly reads: readonly string[];
}

const HOURS = 3600;

export const AGENTS: readonly AgentSpec[] = [
  {
    id: 'registrar',
    name: 'THE REGISTRAR',
    district: 'THE REGISTRY',
    role: 'Token provenance & authority',
    line: 'I do not decide what it is. I tell you what the chain says about it.',
    posture: 'MEASURES',
    intervalSeconds: 24 * HOURS,
    // Seven groups: the stock-token beacon; code, metadata, supply and proxy
    // shape for the one contract under audit; and the issuer's live registry
    // and the vendor's live directory, each checked against its capture.
    sourcesExpected: 7,
    minimumSources: 3,
    refusal:
      'Reports what was found. Never says a token is backed, safe, or a scam — in either direction.',
    reads: [
      'The one beacon every stock token delegates to — implementation() and its code hash, against the ones recorded at capture',
      'Robinhood Chain RPC — contract code and storage of the contract under audit',
      'Proxy shape: implementation, admin and beacon slots, against the recorded tripwire',
      'Pause, freeze and transfer-restriction state',
      'Decimals, total supply, issuer metadata',
      'The issuer registry and the vendor feed directory as published today, against the captured copies — what was added, removed or moved since capture',
    ],
  },
  {
    id: 'bell',
    name: 'THE BELL',
    district: 'THE FLOOR',
    role: 'Session state & price age',
    line: 'The chain never closes. The exchange does. Those are not the same clock.',
    posture: 'MEASURES',
    intervalSeconds: 5 * 60,
    sourcesExpected: 2,
    minimumSources: 1,
    refusal:
      'States the session and the age of the last price. Never implies a closed-market price is a tradeable price.',
    reads: [
      'Exchange session calendar — regular, pre, post, holiday, half-day',
      'On-chain oracle last-update block and timestamp',
    ],
  },
  {
    id: 'pillar',
    name: 'PILLAR',
    district: 'THE FLOOR',
    role: 'Price feeds & staleness',
    line: 'Every price I show you has an age. Most places hide it.',
    posture: 'MEASURES',
    intervalSeconds: 15 * 60,
    // Every tokenized-equity feed (35), the crypto rotation (4), and the session
    // calendar (1). A test pins this to the captured directory so the number
    // cannot drift from what the producer actually asks.
    sourcesExpected: 40,
    // The session plus more than half the feeds. Below that the book is not
    // described; the run says it could not look.
    minimumSources: 21,
    refusal:
      'Publishes the feed, the block and the age. Never fills a gap with a last-known price without stamping how old it is.',
    reads: [
      'Every tokenized-equity feed on Robinhood Chain — answer, updatedAt, and the on-chain description against the one recorded at capture',
      'The issuer oracle pause flag on the stock token each feed prices',
      'Crypto feeds in rotation',
      'Feed heartbeat and deviation threshold, as the vendor directory publishes them',
    ],
  },
  {
    id: 'specialist',
    name: 'THE SPECIALIST',
    district: 'THE FLOOR',
    role: 'The price on this chain, and the distance to the feed',
    line: 'The oracle says what it was worth when the market shut. The pool says what it is now. I print both, and the gap.',
    posture: 'MEASURES',
    // The same cadence as the Pillar. A basis is a difference between two
    // reads; reading one side four times as often does not make the pair
    // fresher, it only makes the pair's age harder to state honestly.
    intervalSeconds: 15 * 60,
    // Every pool in the captured book. A test pins this to the capture, so the
    // number cannot drift from what the producer actually asks.
    sourcesExpected: 258,
    // More than half the book. Below that the market is not described; the run
    // says it could not look.
    minimumSources: 130,
    refusal:
      'Publishes the pool’s mid and the size that moves it one percent, computed from published state. Never calls a difference cheap or dear, never says which way it closes, and never quotes a size it did not compute from the book.',
    reads: [
      'Every pool the v2 and v3 factories admit to for a priced stock token — reserves, or slot0 and liquidity',
      'Every v4 pool whose id recomputes from a captured key — getSlot0 and getLiquidity through the StateView lens',
      'The Pillar’s own feed record for the reference price, so the basis is the distance from what the Floor shows and not from a second reading of the same oracle',
      'The Pillar’s record for the asset each pool quotes against — USDG / USD or ETH / USD — which is what turns a mid into dollars. The Pillar samples the crypto feeds in rotation, so on a young store a mid can be read with no dollar price beside it, and the run says so',
      'The session, so a difference measured across a shut exchange is printed as one',
    ],
  },
  {
    id: 'archivist',
    name: 'THE ARCHIVIST',
    district: 'THE REGISTRY',
    role: 'Corporate actions',
    line: 'A split that the token did not follow is the whole story.',
    posture: 'MEASURES',
    intervalSeconds: 6 * HOURS,
    // Every stock token in the issuer's registry (194) and the two settlement
    // assets. A test pins this to the captured registry.
    sourcesExpected: 196,
    minimumSources: 99,
    refusal:
      'Records announced actions and whether the on-chain token reflected them. Never predicts a dividend, a split or a delisting.',
    reads: [
      'uiMultiplier() on every stock token — shares per token, the on-chain record of dividends and splits',
      'newUIMultiplier() and effectiveAt() — a change the issuer has published but not yet applied',
      'totalSupply() on every token, against the previous reading',
    ],
  },
  {
    id: 'surveyor',
    name: 'THE SURVEYOR',
    district: 'THE FLOOR',
    role: 'Market structure of the underlying',
    line: 'I can tell you what the market is doing. Not what you should do.',
    posture: 'MEASURES',
    intervalSeconds: null,
    sourcesExpected: 1,
    minimumSources: 1,
    refusal:
      'Explains structure. Gives no entry, no stop, no target — even when asked.',
    reads: [
      'This desk’s own samples of the deepest equity feed series, as the Pillar took them — never exchange closes, and never described as such',
      'Realised volatility annualised on the observed sampling rate, trend strength, RSI(14), range position — each declared only above its stated minimum of samples',
    ],
  },
  {
    id: 'counsel',
    name: 'COUNSEL',
    district: 'CHAMBERS',
    role: 'Eligibility, rights & restrictions',
    line: 'I can read you the terms. I cannot tell you that they apply to you.',
    posture: 'MEASURES',
    intervalSeconds: 24 * HOURS,
    // The register itself, and each of the five published pages it watches.
    sourcesExpected: 6,
    minimumSources: 1,
    refusal:
      'Quotes published issuer and jurisdiction terms with citations. Never gives legal or tax advice, and never tells anyone they are eligible.',
    reads: [
      'The published-terms register: which issuer pages have been read and what was recorded, with dates',
      'Every page in the register, fetched and hashed on each run — reported as unchanged or changed, never read for meaning',
      'Restricted-jurisdiction lists and the documented KYC boundary, as published and linked',
    ],
  },
  {
    id: 'tally',
    name: 'THE TALLY',
    district: 'THE VAULT',
    role: 'Sampled on-chain transfers',
    line: 'Transfers, senders and receivers over a stated block sample.',
    posture: 'MEASURES',
    // Hourly, because each run is a rate sample of about a minute of chain
    // time; a series of samples is what shows the day. Sources: each settlement
    // asset, and the stock-token roll as one.
    intervalSeconds: 1 * HOURS,
    sourcesExpected: 3,
    minimumSources: 1,
    refusal:
      'Reports transfer counts and distinct addresses within the stated sample. Does not measure holder concentration, market depth or total hourly flow.',
    reads: [
      'Transfer logs for the settlement assets and every stock token, over a sample of about a minute of chain time — a rate, never a total',
      'Transfers beside distinct sending and receiving addresses within the sample; addresses do not identify individual holders',
      'Units entering and leaving supply through the zero address',
    ],
  },
  {
    id: 'warden',
    name: 'THE WARDEN',
    district: 'CHAMBERS',
    role: 'System health & data freshness',
    line: 'Three numbers I cannot fake, printed even when they look bad.',
    posture: 'MEASURES',
    intervalSeconds: 1 * HOURS,
    sourcesExpected: 1,
    minimumSources: 1,
    refusal:
      'Publishes sources reached, age of the oldest input, and agents reporting in the last hour. Prints them when they are bad.',
    reads: ['The heartbeat store — every agent, every run, including the failed ones'],
  },
  {
    id: 'herald',
    name: 'THE HERALD',
    district: 'THE CAGE',
    role: 'Declared promotion',
    line: 'Of course I am selling you something. I am the only one who says so first.',
    posture: 'PROMOTES',
    intervalSeconds: 12 * HOURS,
    sourcesExpected: 1,
    minimumSources: 1,
    refusal:
      'Promotes openly, with the disclosure appended by code on every output. No forecasts, no targets, no operational parameters.',
    reads: ['Whatever it is promoting, read live at the moment it posts'],
  },
];

export const AGENT_BY_ID: Readonly<Record<AgentId, AgentSpec>> = Object.fromEntries(
  AGENTS.map((a) => [a.id, a]),
) as Record<AgentId, AgentSpec>;

export const MEASURING_AGENTS = AGENTS.filter((a) => a.posture === 'MEASURES');
export const PROMOTING_AGENTS = AGENTS.filter((a) => a.posture === 'PROMOTES');

/** The headline counts. Derived, so they cannot disagree with the roster. */
export const AGENT_COUNTS = {
  total: AGENTS.length,
  measure: MEASURING_AGENTS.length,
  promote: PROMOTING_AGENTS.length,
  /** Nothing here touches a venue or places an order. Not now, not later. */
  execute: 0,
} as const;

/**
 * One timer serves every interval: each agent is asked whether its own interval
 * has elapsed. Agents without an interval are answered on request and are never
 * counted as failures for staying quiet.
 */
/**
 * What the site is allowed to promise about this agent's cadence. Derived from
 * the same single number, so the promise and the threshold cannot disagree.
 */
export function absenceLabel(spec: AgentSpec): string {
  if (spec.intervalSeconds === null) return 'on request · never a fault for staying quiet';
  return `every ${describeSpan(spec.intervalSeconds)} · stale after ${describeSpan(freshnessSeconds(spec.intervalSeconds))} · absent after ${describeSpan(absenceSeconds(spec.intervalSeconds))}`;
}

/** A span in whole units a reader can hold: "5m", "2h 10m", "50h", "1d 2h". */
export function describeSpan(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 72) return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `${days}d` : `${days}d ${restHours}h`;
}

export function isDue(spec: AgentSpec, lastRunAt: Date | null, now: Date = new Date()): boolean {
  if (spec.intervalSeconds === null) return false;
  if (lastRunAt === null) return true;
  const elapsed = (now.getTime() - lastRunAt.getTime()) / 1000;
  return elapsed >= spec.intervalSeconds;
}
