/** Public launch milestones are evidence, not availability guarantees. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SnapshotRecord, Store } from '../store/types.ts';
import { unread, type Reading } from '../doctrine/reading.ts';
import { creditsStatus } from '../credits/config.ts';
import { latestDeskCode } from '../credits/code.ts';
import { latestRate } from '../credits/maintenance.ts';
import { INDEX_KEY, type CreditsIndexState } from '../credits/indexer.ts';
import { TOPUPS_PREFIX, type TopUpCredit } from '../credits/keys.ts';
import { currentDeskCode, currentRate } from './evidence.ts';

export type LaunchStep = 'NOTHING' | 'TREASURY_RECORDED' | 'DESK_CONFIGURED' | 'CODE_VERIFIED' | 'RATE_READ' | 'TOP_UP_RECORDED';
export interface LaunchStatus {
  readonly chain: 'Robinhood Chain';
  readonly chainId: 4663;
  readonly step: LaunchStep;
  /** Creation/read-back evidence, not a fresh RPC read of the Safe. */
  readonly treasury: { readonly address: string; readonly owners: number; readonly threshold: string; readonly block: number } | null;
  readonly desk: string | null;
  readonly rateAtBlock: number | null;
  readonly topUp: { readonly transactionHash: string; readonly block: number } | null;
  readonly faults: readonly string[];
  readonly line: string;
}
export const SAFE_EVIDENCE = path.join('contracts', 'evidence', 'safes', 'safe.4663.json');
export function shortAddress(address: string): string { return `${address.slice(0, 6)}…${address.slice(-4)}`; }

/** Persisted JSON can be incomplete; keep that distinct from an empty record. */
async function snapshotsForLaunch(store: Store, prefix: string): Promise<Reading<readonly SnapshotRecord[]>> {
  try {
    const read = await store.snapshots(prefix);
    if (read.state === 'UNREAD') return read;
    if (!Array.isArray(read.value) || read.value.some((r) => !r || typeof r.key !== 'string' || !r.payload || typeof r.payload !== 'object' || Array.isArray(r.payload))) {
      return unread('SOURCE_MALFORMED', { source: prefix, detail: 'malformed launch evidence rows' });
    }
    return read;
  } catch (cause) {
    return unread('SOURCE_UNREACHABLE', { source: prefix, detail: cause instanceof Error ? cause.message : 'launch evidence could not be read' });
  }
}

async function safeEvidence(root: string): Promise<LaunchStatus['treasury']> {
  try {
    const record = JSON.parse(await fs.readFile(path.join(/*turbopackIgnore: true*/ root, SAFE_EVIDENCE), 'utf8'));
    const address = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-f]{40}$/i.test(v) && !/^0x0{40}$/i.test(v);
    const owners: unknown = record.asRead?.owners;
    const threshold = record.asRead?.threshold;
    if (record.plan?.chainId !== 4663 || !address(record.plan.predictedAddress) || !Array.isArray(owners) || owners.length === 0 || !owners.every(address) || new Set(owners.map((a) => a.toLowerCase())).size !== owners.length || typeof threshold !== 'string' || !/^[1-9][0-9]*$/.test(threshold) || BigInt(threshold) > BigInt(owners.length) || !Number.isSafeInteger(record.creation?.block) || record.creation.block < 0 || !Number.isSafeInteger(record.asRead?.codeBytes) || record.asRead.codeBytes <= 0) return null;
    return { address: record.plan.predictedAddress, owners: owners.length, threshold, block: record.creation.block };
  } catch { return null; }
}

