/**
 * What the fork tests found, as they wrote it: contracts/evidence/<series>.fork.json.
 *
 * The file is produced by `npm run test:fork` in contracts/ against a fork
 * of Ethereum and committed with the block it ran at. The site reads it at
 * request time like the doctrine, shows it dated, and shows nothing when
 * it is absent — a finding nobody ran is not a finding.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface ForkFindings {
  readonly identityAsDocumented: boolean;
  readonly wrapperTransfersForArbitraryHolder: boolean;
  readonly seriesMintExitClaimWithRealWrapper: boolean;
  readonly wrapperUnwrapsForArbitraryHolder: boolean;
  readonly unwrapRawReceivedFor10e18: string;
  readonly unwrapQuotedFor10e18: string;
  readonly rawTransfersForArbitraryHolder: boolean;
  readonly rawReceivedFor1e18Sent: string;
  readonly rawBalanceSettableByStorage: boolean;
}

/** Who can change what stands behind an address, as read at the recorded block. null: not set, or not answered. */
export interface ForkAuthority {
  readonly implementation: string | null;
  readonly admin: string | null;
  /** A beacon proxy keeps its implementation behind this address; absent on files written before it was read. */
  readonly beacon: string | null;
  readonly owner: string | null;
  readonly paused: boolean | null;
}

/** Component B, the issuer's token as its product page publishes it, at the same block. */
export interface ForkComponentB {
  readonly token: string;
  readonly source: string;
  readonly identityAsPublished: boolean;
  readonly totalSupply: string;
  readonly balanceStageableByStorage: boolean;
  readonly transfersForArbitraryHolder: boolean;
  readonly seriesMintExitClaimWithBothReal: boolean;
  readonly authority: ForkAuthority;
}

/** Execution gas by gasleft() deltas inside one call, warm storage; see the note the test writes. */
export interface ForkGas {
  readonly note: string;
  readonly wrapperTransfer: number;
  /** Absent on files written before component B was real. */
  readonly aaplonTransfer: number | null;
  readonly mint3Lots: number;
  readonly allocateExit3Lots: number;
  readonly claimA: number;
  readonly claimB: number;
}

export interface ForkEvidence {
  readonly seriesId: string;
  readonly chainId: number;
  readonly block: number;
  readonly blockTimestamp: number;
  readonly component: 'A' | 'B';
  readonly raw: string;
  readonly wrapperV2: string;
  readonly wrapperV1: string;
  readonly wrapperRawReserve: string;
  readonly wrapperTotalSupply: string;
  readonly findings: ForkFindings;
  /** Absent on files written before the authority was read. */
  readonly authority: Readonly<Record<'raw' | 'wrapperV2' | 'wrapperV1', ForkAuthority>> | null;
  /** Absent on files written before gas was measured. */
  readonly gas: ForkGas | null;
  /** Absent on files written before component B had an address to test. */
  readonly componentB: ForkComponentB | null;
  readonly notProven: readonly string[];
  readonly how: string;
}

const FILE = (seriesId: string) => path.join(/*turbopackIgnore: true*/ process.cwd(), 'contracts', 'evidence', `${seriesId}.fork.json`);

const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isStr = (v: unknown): v is string => typeof v === 'string';

