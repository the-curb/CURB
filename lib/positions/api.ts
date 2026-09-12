/**
 * What the product API says, composed from the store and the specs. Every
 * token amount is a string of integer base units. Nothing here sends a
 * transaction, estimates one, or prices one; where a figure is not
 * available the response says so and why, and never substitutes a zero.
 */

import { explorerAddress, positionsNetwork } from '../chain/networks.ts';
import type { Store } from '../store/types.ts';
import { deploymentOf, type DeploymentStatus, type SeriesDeployment } from './deployments.ts';
import { EVIDENCE_SOURCES, latestEvidence, versionCount, type Observation } from './evidence.ts';
import { loadIndex, reduceLedger } from './index.ts';
import { claimsOf, receiptsOf, type LedgerState } from './ledger.ts';
import { latestReconciliation, type Reconciliation } from './reconcile.ts';
import { GATES, PROMISES, SERIES, seriesById, type SeriesSpec } from './series.ts';
import { latestVerification, type AddressVerification } from './verify.ts';
import { forkEvidenceOf } from './fork-evidence.ts';
import { allocateExitCall, approveCall, claimCall, mintCall, type PreparedCall } from './calldata.ts';
import { DEPENDENCIES, NOT_KNOWN_LINE, POSSIBLY_SHARED, sharedParties } from './dependencies.ts';

/**
 * The calls a wallet would sign, when there is a contract to sign against.
 * The site prepares bytes; it never holds a key and never sends. Absent a
 * deployment the field says why, and nothing is prepared.
 */
function signItYourself(status: DeploymentStatus, calls: (d: SeriesDeployment) => readonly PreparedCall[]) {
  if (status.state !== 'CONFIGURED') return { state: status.state, reason: 'there is no contract to sign against; nothing is prepared', calls: [] as readonly PreparedCall[] };
  return { state: 'PREPARED' as const, reason: null, calls: calls(status.deployment) };
}

export interface DeploymentView {
  readonly state: DeploymentStatus['state'];
  readonly detail: string | null;
  readonly chainId: number | null;
  readonly address: string | null;
  readonly explorer: string | null;
}

export function deploymentView(seriesId: string): DeploymentView {
  const status = deploymentOf(seriesId);
  if (status.state !== 'CONFIGURED') return { state: status.state, detail: status.detail, chainId: null, address: null, explorer: null };
  const profile = positionsNetwork();
  return {
    state: 'CONFIGURED',
    detail: null,
    chainId: status.deployment.chainId,
    address: status.deployment.address,
    explorer: status.deployment.chainId === profile.chainId ? explorerAddress(profile, status.deployment.address) : null,
  };
}

export function seriesSummary(spec: SeriesSpec) {
  return {
    id: spec.id,
    name: spec.name,
    company: spec.company,
    stage: spec.stage,
    stageLine: spec.stageLine,
    chain: spec.chain,
    receiptDecimals: spec.receiptDecimals,
    illustrativeSymbol: spec.illustrativeSymbol,
    components: spec.components.map((c) => ({
      id: c.id,
      issuer: c.issuer,
      instrument: c.instrument,
      chain: c.chain,
      verification: c.verification,
      perLotIllustrative: c.perLotIllustrative.toString(),
      statuses: c.statuses,
      sources: c.sources,
    })),
    gates: GATES,
    gatesPassed: GATES.filter((g) => g.status === 'PASSED').length,
    deployment: deploymentView(spec.id),
  };
}

function evidenceView(o: Observation | null) {
  if (o === null) return null;
  // The raw body is archived, not served: what is served is its identity and its status.
  return {
    readAt: o.readAt,
    status: o.status,
    httpStatus: o.httpStatus,
    hash: o.hash,
    parse: o.parse,
    detail: o.detail,
    parsed: o.parsed,
    previousHash: o.previousHash ?? null,
    changedAt: o.changedAt ?? null,
    firstSeenAt: o.firstSeenAt ?? null,
  };
}