export async function launchStatus(store: Store, root: string = process.cwd(), now: Date = new Date()): Promise<LaunchStatus> {
  const treasury = await safeEvidence(root);
  const credits = creditsStatus();
  const config = credits.state === 'CONFIGURED' && credits.config.network.chainId === 4663 ? credits.config : null;
  const desk = config?.desk ?? null;
  const faults: string[] = credits.state === 'CONFIG_INVALID' ? [credits.detail] : [];
  let step: LaunchStep = desk !== null ? 'DESK_CONFIGURED' : treasury !== null ? 'TREASURY_RECORDED' : 'NOTHING';
  let rateAtBlock: number | null = null;
  let topUp: LaunchStatus['topUp'] = null;
  if (config !== null) {
    const evidenceStore = { snapshots: (prefix: string) => snapshotsForLaunch(store, prefix) } as Store;
    const [code, rate, index, rows] = await Promise.all([
      latestDeskCode(evidenceStore, config).catch(() => ({ code: null, storeFault: 'code: malformed evidence' })),
      latestRate(evidenceStore, config).catch(() => ({ rate: null, storeFault: 'rate: malformed evidence' })),
      evidenceStore.snapshots(INDEX_KEY), evidenceStore.snapshots(TOPUPS_PREFIX),
    ]);
    for (const fault of [code.storeFault, rate.storeFault, index.state === 'UNREAD' ? `index: ${index.reason}` : null, rows.state === 'UNREAD' ? `receipts: ${rows.reason}` : null]) if (fault) faults.push(fault);
    if (currentDeskCode(code.code, config, now)) {
      step = 'CODE_VERIFIED';
      if (currentRate(rate.rate, config, now)) {
        step = 'RATE_READ';
        rateAtBlock = rate.rate!.state === 'READ' ? rate.rate!.rate.block : null;
        // Previous desks' credits remain spendable; only this index's applied
        // logs can demonstrate a credited payment on the configured chain.
        const cursor = index.state === 'UNREAD' ? null : index.value.find((r) => r.key === INDEX_KEY)?.payload as unknown as CreditsIndexState | null;
        if (cursor?.network === config.network.id && typeof cursor.desk === 'string' && cursor.desk.toLowerCase() === desk && Number.isSafeInteger(cursor.cursor) && Array.isArray(cursor.applied) && rows.state !== 'UNREAD') {
          const validApplied = cursor.applied.filter((a) => a && typeof a.ref === 'string' && /^0x[0-9a-f]{64}:[0-9]+$/.test(a.ref) && Number.isSafeInteger(a.blockNumber) && a.blockNumber >= config.fromBlock && a.blockNumber <= cursor.cursor && typeof a.keyHash === 'string' && /^0x[0-9a-f]{64}$/.test(a.keyHash));
          if (validApplied.length !== cursor.applied.length) faults.push('index: malformed or inconsistent applied payment references');
          for (const row of rows.value) {
            if (!Array.isArray(row.payload.topUps)) { faults.push('receipts: malformed top-up list'); continue; }
            for (const t of row.payload.topUps as TopUpCredit[]) {
              if (!t || typeof t.desk !== 'string' || typeof t.cents !== 'string' || !/^[1-9][0-9]*$/.test(t.cents) || !Number.isSafeInteger(t.logIndex) || t.logIndex < 0 || !Number.isSafeInteger(t.blockNumber) || typeof t.transactionHash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(t.transactionHash)) { faults.push('receipts: malformed credited payment'); continue; }
              if (t.desk.toLowerCase() !== desk || t.blockNumber < config.fromBlock || t.blockNumber > cursor.cursor) continue;
              const ref = `${t.transactionHash.toLowerCase()}:${t.logIndex}`;
              if (!validApplied.some((a) => a.ref === ref && a.blockNumber === t.blockNumber && row.key === TOPUPS_PREFIX + a.keyHash)) continue;
              if (topUp === null || t.blockNumber > topUp.block) topUp = { transactionHash: t.transactionHash, block: t.blockNumber };
            }
          }
          if (topUp !== null) step = 'TOP_UP_RECORDED';
        }
      }
    }
  }
  const treasuryLine = treasury === null ? 'No valid treasury creation record is available here.' : `Treasury creation recorded on Robinhood Chain mainnet: ${treasury.threshold}-of-${treasury.owners} Safe ${shortAddress(treasury.address)}, block ${treasury.block.toLocaleString('en-US')}.`;
  const line = step === 'TOP_UP_RECORDED'
    ? `Credit desk ${shortAddress(desk!)} on Robinhood Chain mainnet: recent code and rate reads, and a credited top-up recorded at block ${topUp!.block.toLocaleString('en-US')}. This is recorded activity, not a guarantee of current availability.`
    : step === 'RATE_READ'
      ? `Credit desk ${shortAddress(desk!)} on Robinhood Chain mainnet: recent matching code and a rate at block ${rateAtBlock!.toLocaleString('en-US')}; no credited top-up confirmed by this record.`
      : step === 'CODE_VERIFIED'
        ? `Credit desk ${shortAddress(desk!)} on Robinhood Chain mainnet: recent code matches the configured token and treasury; a current rate is not confirmed.`
        : step === 'DESK_CONFIGURED'
          ? `Credit desk ${shortAddress(desk!)} is configured for Robinhood Chain mainnet; a recent matching code read is not confirmed. Configuration alone does not prove deployment.`
          : `${treasuryLine} The credit desk is not configured here; the position series remains a prototype.`;
  return { chain: 'Robinhood Chain', chainId: 4663, step, treasury, desk, rateAtBlock, topUp, faults, line: faults.length ? `${line} Some evidence could not be read; see Services.` : line };
}