export async function forkEvidenceOf(seriesId: string): Promise<{ evidence: ForkEvidence | null; fault: string | null }> {
  let raw: string;
  try {
    raw = await fs.readFile(FILE(seriesId), 'utf8');
  } catch {
    return { evidence: null, fault: null }; // never run, or not committed: not a fault, simply no finding
  }
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const f = (j.findings ?? {}) as Record<string, unknown>;
    if (!Number.isInteger(j.block) || !Number.isInteger(j.chainId) || !isStr(j.raw) || !isStr(j.wrapperV2)) return { evidence: null, fault: 'the fork evidence file is not the shape the tests write' };
    const findings: ForkFindings = {
      identityAsDocumented: isBool(f.identityAsDocumented) && f.identityAsDocumented,
      wrapperTransfersForArbitraryHolder: isBool(f.wrapperTransfersForArbitraryHolder) && f.wrapperTransfersForArbitraryHolder,
      seriesMintExitClaimWithRealWrapper: isBool(f.seriesMintExitClaimWithRealWrapper) && f.seriesMintExitClaimWithRealWrapper,
      wrapperUnwrapsForArbitraryHolder: isBool(f.wrapperUnwrapsForArbitraryHolder) && f.wrapperUnwrapsForArbitraryHolder,
      unwrapRawReceivedFor10e18: isStr(f.unwrapRawReceivedFor10e18) ? f.unwrapRawReceivedFor10e18 : '0',
      unwrapQuotedFor10e18: isStr(f.unwrapQuotedFor10e18) ? f.unwrapQuotedFor10e18 : '0',
      rawTransfersForArbitraryHolder: isBool(f.rawTransfersForArbitraryHolder) && f.rawTransfersForArbitraryHolder,
      rawReceivedFor1e18Sent: isStr(f.rawReceivedFor1e18Sent) ? f.rawReceivedFor1e18Sent : '0',
      rawBalanceSettableByStorage: isBool(f.rawBalanceSettableByStorage) && f.rawBalanceSettableByStorage,
    };
    const authorityOf = (v: unknown): ForkAuthority => {
      const a = (v ?? {}) as Record<string, unknown>;
      const addr = (x: unknown) => (isStr(x) ? x.toLowerCase() : null);
      return { implementation: addr(a.implementation), admin: addr(a.admin), beacon: addr(a.beacon), owner: addr(a.owner), paused: isBool(a.paused) ? a.paused : null };
    };
    const cb = j.componentB as Record<string, unknown> | undefined;
    const componentB: ForkComponentB | null =
      cb && typeof cb === 'object' && isStr(cb.token)
        ? {
            token: cb.token.toLowerCase(),
            source: isStr(cb.source) ? cb.source : '',
            identityAsPublished: isBool(cb.identityAsPublished) && cb.identityAsPublished,
            totalSupply: isStr(cb.totalSupply) ? cb.totalSupply : '0',
            balanceStageableByStorage: isBool(cb.balanceStageableByStorage) && cb.balanceStageableByStorage,
            transfersForArbitraryHolder: isBool(cb.transfersForArbitraryHolder) && cb.transfersForArbitraryHolder,
            seriesMintExitClaimWithBothReal: isBool(cb.seriesMintExitClaimWithBothReal) && cb.seriesMintExitClaimWithBothReal,
            authority: authorityOf(cb.authority),
          }
        : null;
    const g = j.gas as Record<string, unknown> | undefined;
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
    const gas: ForkGas | null =
      g && typeof g === 'object' ? { note: isStr(g.note) ? g.note : '', wrapperTransfer: num(g.wrapperTransfer), aaplonTransfer: typeof g.aaplonTransfer === 'number' ? num(g.aaplonTransfer) : null, mint3Lots: num(g.mint3Lots), allocateExit3Lots: num(g.allocateExit3Lots), claimA: num(g.claimA), claimB: num(g.claimB) } : null;
    const au = j.authority as Record<string, unknown> | undefined;
    const authority = au && typeof au === 'object' ? { raw: authorityOf(au.raw), wrapperV2: authorityOf(au.wrapperV2), wrapperV1: authorityOf(au.wrapperV1) } : null;
    return {
      evidence: {
        seriesId: isStr(j.seriesId) ? j.seriesId : seriesId,
        chainId: j.chainId as number,
        block: j.block as number,
        blockTimestamp: Number.isInteger(j.blockTimestamp) ? (j.blockTimestamp as number) : 0,
        component: j.component === 'B' ? 'B' : 'A',
        raw: j.raw.toLowerCase(),
        wrapperV2: j.wrapperV2.toLowerCase(),
        wrapperV1: isStr(j.wrapperV1) ? j.wrapperV1.toLowerCase() : '',
        wrapperRawReserve: isStr(j.wrapperRawReserve) ? j.wrapperRawReserve : '0',
        wrapperTotalSupply: isStr(j.wrapperTotalSupply) ? j.wrapperTotalSupply : '0',
        findings,
        authority,
        gas,
        componentB,
        notProven: Array.isArray(j.notProven) ? j.notProven.filter(isStr) : [],
        how: isStr(j.how) ? j.how : '',
      },
      fault: null,
    };
  } catch (cause) {
    return { evidence: null, fault: cause instanceof Error ? cause.message : 'unreadable fork evidence' };
  }
}

/** Base units as a decimal with 18 places trimmed to four, for a human line. */
export function units18(value: string): string {
  const n = BigInt(value);
  const whole = n / 10n ** 18n;
  const frac = ((n % 10n ** 18n) / 10n ** 14n).toString().padStart(4, '0');
  return `${whole.toLocaleString('en-US')}.${frac}`;
}
