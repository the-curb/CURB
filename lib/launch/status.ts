/**
 * Where the launch on Robinhood Chain stands — read from the record, never
 * typed in. The steps are the launch checklist's (docs/decisions/LAUNCH.md):
 * the treasury (the operator's Safe) exists on chain, the desk is deployed
 * and configured, the pool is recorded and a rate is read. Each is a fact the
 * repository or the configuration holds: the Safe's evidence file, the
 * CURB_CREDITS line, the last rate row. The copy this feeds moves only when
 * the fact does. The product owner asked on 13 September 2026, the day the
 * treasury went live, that the public stage read "mainnet"; the kicker says
 * so and the line beneath it says exactly what is on chain and what is not.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Store } from '../store/types.ts';
import { creditsStatus } from '../credits/config.ts';
import { latestRate } from '../credits/maintenance.ts';

export type LaunchStep = 'NOTHING' | 'TREASURY_LIVE' | 'DESK_CONFIGURED' | 'RATE_READ';

export interface LaunchStatus {
  readonly chain: 'Robinhood Chain';
  readonly chainId: 4663;
  readonly step: LaunchStep;
  /** The operator's Safe as its evidence file records it, or null. */
  readonly treasury: { readonly address: string; readonly owners: number; readonly threshold: string; readonly block: number } | null;
  readonly desk: string | null;
  readonly rateAtBlock: number | null;
  /** One line, in the site's voice, true of the record as it is. */
  readonly line: string;
}

export const SAFE_EVIDENCE = path.join('contracts', 'evidence', 'safes', 'safe.4663.json');

/** `0x4E69…c219`: the first six and the last four, for a line a reader scans; the full address stays in `treasury.address`. */
export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

async function safeEvidence(root: string): Promise<LaunchStatus['treasury']> {
  try {
    const raw = await fs.readFile(path.join(/*turbopackIgnore: true*/ root, SAFE_EVIDENCE), 'utf8');
    const record = JSON.parse(raw) as { plan?: { predictedAddress?: string; chainId?: number }; creation?: { block?: number }; asRead?: { owners?: string[]; threshold?: string } };
    if (record.plan?.chainId !== 4663 || typeof record.plan.predictedAddress !== 'string' || !Array.isArray(record.asRead?.owners) || typeof record.asRead.threshold !== 'string' || typeof record.creation?.block !== 'number') return null;
    return { address: record.plan.predictedAddress, owners: record.asRead.owners.length, threshold: record.asRead.threshold, block: record.creation.block };
  } catch {
    return null;
  }
}

export async function launchStatus(store: Store, root: string = process.cwd()): Promise<LaunchStatus> {
  const treasury = await safeEvidence(root);
  const credits = creditsStatus();
  const desk = credits.state === 'CONFIGURED' && credits.config.network.chainId === 4663 ? credits.config.desk : null;
  let rateAtBlock: number | null = null;
  if (credits.state === 'CONFIGURED' && desk !== null) {
    const read = await latestRate(store, credits.config);
    if (read.rate?.state === 'READ') rateAtBlock = read.rate.rate.block;
  }
  const step: LaunchStep = rateAtBlock !== null ? 'RATE_READ' : desk !== null ? 'DESK_CONFIGURED' : treasury !== null ? 'TREASURY_LIVE' : 'NOTHING';
  const quorum = treasury === null ? '2-of-3' : `${treasury.threshold}-of-${treasury.owners}`;
  const line =
    step === 'RATE_READ'
      ? `Live on Robinhood Chain mainnet: the desk at ${shortAddress(desk!)} credits top-ups at a rate read from the pool (last at block ${rateAtBlock!.toLocaleString('en-US')}); the treasury is the operator's ${quorum} Safe.`
      : step === 'DESK_CONFIGURED'
        ? `On Robinhood Chain mainnet: the desk is deployed at ${shortAddress(desk!)} and the treasury is the operator's ${quorum} Safe; no pool is read yet, so the price list stays in dollars and top-ups wait.`
        : step === 'TREASURY_LIVE'
          ? `On Robinhood Chain mainnet: the operator's ${quorum} Safe — the treasury every top-up goes to — is live at ${shortAddress(treasury!.address)} (block ${treasury!.block.toLocaleString('en-US')}); the token and the desk come next, so nothing is sold yet.`
          : 'Prepared for Robinhood Chain mainnet: no treasury, no token, no desk on chain yet; nothing is sold.';
  return { chain: 'Robinhood Chain', chainId: 4663, step, treasury, desk, rateAtBlock, line };
}
