/** Evidence completeness, not an independent review or authorization to send a transaction. */
export const RELEASE_REQUIREMENTS = [
  { id: 'independent-review', phases: ['token-launch', 'paid-beta', 'position-pilot'], needs: 'Independent contract and service review for this release; material findings closed.' },
  { id: 'token-terms', phases: ['token-launch', 'paid-beta'], needs: 'Reviewed token/credits terms and eligible distribution scope.' },
  { id: 'launchpad-and-funding', phases: ['token-launch', 'paid-beta'], needs: 'Verified launchpad mechanics, allocation/vesting/fees, prelaunch funding and proceeds formula.' },
  { id: 'treasury', phases: ['token-launch', 'paid-beta'], needs: 'Target-chain treasury Safe identity, owners, quorum and operating authority verified.' },
  { id: 'release-validation', phases: ['token-launch', 'paid-beta', 'position-pilot'], needs: 'Tests, build, database and relevant rehearsals tied to this release digest.' },
  { id: 'production-operations', phases: ['paid-beta', 'position-pilot'], needs: 'Named on-call, independent monitoring, log retention, verified DB TLS, restore and incident evidence.' },
  { id: 'service-economics', phases: ['paid-beta'], needs: 'Measured service costs/capacity, outstanding credits budget and customer validation.' },
  { id: 'token-and-desk', phases: ['paid-beta'], needs: 'Actual token/deployment records, source verification and immutable identity.' },
  { id: 'pool-and-rate', phases: ['paid-beta'], needs: 'Actual pool, liquidity/quote assumptions and fresh rate/code evidence.' },
  { id: 'paid-http-acceptance', phases: ['paid-beta'], needs: 'Wallet top-up through paid HTTP and webhook, ledger reconciliation and failure recovery.' },
  { id: 'instrument-identity', phases: ['position-pilot'], needs: 'G1: identities and dependency map with reviewed unresolved boundaries.' },
  { id: 'issuer-eligibility', phases: ['position-pilot'], needs: 'G2: written rights/access review for contract holder, receipt, users and claims.' },
  { id: 'component-acquisition', phases: ['position-pilot'], needs: 'G3: permitted acquisition, wrapper issuance/limits and corporate-action evidence.' },
  { id: 'series-operator', phases: ['position-pilot'], needs: 'G5: Ethereum Safe, permits, incident process and two-step role transfer rehearsed.' },
  { id: 'lots-and-user-economics', phases: ['position-pilot'], needs: 'G6: actual lot/cap, full cost comparison and genuine user research outcome.' },
] as const;
export type ReleasePhase = 'token-launch' | 'paid-beta' | 'position-pilot';
export interface ApprovalEvidence {
  id: string;
  status: 'PENDING' | 'APPROVED';
  sourceDigest: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  evidence: { path: string; sha256: string } | null;
}
export interface ReleaseRecord { schemaVersion: 1; approvals: ApprovalEvidence[] }
const hex = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const named = (v: unknown): v is string => typeof v === 'string' && v.trim().length >= 3 && !/^(?:tbd|todo|unknown|placeholder|not assigned|pending)$/i.test(v.trim());

export async function assessReadiness(raw: unknown, sourceDigest: string, evidenceHash: (file: string) => Promise<string | null>, now = new Date()) {
  const record = raw as Partial<ReleaseRecord> | null;
  const validShape = record !== null && typeof record === 'object' && record.schemaVersion === 1 && Array.isArray(record.approvals);
  const rows = validShape ? record.approvals! : [];
  const unknownIds = rows.filter(r => !r || !RELEASE_REQUIREMENTS.some(req => req.id === r.id)).map(r => r?.id ?? '(malformed)');
  const checks = await Promise.all(RELEASE_REQUIREMENTS.map(async req => {
    const matches = rows.filter(r => r?.id === req.id);
    const reasons: string[] = [];
    if (matches.length !== 1) reasons.push(matches.length ? 'duplicate record' : 'record missing');
    const entry = matches[0];
    if (entry) {
      if (entry.status !== 'APPROVED') reasons.push('approval pending');
      if (!hex(entry.sourceDigest) || entry.sourceDigest !== sourceDigest) reasons.push('not tied to the current source digest');
      if (!named(entry.reviewedBy)) reasons.push('reviewer not named');
      const at = typeof entry.reviewedAt === 'string' ? Date.parse(entry.reviewedAt) : NaN;
      if (!Number.isFinite(at) || at > now.getTime()) reasons.push('review date absent, invalid or in the future');
      const ref = entry.evidence;
      if (!ref || typeof ref.path !== 'string' || !hex(ref.sha256)) reasons.push('evidence reference/hash missing');
      else if (await evidenceHash(ref.path) !== ref.sha256) reasons.push('evidence unavailable, outside allowed paths or hash differs');
    }
    return { ...req, state: reasons.length ? 'HELD' as const : 'RECORD_COMPLETE' as const, reasons };
  }));
  const errors = [...(!validShape ? ['readiness record must have schemaVersion 1 and approvals array'] : []), ...(unknownIds.length ? [`unknown/malformed requirement IDs: ${unknownIds.join(', ')}`] : [])];
  const phases = (['token-launch', 'paid-beta', 'position-pilot'] as const).map(phase => ({
    phase,
    state: errors.length || checks.some(c => (c.phases as readonly string[]).includes(phase) && c.state === 'HELD') ? 'HELD' as const : 'RECORDS_COMPLETE_REQUIRES_VERIFICATION' as const,
    held: checks.filter(c => (c.phases as readonly string[]).includes(phase) && c.state === 'HELD').map(c => c.id),
  }));
  return { checkedAt: now.toISOString(), sourceDigest, errors, phases, checks, limitation: 'Checks record completeness and hashes only. It cannot authenticate a reviewer, establish legal eligibility, verify current chain state or authorize deployment/payment.' };
}
