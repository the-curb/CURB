/**
 * What the T14 fork test found across a recorded corporate action:
 * contracts/evidence/<series>.corporate-action.json, written by
 * contracts/test/fork/AppleCorporateActionFork.t.sol on two forks of
 * Ethereum — the block before the issuer's multiplier activation and the
 * activation block. Read at request time like the fork evidence; nothing
 * shown when absent, because a test nobody ran is not a finding.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface ActivationSide {
  readonly block: number;
  readonly timestamp: number;
  readonly multiplier: string;
  readonly wrapperShares: string;
  readonly wrapperRawBalance: string;
  readonly wrapperSharesOnRaw: string;
  readonly convertToAssets1e18: string;
  readonly rawTotalSupply: string;
}

export interface CorporateActionEvidence {
  readonly seriesId: string;
  readonly chainId: number;
  readonly component: 'A' | 'B';
  readonly raw: string;
  readonly wrapperV2: string;
  readonly activationBlock: number;
  readonly before: ActivationSide;
  readonly after: ActivationSide;
  readonly findings: {
    readonly multiplierMoved: boolean;
    readonly wrapperSharesStatic: boolean;
    readonly wrapperRawBalanceMoved: boolean;
    readonly conversionTracksMultiplier: boolean;
  };
  readonly notProven: readonly string[];
  readonly how: string;
}

const FILE = (seriesId: string) => path.join(/*turbopackIgnore: true*/ process.cwd(), 'contracts', 'evidence', `${seriesId}.corporate-action.json`);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

function sideOf(v: unknown): ActivationSide | null {
  if (v === null || typeof v !== 'object') return null;
  const s = v as Record<string, unknown>;
  if (!Number.isInteger(s.block) || !Number.isInteger(s.timestamp)) return null;
  const str = (k: string) => (isStr(s[k]) ? (s[k] as string) : '0');
  return {
    block: s.block as number,
    timestamp: s.timestamp as number,
    multiplier: str('multiplier'),
    wrapperShares: str('wrapperShares'),
    wrapperRawBalance: str('wrapperRawBalance'),
    wrapperSharesOnRaw: str('wrapperSharesOnRaw'),
    convertToAssets1e18: str('convertToAssets1e18'),
    rawTotalSupply: str('rawTotalSupply'),
  };
}

export async function corporateActionEvidenceOf(seriesId: string): Promise<{ evidence: CorporateActionEvidence | null; fault: string | null }> {
  let raw: string;
  try {
    raw = await fs.readFile(FILE(seriesId), 'utf8');
  } catch {
    return { evidence: null, fault: null };
  }
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const before = sideOf(j.before);
    const after = sideOf(j.after);
    const f = (j.findings ?? {}) as Record<string, unknown>;
    if (!Number.isInteger(j.activationBlock) || before === null || after === null || !isStr(j.raw) || !isStr(j.wrapperV2)) {
      return { evidence: null, fault: 'the corporate-action evidence file is not the shape the test writes' };
    }
    return {
      evidence: {
        seriesId: isStr(j.seriesId) ? j.seriesId : seriesId,
        chainId: Number.isInteger(j.chainId) ? (j.chainId as number) : 0,
        component: j.component === 'B' ? 'B' : 'A',
        raw: j.raw.toLowerCase(),
        wrapperV2: j.wrapperV2.toLowerCase(),
        activationBlock: j.activationBlock as number,
        before,
        after,
        findings: {
          multiplierMoved: isBool(f.multiplierMoved) && f.multiplierMoved,
          wrapperSharesStatic: isBool(f.wrapperSharesStatic) && f.wrapperSharesStatic,
          wrapperRawBalanceMoved: isBool(f.wrapperRawBalanceMoved) && f.wrapperRawBalanceMoved,
          conversionTracksMultiplier: isBool(f.conversionTracksMultiplier) && f.conversionTracksMultiplier,
        },
        notProven: Array.isArray(j.notProven) ? j.notProven.filter(isStr) : [],
        how: isStr(j.how) ? j.how : '',
      },
      fault: null,
    };
  } catch (cause) {
    return { evidence: null, fault: cause instanceof Error ? cause.message : 'unreadable corporate-action evidence' };
  }
}

/** A multiplier at 18 places as a decimal with six, for a human line. */
export function multiplier18(value: string): string {
  const n = BigInt(value);
  const whole = n / 10n ** 18n;
  const frac = ((n % 10n ** 18n) / 10n ** 12n).toString().padStart(6, '0');
  return `${whole.toString()}.${frac}`;
}

/** The change between two 18-place figures as a percentage with four places, signed. */
export function percentChange(before: string, after: string): string {
  const b = BigInt(before);
  const a = BigInt(after);
  if (b === 0n) return '—';
  const bps4 = ((a - b) * 1_000_000n) / b; // in hundred-thousandths of a percent... kept as 4 decimal places of a percent
  const sign = bps4 < 0n ? '-' : '+';
  const abs = bps4 < 0n ? -bps4 : bps4;
  return `${sign}${(abs / 10_000n).toString()}.${(abs % 10_000n).toString().padStart(4, '0')}%`;
}