export async function seriesEvidence(store: Store, spec: SeriesSpec) {
  const latest = (await latestEvidence(store, EVIDENCE_SOURCES.filter((s) => s.seriesId === spec.id))).map((e) => e);
  const sources = [];
  for (const { source, observation, storeFault } of latest) {
    sources.push({
      id: source.id,
      component: source.component,
      title: source.title,
      url: source.url,
      kind: source.kind,
      versions: await versionCount(store, source.id),
      latest: evidenceView(observation),
      storeFault,
    });
  }
  const [verification, fork] = await Promise.all([latestVerification(store, spec.id), forkEvidenceOf(spec.id)]);
  return {
    seriesId: spec.id,
    sources,
    fork: fork.evidence,
    forkFault: fork.fault,
    verification: verification.run
      ? {
          chainId: verification.run.chainId,
          network: verification.run.network,
          ranAt: verification.run.ranAt,
          addresses: verification.run.verifications.map(verificationView),
        }
      : null,
    verificationStoreFault: verification.storeFault,
    gates: GATES,
  };
}

function verificationView(v: AddressVerification) {
  const profile = positionsNetwork();
  return {
    component: v.component,
    role: v.role,
    address: v.address,
    explorer: v.chainId === profile.chainId ? explorerAddress(profile, v.address) : null,
    claimedAsset: v.claimedAsset,
    hasCode: v.hasCode,
    codeHash: v.codeHash,
    symbol: v.symbol,
    decimals: v.decimals,
    asset: v.asset,
    assetMatchesClaim: v.assetMatchesClaim,
    answersAsToken: v.answersAsToken,
    proxy: v.proxy ?? { state: 'UNREAD' as const, kind: null, implementation: null, admin: null, beacon: null, reason: 'not read in this run — recorded before the slots were read', source: null },
    readAt: v.readAt,
    source: v.source,
    notProven: v.notProven,
  };
}

/** The ledger the index implies for a configured series, or the reason there is none. */
export async function ledgerFor(store: Store, spec: SeriesSpec): Promise<{ ledger: LedgerState | null; deployment: SeriesDeployment | null; cursor: number | null; events: number; faults: number; disagreements: readonly string[]; detail: string | null }> {
  const status = deploymentOf(spec.id);
  if (status.state !== 'CONFIGURED') return { ledger: null, deployment: null, cursor: null, events: 0, faults: 0, disagreements: [], detail: status.detail };
  const loaded = await loadIndex(store, spec.id, status.deployment);
  if (loaded.storeFault !== null) return { ledger: null, deployment: status.deployment, cursor: null, events: 0, faults: 0, disagreements: [], detail: loaded.storeFault };
  const { ledger, disagreements } = reduceLedger(loaded.state, status.deployment.q, status.deployment.capLots);
  return { ledger, deployment: status.deployment, cursor: loaded.state.cursor, events: loaded.state.events.length, faults: loaded.state.faults.length, disagreements, detail: null };
}

export async function seriesDetail(store: Store, spec: SeriesSpec) {
  const [evidence, ledger, reconciliation] = await Promise.all([seriesEvidence(store, spec), ledgerFor(store, spec), latestReconciliation(store, spec.id)]);
  return {
    ...seriesSummary(spec),
    rules: spec.rules,
    deferred: spec.deferred,
    promises: PROMISES,
    evidence,
    index:
      ledger.ledger === null
        ? { state: 'NONE' as const, detail: ledger.detail }
        : {
            state: 'INDEXED' as const,
            cursor: ledger.cursor,
            events: ledger.events,
            faults: ledger.faults,
            lotsOutstanding: ledger.ledger.n.toString(),
            reserved: { A: ledger.ledger.reserved.A.toString(), B: ledger.ledger.reserved.B.toString() },
            mintPaused: ledger.ledger.mintPaused,
            claimPaused: ledger.ledger.claimPaused,
            disagreements: ledger.disagreements,
          },
    reconciliation: reconciliation.reconciliation,
    reconciliationStoreFault: reconciliation.storeFault,
  };
}

export type PreviewFault = { readonly error: 'LOTS_INVALID' | 'SERIES_UNKNOWN'; readonly detail: string };

function parseLots(raw: string | null): bigint | null {
  if (raw === null || !/^[1-9][0-9]{0,9}$/.test(raw)) return null;
  return BigInt(raw);
}

export function previewMint(spec: SeriesSpec, lotsRaw: string | null) {
  const lots = parseLots(lotsRaw);
  if (lots === null) return { error: 'LOTS_INVALID' as const, detail: 'lots must be a positive whole number of at most ten digits' };
  const status = deploymentOf(spec.id);
  const q = status.state === 'CONFIGURED' ? status.deployment.q : { A: spec.components[0].perLotIllustrative, B: spec.components[1].perLotIllustrative };
  const cap = status.state === 'CONFIGURED' ? status.deployment.capLots : spec.capLotsIllustrative;
  return {
    seriesId: spec.id,
    lots: lots.toString(),
    unitsIllustrative: status.state !== 'CONFIGURED',
    deposit: { A: (lots * q.A).toString(), B: (lots * q.B).toString() },
    receipts: lots.toString(),
    withinCap: lots <= cap,
    capLots: cap.toString(),
    indicativeValue: { state: 'NOT_AVAILABLE' as const, reason: 'no dated price source is wired for these components; a missing price is never shown as zero' },
    gas: { state: 'NOT_ESTIMATED' as const, reason: status.state === 'CONFIGURED' ? 'estimation is done by the wallet against the contract at signing time' : 'there is no contract to estimate against' },
    atomic: 'both deposits and the receipt in one transaction; if either component fails to arrive, nothing is final',
    receiptTransferable: false,
    exit: 'by exit allocation and a separate claim per component',
    sendsTransaction: false,
    deployment: deploymentView(spec.id),
    signItYourself: signItYourself(status, (d) => [
      approveCall(d.components.A, d.address, lots * d.q.A, spec.components[0].instrument),
      approveCall(d.components.B, d.address, lots * d.q.B, spec.components[1].instrument),
      mintCall(d.address, lots, deadlineFromNow()),
    ]),
  };
}

/** A mint expires a quarter of an hour after it was prepared: long enough to read, short enough to be the thing that was read. */
function deadlineFromNow(now = Date.now()): bigint {
  return BigInt(Math.floor(now / 1000) + 15 * 60);
}

export function previewExit(spec: SeriesSpec, lotsRaw: string | null) {
  const lots = parseLots(lotsRaw);
  if (lots === null) return { error: 'LOTS_INVALID' as const, detail: 'lots must be a positive whole number of at most ten digits' };
  const status = deploymentOf(spec.id);
  const q = status.state === 'CONFIGURED' ? status.deployment.q : { A: spec.components[0].perLotIllustrative, B: spec.components[1].perLotIllustrative };
  return {
    seriesId: spec.id,
    lots: lots.toString(),
    unitsIllustrative: status.state !== 'CONFIGURED',
    burns: lots.toString(),
    reserves: { A: (lots * q.A).toString(), B: (lots * q.B).toString() },
    then: 'each component is claimed separately to the holder’s own wallet; one that cannot move leaves the other claimable',
    promisedDate: null,
    promisedRecoveryValue: null,
    sendsTransaction: false,
    deployment: deploymentView(spec.id),
    signItYourself: signItYourself(status, (d) => [allocateExitCall(d.address, lots), claimCall(d.address, 'A'), claimCall(d.address, 'B')]),
  };
}

const isAddress = (v: string) => /^0x[0-9a-fA-F]{40}$/.test(v);

export async function walletPositions(store: Store, address: string) {
  if (!isAddress(address)) return { error: 'ADDRESS_INVALID' as const, detail: 'an address is 20 bytes of hex with a 0x prefix' };
  const holder = address.toLowerCase();
  const positions = [];
  for (const spec of SERIES) {
    const l = await ledgerFor(store, spec);
    positions.push({
      seriesId: spec.id,
      state: l.ledger === null ? ('NOT_DEPLOYED' as const) : ('INDEXED' as const),
      detail: l.detail,
      receipts: l.ledger === null ? null : receiptsOf(l.ledger, holder).toString(),
      entitledUnits: l.ledger === null ? null : { A: (receiptsOf(l.ledger, holder) * l.ledger.q.A).toString(), B: (receiptsOf(l.ledger, holder) * l.ledger.q.B).toString() },
      asOfBlock: l.cursor,
    });
  }
  return { address: holder, positions, note: 'receipts and units as the index has them; pending claims are listed separately and never counted as active backing' };
}

export async function walletClaims(store: Store, address: string) {
  if (!isAddress(address)) return { error: 'ADDRESS_INVALID' as const, detail: 'an address is 20 bytes of hex with a 0x prefix' };
  const holder = address.toLowerCase();
  const claims = [];
  for (const spec of SERIES) {
    const l = await ledgerFor(store, spec);
    const c = l.ledger === null ? null : claimsOf(l.ledger, holder);
    claims.push({
      seriesId: spec.id,
      state: l.ledger === null ? ('NOT_DEPLOYED' as const) : ('INDEXED' as const),
      detail: l.detail,
      unpaid: c === null ? null : { A: c.A.toString(), B: c.B.toString() },
      claimPaused: l.ledger === null ? null : l.ledger.claimPaused,
      asOfBlock: l.cursor,
    });
  }
  return { address: holder, claims, note: 'a claim is paid only to its holder, one component at a time; no date and no recovery value is promised for a pending one' };
}

export async function positionsStatus(store: Store) {
  const profile = positionsNetwork();
  const series = [];
  for (const spec of SERIES) {
    const [evidence, ledger, reconciliation] = await Promise.all([seriesEvidence(store, spec), ledgerFor(store, spec), latestReconciliation(store, spec.id)]);
    series.push({
      id: spec.id,
      stage: spec.stage,
      deployment: deploymentView(spec.id),
      evidence: evidence.sources.map((s) => ({ id: s.id, status: s.latest?.status ?? null, readAt: s.latest?.readAt ?? null, versions: s.versions })),
      verification: evidence.verification ? { ranAt: evidence.verification.ranAt, addresses: evidence.verification.addresses.length, answering: evidence.verification.addresses.filter((a) => a.answersAsToken).length } : null,
      index: ledger.ledger === null ? { state: 'NONE', detail: ledger.detail } : { state: 'INDEXED', cursor: ledger.cursor, events: ledger.events, faults: ledger.faults, disagreements: ledger.disagreements.length },
      reconciliation: reconciliation.reconciliation ? { ranAt: reconciliation.reconciliation.ranAt, asOfBlock: reconciliation.reconciliation.asOfBlock, findings: reconciliation.reconciliation.components.map((c) => ({ component: c.component, finding: c.finding })) } : null,
      gatesPassed: GATES.filter((g) => g.status === 'PASSED').length,
      gates: GATES.length,
    });
  }
  return { observedAt: new Date().toISOString(), network: profile.id, chainId: profile.chainId, series };
}

export { seriesById };

/** A reconciliation view with its limit line always attached. */
export type ReconciliationView = Reconciliation;

/**
 * The instrument file (R01): everything the archive and the chain say about
 * each candidate component, in one document a reviewer can take to an
 * admission decision — and everything they do not say, listed as such. It is
 * generated from the record every time; nothing in it is typed by hand.
 */
export async function instrumentFile(store: Store, spec: SeriesSpec) {
  const evidence = await seriesEvidence(store, spec);
  const bySource = new Map(evidence.sources.map((s) => [s.id, s]));
  const xstocks = bySource.get('xstocks:AAPLx')?.latest?.parsed as { symbol?: string; name?: string; isin?: string | null; underlyingSymbol?: string | null; underlyingIsin?: string | null; isTradingHalted?: boolean | null } | null | undefined;
  const ondo = bySource.get('ondo:AAPLon')?.latest?.parsed as { symbol?: string; addresses?: { networkChainId: string; address: string; decimals: number | null }[] } | null | undefined;

  const components = spec.components.map((c) => {
    const record = c.id === 'A' ? xstocks : ondo;
    const recordSource = c.id === 'A' ? bySource.get('xstocks:AAPLx') : bySource.get('ondo:AAPLon');
    const addresses = (evidence.verification?.addresses ?? []).filter((v) => v.component === c.id);
    const documents = evidence.sources.filter((s) => s.kind === 'page' && s.component === c.id);
    return {
      component: c.id,
      instrument: c.instrument,
      issuerAsDocumented: c.issuer,
      network: { candidate: c.chain, chainId: evidence.verification?.chainId ?? null },
      underlying:
        c.id === 'A' && xstocks
          ? { symbol: xstocks.underlyingSymbol ?? null, isin: xstocks.underlyingIsin ?? null, instrumentIsin: xstocks.isin ?? null, tradingHalted: xstocks.isTradingHalted ?? null, source: recordSource?.id ?? null, readAt: recordSource?.latest?.readAt ?? null }
          : { symbol: null, isin: null, instrumentIsin: null, tradingHalted: null, source: recordSource?.id ?? null, readAt: recordSource?.latest?.readAt ?? null, reason: recordSource?.latest?.status === 'ACCESS_DENIED' ? 'the issuer record is behind an API key this desk does not hold' : recordSource?.latest ? recordSource.latest.status : 'not fetched yet' },
      issuerRecord: recordSource
        ? { id: recordSource.id, url: recordSource.url, status: recordSource.latest?.status ?? null, readAt: recordSource.latest?.readAt ?? null, hash: recordSource.latest?.hash ?? null, versions: recordSource.versions, parsed: recordSource.latest?.parse ?? null }
        : null,
      addressesOnChain: addresses.map((v) => ({
        role: v.role,
        address: v.address,
        explorer: v.explorer,
        hasCode: v.hasCode.value,
        codeHash: v.codeHash.value,
        symbol: v.symbol.value,
        decimals: v.decimals.value,
        asset: v.asset.value,
        assetMatchesClaim: v.assetMatchesClaim,
        answersAsToken: v.answersAsToken,
        proxy: v.proxy.state === 'VERIFIED' ? { kind: v.proxy.kind, implementation: v.proxy.implementation, admin: v.proxy.admin, beacon: v.proxy.beacon } : { kind: null, reason: v.proxy.reason },
        readAt: v.readAt,
        source: v.source,
      })),
      candidateUnit:
        c.id === 'A'
          ? { role: 'WRAPPER_V2', why: 'the issuer’s current non-rebasing wrapper; the raw token’s balance behaviour under a corporate action is not assumed static', chosen: false }
          : { role: 'ISSUER_TOKEN', why: 'the issuer’s own token, once its record answers', chosen: false },
      documents: documents.map((d) => ({ title: d.title, url: d.url, status: d.latest?.status ?? null, hash: d.latest?.hash ?? null, firstSeenAt: d.latest?.firstSeenAt ?? null, changedAt: d.latest?.changedAt ?? null, versions: d.versions })),
      notKnown: c.unknown,
      // R02: the parties behind the component as the issuer's documents name them; a role without a name is left empty on purpose.
      relatedParties: DEPENDENCIES.filter((d) => d.component === c.id).map((d) => ({ partyType: d.partyType, name: d.name, relationship: d.relationship, source: d.source, readOn: d.readOn, limit: d.limit })),
      notProven: evidence.verification?.addresses[0]?.notProven ?? [],
      onAFork: evidence.fork && evidence.fork.component === c.id ? evidence.fork : null,
      statuses: c.statuses,
      verification: c.verification,
    };
  });

  return {
    seriesId: spec.id,
    name: spec.name,
    company: spec.company,
    generatedAt: new Date().toISOString(),
    stage: spec.stageLine,
    admission: 'not decided — a reviewer decides from this file, the fork tests and the rights review; nothing here admits a component by itself',
    components,
    // R02: parties named under both components, and names that may be shared but are not established as such.
    relatedParties: { shared: sharedParties(), possiblyShared: POSSIBLY_SHARED, note: NOT_KNOWN_LINE },
    gates: GATES,
  };
}
