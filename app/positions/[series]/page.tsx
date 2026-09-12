import Link from 'next/link';
import { notFound } from 'next/navigation';
import { describeAge } from '@/lib/doctrine/reading';
import { units18 } from '@/lib/positions/fork-evidence';
import { drillEvidence } from '@/lib/positions/drill-evidence';
import { DEPENDENCIES, NOT_KNOWN_LINE, POSSIBLY_SHARED, sharedParties } from '@/lib/positions/dependencies';
import { deploymentView, ledgerFor, seriesEvidence } from '@/lib/positions/api';
import { latestReconciliation } from '@/lib/positions/reconcile';
import { GATES, PROMISES, seriesById, type ComponentStatus } from '@/lib/positions/series';
import { getStoreAsync } from '@/lib/store';
import { PositionSimulator } from '../../components/position-simulator';
import { WalletLookup } from '../../components/wallet-lookup';

export const dynamic = 'force-dynamic';

/**
 * One series: what it would hold, from whom, what is known and not known
 * about each component, the four statuses each component has to earn on its
 * own, the ledger run by hand, and the gates before any of it touches a real
 * asset. Every figure is labelled illustrative because every figure is.
 */

const STATUS_LABEL: Record<ComponentStatus, { text: string; colour: string }> = {
  NOT_DETERMINED: { text: 'not determined', colour: 'var(--color-state-fog)' },
  YES: { text: 'yes', colour: 'var(--color-state-live)' },
  NO: { text: 'no', colour: 'var(--color-state-dark)' },
};

const GATE_COLOUR: Record<(typeof GATES)[number]['status'], string> = {
  NOT_STARTED: 'var(--color-state-fog)',
  IN_RESEARCH: 'var(--color-state-stale)',
  PASSED: 'var(--color-state-live)',
};

export async function generateMetadata({ params }: { params: Promise<{ series: string }> }) {
  const { series } = await params;
  const spec = seriesById(series);
  return { title: spec ? spec.name : 'Position' };
}

export default async function SeriesPage({ params }: { params: Promise<{ series: string }> }) {
  const { series } = await params;
  const spec = seriesById(series);
  if (spec === null) notFound();
  const [a, b] = spec.components;
  const now = new Date();
  const store = await getStoreAsync();
  const [evidence, ledger, reconciliation, drill] = await Promise.all([seriesEvidence(store, spec), ledgerFor(store, spec), latestReconciliation(store, spec.id), drillEvidence()]);
  const deployment = deploymentView(spec.id);
  const ageOf = (iso: string) => describeAge(Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000)));
  const FIELD = (f: { value: unknown; state: 'VERIFIED' | 'UNREAD'; reason: string | null }) =>
    f.state === 'VERIFIED' ? (
      <span className="text-(--color-paper)">{String(f.value)}</span>
    ) : (
      <span className="absent" title={f.reason ?? 'unread'}>
        —
      </span>
    );

  return (
    <main className="px-3 py-8 sm:px-4 sm:py-10">
      <header className="mb-8 px-1">
        <div className="kicker">
          <b>The position</b> · {spec.company} · <Link href="/positions" className="hover:text-(--color-paper)">all positions</Link>
        </div>
        <h1 className="display mt-4 max-w-3xl text-4xl text-(--color-paper) sm:text-5xl">{spec.name}</h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-(--color-paper-dim)">{spec.stageLine}</p>
      </header>

      {/* ── the components ─────────────────────────────────────────────── */}
      <section>
        <div className="cells grid-cols-1 md:grid-cols-2">
          {[a, b].map((c) => (
            <div key={c.id} className="cell p-6 sm:p-8">
              <div className="flex items-baseline justify-between gap-4">
                <span className="kicker">
                  <b>Component {c.id}</b> · {c.chain}
                </span>
                <span className="kicker" style={{ color: 'var(--color-state-stale)' }}>
                  {c.verification.toLowerCase()}
                </span>
              </div>
              <h2 className="display mt-3 text-2xl text-(--color-paper)">{c.instrument}</h2>
              <p className="mt-2 text-[13px] leading-relaxed text-(--color-paper-dim)">{c.issuer}</p>

              <div className="mt-5 grid gap-6 sm:grid-cols-2">
                <div>
                  <div className="kicker">Known · from the issuer’s documents</div>
                  <ul className="mt-2 space-y-2">
                    {c.known.map((line) => (
                      <li key={line} className="grid grid-cols-[1rem_minmax(0,1fr)] text-[13px] leading-relaxed text-(--color-paper-dim)">
                        <span className="text-(--color-accent)">—</span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="kicker">Not known · not replaced by a guess</div>
                  <ul className="mt-2 space-y-2">
                    {c.unknown.map((line) => (
                      <li key={line} className="grid grid-cols-[1rem_minmax(0,1fr)] text-[13px] leading-relaxed text-(--color-paper-dim)">
                        <span className="text-(--color-paper-faint)">—</span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="mt-5 border-t border-(--color-rule) pt-4">
                <div className="kicker">Four statuses, each on its own</div>
                <dl className="tabular mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-y-1 text-[12px]">
                  {(
                    [
                      ['Transferable from the series to a wallet', c.statuses.transferable],
                      ['Unwrappable, if a wrapper', c.statuses.unwrappable],
                      ['A market offer for the intended size', c.statuses.marketOffer],
                      ['Eligible for redemption through the issuer', c.statuses.issuerRedemption],
                    ] as const
                  ).map(([label, status]) => {
                    const fork = evidence.fork && evidence.fork.component === c.id ? evidence.fork : null;
                    const hint =
                      fork === null
                        ? null
                        : label.startsWith('Transferable')
                          ? `on a fork at block ${fork.block.toLocaleString('en-US')}: a series took it in and paid it out ${fork.findings.seriesMintExitClaimWithRealWrapper ? '— yes' : '— no'}`
                          : label.startsWith('Unwrappable')
                            ? `on a fork at block ${fork.block.toLocaleString('en-US')}: redeem for an arbitrary holder ${fork.findings.wrapperUnwrapsForArbitraryHolder ? '— yes' : '— no'}`
                            : label.startsWith('A market offer')
                              ? `the wrapper holds ${units18(fork.wrapperRawReserve)} of the raw token and has ${units18(fork.wrapperTotalSupply)} shares in all — a size to weigh any intended lot against`
                              : null;
                    return (
                      <div key={label} className="contents">
                        <dt className="text-(--color-paper-dim)">
                          {label}
                          {hint ? <span className="block text-[10px] normal-case tracking-normal text-(--color-paper-faint)">{hint}</span> : null}
                        </dt>
                        <dd className="text-right" style={{ color: STATUS_LABEL[status].colour }}>
                          {STATUS_LABEL[status].text}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
                <p className="mt-2 text-[10px] leading-relaxed text-(--color-paper-faint)">
                  A status is an admission decision; the lines under them are evidence, dated, for whoever decides.
                </p>
              </div>

              <div className="mt-5 border-t border-(--color-rule) pt-4">
                <div className="kicker">Sources</div>
                <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
                  {c.sources.map((s) => (
                    <li key={s.url}>
                      <a href={s.url} className="text-[12px] text-(--color-paper-dim) underline decoration-(--color-rule-2) underline-offset-4 hover:text-(--color-paper)" rel="noopener noreferrer" target="_blank">
                        {s.title} ↗
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── related parties ─────────────────────────────────────────────── */}
      <section className="mt-8">
        <div className="flex items-baseline justify-between gap-6 px-1 pb-3">
          <span className="kicker">
            <b>Related parties</b> · as the issuers’ documents name them · read {DEPENDENCIES[0]?.readOn}
          </span>
          <Link href="/mechanism#6-flows-and-screens" className="hidden text-[13px] text-(--color-paper-faint) hover:text-(--color-paper) sm:inline">
            the map of related parties, §6
          </Link>
        </div>
        <div className="cells grid-cols-1 md:grid-cols-2">
          {(['A', 'B'] as const).map((id) => (
            <div key={id} className="cell p-6 sm:p-8">
              <div className="kicker">
                <b>Component {id}</b> · {id === 'A' ? a.instrument.split(',')[0] : b.instrument.split(',')[0]}
              </div>
              <dl className="mt-3 grid grid-cols-[minmax(6rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-2 text-[12px]">
                {DEPENDENCIES.filter((d) => d.component === id).map((d, i) => (
                  <div key={`${d.partyType}-${d.name ?? 'none'}-${i}`} className="contents">
                    <dt className="kicker pt-0.5">{d.partyType.toLowerCase().replace('_', ' ')}</dt>
                    <dd>
                      {d.name === null ? (
                        <span className="text-(--color-state-fog)">not known — {d.relationship}</span>
                      ) : (
                        <>
                          <span className="text-(--color-paper)">{d.name}</span>
                          <span className="text-(--color-paper-dim)"> — {d.relationship}</span>
                        </>
                      )}
                      <span className="block text-[10px] leading-relaxed text-(--color-paper-faint)">
                        {d.source.url ? (
                          <a href={d.source.url} className="underline decoration-(--color-rule-2) underline-offset-4 hover:text-(--color-paper)" rel="noopener noreferrer" target="_blank">
                            {d.source.title}
                          </a>
                        ) : (
                          d.source.title
                        )}
                        {d.limit ? ` · ${d.limit}` : ''}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
        <div className="cells mt-px grid-cols-1">
          <div className="cell p-6 sm:p-8">
            <div className="kicker">Shared, or possibly shared</div>
            {sharedParties().length === 0 ? (
              <p className="mt-2 text-[12px] leading-relaxed text-(--color-paper-dim)">No party is named under both components in the documents read. That is a fact about the documents, not a finding of independence: component B’s broker, custodian, security agent and verification agent are described but not named.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-[12px] text-(--color-paper-dim)">
                {sharedParties().map((s) => (
                  <li key={s.name}>
                    <span className="text-(--color-paper)">{s.name}</span> — {s.roles.join(', ')}
                  </li>
                ))}
              </ul>
            )}
            <ul className="mt-3 space-y-2 text-[12px] leading-relaxed text-(--color-paper-dim)">
              {POSSIBLY_SHARED.map((p) => (
                <li key={p.name} className="grid grid-cols-[1rem_minmax(0,1fr)]">
                  <span className="text-(--color-paper-faint)">?</span>
                  <span>
                    <span className="text-(--color-paper)">{p.name}</span> — {p.note}.
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] leading-relaxed text-(--color-paper-faint)">{NOT_KNOWN_LINE} The pages these lines come from are watched for change by hash; a changed page is a note on the desk and a reason to read them again.</p>
          </div>
        </div>
      </section>

      {/* ── evidence and status ─────────────────────────────────────────── */}
      <section className="mt-8">
        <div className="flex items-baseline justify-between gap-6 px-1 pb-3">
          <span className="kicker">
            <b>Evidence and status</b> · what was fetched, what the chain said, what is deployed
          </span>
          <Link href={`/api/positions/${spec.id}/evidence`} className="hidden text-[13px] text-(--color-paper-faint) hover:text-(--color-paper) sm:inline">
            as data →
          </Link>
        </div>
        <div className="cells grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="cell p-6 sm:p-8">
            <div className="kicker">Issuer sources · archived on a schedule, kept as received</div>
            <ul className="mt-3 space-y-4">
              {evidence.sources.filter((s) => s.kind !== 'page').map((s) => (
                <li key={s.id} className="text-[13px] leading-relaxed">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                    <span className="text-(--color-paper)">
                      <span className="tabular text-(--color-accent)">{s.component}</span> {s.title}
                    </span>
                    <span
                      className="tabular text-[10px] uppercase tracking-[0.14em]"
                      style={{ color: s.latest === null ? 'var(--color-state-fog)' : s.latest.status === 'OK' ? 'var(--color-state-live)' : s.latest.status === 'ACCESS_DENIED' ? 'var(--color-state-stale)' : 'var(--color-state-dark)' }}
                    >
                      {s.latest === null ? 'not yet fetched' : s.latest.status.toLowerCase().replace('_', ' ')}
                    </span>
                  </div>
                  <div className="tabular mt-1 text-[11px] text-(--color-paper-faint)">
                    {s.latest === null ? (
                      s.storeFault ?? 'no observation on record'
                    ) : (
                      <>
                        read {ageOf(s.latest.readAt)} ago · {s.latest.parse.toLowerCase().replace('_', ' ')} · {s.versions ?? '—'} version{s.versions === 1 ? '' : 's'}
                        {s.latest.hash ? ` · ${s.latest.parse === 'PARSED' ? 'record' : 'body'} ${s.latest.hash.slice(0, 12)}…` : ''}
                      </>
                    )}
                  </div>
                  {s.latest?.detail ? <div className="mt-1 text-[11px] text-(--color-paper-dim)">{s.latest.detail}</div> : null}
                  <a href={s.url} className="mt-1 inline-block text-[11px] text-(--color-paper-faint) underline decoration-(--color-rule-2) underline-offset-4 hover:text-(--color-paper)" rel="noopener noreferrer" target="_blank">
                    {s.url}
                  </a>
                </li>
              ))}
            </ul>

            <div className="mt-6 border-t border-(--color-rule) pt-4">
              <div className="kicker">
                Documents watched · {evidence.sources.filter((s) => s.kind === 'page').length} · hashed, never read for meaning
              </div>
              <ul className="tabular mt-2 space-y-1 text-[11px]">
                {evidence.sources
                  .filter((s) => s.kind === 'page')
                  .map((s) => (
                    <li key={s.id} className="flex items-baseline gap-2">
                      <span
                        aria-hidden="true"
                        style={{ color: s.latest === null ? 'var(--color-state-fog)' : s.latest.status !== 'OK' ? 'var(--color-state-stale)' : (s.versions ?? 1) > 1 ? 'var(--color-accent)' : 'var(--color-state-live)' }}
                      >
                        ●
                      </span>
                      <span className="text-(--color-accent)">{s.component}</span>
                      <a href={s.url} className="text-(--color-paper-dim) hover:text-(--color-paper)" rel="noopener noreferrer" target="_blank">
                        {s.title}
                      </a>
                      <span className="ml-auto whitespace-nowrap text-(--color-paper-faint)">
                        {s.latest === null ? 'not fetched' : s.latest.status !== 'OK' ? s.latest.status.toLowerCase().replace('_', ' ') : s.latest.changedAt ? `changed ${ageOf(s.latest.changedAt)} ago · ${s.versions ?? '—'} versions` : `unchanged · read ${ageOf(s.latest.readAt)} ago`}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>

            <div className="mt-6 border-t border-(--color-rule) pt-4">
              <div className="kicker">Deployment · index · reconciliation</div>
              <dl className="tabular mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[12px]">
                <dt className="text-(--color-paper-faint)">Deployment</dt>
                <dd className="text-(--color-paper-dim)">
                  {deployment.state.toLowerCase().replace('_', ' ')}
                  {deployment.address ? ` · ${deployment.address}` : ''}
                </dd>
                <dt className="text-(--color-paper-faint)">Index</dt>
                <dd className="text-(--color-paper-dim)">{ledger.ledger === null ? 'none — nothing is read from a chain for a series that is not deployed' : `${ledger.events} events to block ${ledger.cursor}; ${ledger.ledger.n.toString()} lots outstanding`}</dd>
                <dt className="text-(--color-paper-faint)">Reconciliation</dt>
                <dd className="text-(--color-paper-dim)">
                  {reconciliation.reconciliation === null
                    ? 'none'
                    : reconciliation.reconciliation.components.map((c) => `${c.component} ${c.finding.toLowerCase()}`).join(' · ')}
                </dd>
                <dt className="text-(--color-paper-faint)">Sign it yourself</dt>
                <dd className="text-(--color-paper-dim)">
                  {deployment.state === 'CONFIGURED'
                    ? `/api/positions/${spec.id}/preview-mint?lots=N and preview-exit?lots=N return the approvals and the call as bytes for your own wallet; the site holds no key and sends nothing`
                    : 'nothing is prepared for a series that is not deployed; when one is, the preview endpoints return the bytes for your own wallet, and the site still sends nothing'}
                </dd>
              </dl>
              {deployment.detail ? <p className="mt-2 text-[11px] leading-relaxed text-(--color-paper-faint)">{deployment.detail}</p> : null}
            </div>
          </div>

          <div className="cell p-6 sm:p-8">
            <div className="kicker">
              What the chain said · {evidence.verification ? `${evidence.verification.network} · read ${ageOf(evidence.verification.ranAt)} ago` : 'not yet read'}
            </div>
            {evidence.verification === null || evidence.verification.addresses.length === 0 ? (
              <p className="mt-3 text-[13px] leading-relaxed text-(--color-paper-dim)">
                {evidence.verificationStoreFault ?? 'No candidate address has been read on chain yet. The first daily run archives the issuers’ records, then reads every address they name.'}
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="tabular w-full min-w-[46rem] border-collapse text-[12px]">
                  <thead>
                    <tr className="kicker text-left">
                      <th className="pb-2 pr-3 font-normal">Role</th>
                      <th className="pb-2 pr-3 font-normal">Address</th>
                      <th className="pb-2 pr-3 font-normal">Code</th>
                      <th className="pb-2 pr-3 font-normal">Symbol</th>
                      <th className="pb-2 pr-3 text-right font-normal">Dec.</th>
                      <th className="pb-2 pr-3 font-normal">asset() vs claim</th>
                      <th className="pb-2 pr-3 font-normal">Answers as token</th>
                      <th className="pb-2 font-normal">Behind it</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evidence.verification.addresses.map((v) => (
                      <tr key={`${v.role}-${v.address}`} className="border-t border-(--color-rule)">
                        <td className="py-2 pr-3 text-(--color-paper)">
                          <span className="text-(--color-accent)">{v.component}</span> {v.role.toLowerCase().replace('_', ' ')}
                        </td>
                        <td className="py-2 pr-3">
                          {v.explorer ? (
                            <a href={v.explorer} className="text-(--color-paper-dim) underline decoration-(--color-rule-2) underline-offset-4 hover:text-(--color-paper)" rel="noopener noreferrer" target="_blank">
                              {v.address.slice(0, 10)}…{v.address.slice(-6)}
                            </a>
                          ) : (
                            <span className="text-(--color-paper-dim)">{v.address.slice(0, 10)}…{v.address.slice(-6)}</span>
                          )}
                        </td>
                        <td className="py-2 pr-3">{FIELD(v.hasCode)}</td>
                        <td className="py-2 pr-3">{FIELD(v.symbol)}</td>
                        <td className="py-2 pr-3 text-right">{FIELD(v.decimals)}</td>
                        <td className="py-2 pr-3" style={{ color: v.assetMatchesClaim === 'MATCHES' ? 'var(--color-state-live)' : v.assetMatchesClaim === 'DRIFT' ? 'var(--color-state-dark)' : 'var(--color-paper-faint)' }}>
                          {v.assetMatchesClaim.toLowerCase().replace('_', ' ')}
                        </td>
                        <td className="py-2 pr-3" style={{ color: v.answersAsToken ? 'var(--color-state-live)' : 'var(--color-state-stale)' }}>
                          {v.answersAsToken ? 'yes' : 'no'}
                        </td>
                        <td className="py-2">
                          {v.proxy.state !== 'VERIFIED' ? (
                            <span className="absent" title={v.proxy.reason ?? 'unread'}>
                              —
                            </span>
                          ) : v.proxy.kind === 'NONE' ? (
                            <span className="text-(--color-paper-faint)" title="no EIP-1967 slot is set; a proxy of another kind is not ruled out">
                              no 1967 slot
                            </span>
                          ) : (
                            <span className="text-(--color-paper-dim)" title={`implementation ${v.proxy.implementation ?? '—'} · admin ${v.proxy.admin ?? '—'} · beacon ${v.proxy.beacon ?? '—'}`}>
                              {v.proxy.kind === 'BEACON' ? 'beacon' : 'impl.'} {(v.proxy.implementation ?? v.proxy.beacon ?? '').slice(0, 10)}…
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {evidence.fork ? (
              <div className="mt-5 border-t border-(--color-rule) pt-4">
                <div className="kicker">
                  On a fork of Ethereum · block {evidence.fork.block.toLocaleString('en-US')} ·{' '}
                  {new Date(evidence.fork.blockTimestamp * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC · component {evidence.fork.component}
                </div>
                <ul className="tabular mt-2 space-y-1 text-[11px]">
                  {(
                    [
                      ['asset(), symbols and decimals as the issuer’s record says', evidence.fork.findings.identityAsDocumented],
                      ['an address that is nobody in particular can transfer the wrapper', evidence.fork.findings.wrapperTransfersForArbitraryHolder],
                      ['a series contract took the real wrapper in and paid it out (mint, exit, claim)', evidence.fork.findings.seriesMintExitClaimWithRealWrapper],
                      [`the wrapper unwraps for such a holder: 10 shares → ${units18(evidence.fork.findings.unwrapRawReceivedFor10e18)} raw, as quoted`, evidence.fork.findings.wrapperUnwrapsForArbitraryHolder],
                      [`the raw token moves for such a holder: 1 sent, ${units18(evidence.fork.findings.rawReceivedFor1e18Sent)} received`, evidence.fork.findings.rawTransfersForArbitraryHolder],
                      ['the raw token’s balance is a stored number', evidence.fork.findings.rawBalanceSettableByStorage],
                    ] as const
                  ).map(([line, yes]) => (
                    <li key={line} className="flex items-baseline gap-2">
                      <span style={{ color: yes ? 'var(--color-state-live)' : 'var(--color-state-stale)' }}>{yes ? 'yes' : 'no'}</span>
                      <span className="text-(--color-paper-dim)">{line}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] leading-relaxed text-(--color-paper-faint)">
                  The wrapper held {units18(evidence.fork.wrapperRawReserve)} of the raw token and had {units18(evidence.fork.wrapperTotalSupply)} shares in all at that block. {evidence.fork.how}. Rerun:{' '}
                  <code className="text-(--color-paper-dim)">cd contracts && npm run test:fork</code>.
                </p>
                {evidence.fork.gas ? (
                  <div className="mt-4">
                    <div className="kicker">What each operation cost to execute · at that block · gas</div>
                    <dl className="tabular mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[11px]">
                      {(
                        [
                          ['a plain transfer of the wrapper (holding it directly)', evidence.fork.gas.wrapperTransfer],
                          ['mint 3 lots (both deposits, the receipt)', evidence.fork.gas.mint3Lots],
                          ['allocate 3 lots for exit (no token moves)', evidence.fork.gas.allocateExit3Lots],
                          ['claim A (the real wrapper moves out)', evidence.fork.gas.claimA],
                          ['claim B (a mock moves out)', evidence.fork.gas.claimB],
                        ] as const
                      ).map(([label, gas]) => (
                        <div key={label} className="contents">
                          <dt className="text-(--color-paper-faint)">{label}</dt>
                          <dd className="text-(--color-paper-dim)">{gas.toLocaleString('en-US')}</dd>
                        </div>
                      ))}
                    </dl>
                    <p className="mt-2 text-[10px] leading-relaxed text-(--color-paper-faint)">{evidence.fork.gas.note}. No gas price and no token price is applied here: a cost in money needs both, dated.</p>
                  </div>
                ) : null}
                {evidence.fork.authority ? (
                  <div className="mt-4">
                    <div className="kicker">Who stands behind each address · at that block</div>
                    <div className="mt-2 overflow-x-auto">
                      <table className="tabular w-full min-w-[40rem] border-collapse text-[11px]">
                        <thead>
                          <tr className="kicker text-left">
                            <th className="pb-2 pr-3 font-normal">Address</th>
                            <th className="pb-2 pr-3 font-normal">EIP-1967 implementation</th>
                            <th className="pb-2 pr-3 font-normal">Proxy admin</th>
                            <th className="pb-2 pr-3 font-normal">owner()</th>
                            <th className="pb-2 font-normal">paused()</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(
                            [
                              ['raw token', evidence.fork.raw, evidence.fork.authority.raw],
                              ['wrapper v2', evidence.fork.wrapperV2, evidence.fork.authority.wrapperV2],
                              ['wrapper v1', evidence.fork.wrapperV1, evidence.fork.authority.wrapperV1],
                            ] as const
                          ).map(([label, address, au]) => (
                            <tr key={address} className="border-t border-(--color-rule)">
                              <td className="py-1.5 pr-3 text-(--color-paper)">
                                {label} <span className="text-(--color-paper-faint)">{address.slice(0, 10)}…</span>
                              </td>
                              <td className="py-1.5 pr-3 text-(--color-paper-dim)">{au.implementation ? `${au.implementation.slice(0, 10)}…${au.implementation.slice(-4)}` : 'no slot set'}</td>
                              <td className="py-1.5 pr-3 text-(--color-paper-dim)">{au.admin ? `${au.admin.slice(0, 10)}…${au.admin.slice(-4)}` : 'no slot set'}</td>
                              <td className="py-1.5 pr-3 text-(--color-paper-dim)">{au.owner ? `${au.owner.slice(0, 10)}…${au.owner.slice(-4)}` : 'not answered'}</td>
                              <td className="py-1.5 text-(--color-paper-dim)">{au.paused === null ? 'not answered' : au.paused ? 'yes' : 'no'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="mt-2 text-[10px] leading-relaxed text-(--color-paper-faint)">
                      {(() => {
                        const owners = new Set([evidence.fork.authority.raw.owner, evidence.fork.authority.wrapperV2.owner, evidence.fork.authority.wrapperV1.owner].filter((o): o is string => o !== null));
                        const shared = owners.size === 1 && evidence.fork.authority.raw.owner !== null;
                        return `Every address with an implementation slot set can have its code replaced by whoever controls its admin; that is a fact about the instrument, not a fault. ${shared ? 'The three contracts answer owner() with one and the same address: one party stands behind the raw token and both wrappers.' : 'The owners differ or were not answered; no shared party is inferred.'} Who those addresses belong to is not read from the chain and is not asserted here.`;
                      })()}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="mt-5 border-t border-(--color-rule) pt-4">
              <div className="kicker">What this does not prove</div>
              <ul className="mt-2 space-y-1 text-[12px] leading-relaxed text-(--color-paper-faint)">
                {(evidence.verification?.addresses[0]?.notProven ?? ['that the unit balance stays static under a corporate action', 'holder eligibility', 'anything about the issuer’s reserves']).map((line) => (
                  <li key={line}>— {line}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── the drill ───────────────────────────────────────────────────── */}
      {drill.drill ? (
        <section className="mt-8">
          <div className="flex items-baseline justify-between gap-6 px-1 pb-3">
            <span className="kicker">
              <b>The drill</b> · incidents staged on a local chain · {drill.drill.ranAt.slice(0, 16).replace('T', ' ')} UTC
            </span>
            <Link href="/mechanism#11-operator-authority-and-incidents" className="hidden text-[13px] text-(--color-paper-faint) hover:text-(--color-paper) sm:inline">
              §11 of the mechanism
            </Link>
          </div>
          <div className="cells grid-cols-1 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <div className="cell p-6 sm:p-8">
              <ol className="space-y-4">
                {drill.drill.siteFindings.map((f) => (
                  <li key={f.scenario} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2">
                    <span className="tabular text-(--color-accent)">{f.scenario.slice(0, 1)}</span>
                    <div>
                      <div className="text-[13px] text-(--color-paper)">{f.scenario.slice(2)}</div>
                      <p className="mt-1 text-[12px] leading-relaxed text-(--color-paper-dim)">{f.finding}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div className="cell p-6 sm:p-8">
              <div className="kicker">On chain · {drill.drill.chainSteps.length} transactions or refusals</div>
              <ul className="tabular mt-2 space-y-1 text-[11px]">
                {drill.drill.chainSteps
                  .filter((s) => s.scenario !== 'setup')
                  .map((s) => (
                    <li key={`${s.scenario}-${s.did}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
                      <span className="text-(--color-paper-dim)">
                        {s.who} {s.did}
                      </span>
                      <span className="whitespace-nowrap" style={{ color: s.outcome === 'AS_EXPECTED' ? 'var(--color-state-live)' : 'var(--color-state-dark)' }}>
                        {s.tx ? `tx ${s.tx.slice(0, 10)}…` : `reverted ${s.revert ?? ''}`}
                      </span>
                    </li>
                  ))}
              </ul>
              <div className="mt-4 border-t border-(--color-rule) pt-3">
                <div className="kicker">Limits</div>
                <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-(--color-paper-faint)">
                  {drill.drill.limits.map((l) => (
                    <li key={l}>— {l}</li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] leading-relaxed text-(--color-paper-faint)">
                  {drill.drill.chain.note}. Run by {drill.drill.by}.
                </p>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* ── the ledger, by hand ─────────────────────────────────────────── */}
      <section className="mt-8">
        <div className="flex items-baseline justify-between gap-6 px-1 pb-3">
          <span className="kicker">
            <b>The ledger</b> · run it yourself
          </span>
          <Link href="/mechanism#7-the-ledger-lots-with-fixed-components" className="hidden text-[13px] text-(--color-paper-faint) hover:text-(--color-paper) sm:inline">
            §7 of the mechanism, in code
          </Link>
        </div>
        <PositionSimulator
          seriesName={spec.name}
          q={{ A: a.perLotIllustrative.toString(), B: b.perLotIllustrative.toString() }}
          capLots={spec.capLotsIllustrative.toString()}
          labels={{ A: a.instrument.split(',')[0] ?? 'A', B: b.instrument.split(',')[0] ?? 'B' }}
        />
      </section>

      {/* ── my position, read only ──────────────────────────────────────── */}
      <section className="mt-8">
        <div className="flex items-baseline justify-between gap-6 px-1 pb-3">
          <span className="kicker">
            <b>My position</b> · what the index holds for an address
          </span>
          <Link href="/mechanism#6-flows-and-screens" className="hidden text-[13px] text-(--color-paper-faint) hover:text-(--color-paper) sm:inline">
            §6 of the mechanism
          </Link>
        </div>
        <WalletLookup seriesId={spec.id} labels={{ A: a.instrument.split(',')[0] ?? 'A', B: b.instrument.split(',')[0] ?? 'B' }} />
      </section>

      {/* ── rules, promises, gates ──────────────────────────────────────── */}
      <section className="mt-8">
        <div className="cells grid-cols-1 lg:grid-cols-3">
          <div className="cell p-6 sm:p-8">
            <div className="kicker">
              <b>The rules</b> of a series
            </div>
            <ul className="mt-3 space-y-2">
              {spec.rules.map((r) => (
                <li key={r} className="grid grid-cols-[1rem_minmax(0,1fr)] text-[13px] leading-relaxed text-(--color-paper-dim)">
                  <span className="text-(--color-accent)">—</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="cell p-6 sm:p-8">
            <div className="kicker">
              <b>What we will say</b> · and can test
            </div>
            <ul className="mt-3 space-y-2">
              {PROMISES.testable.map((r) => (
                <li key={r} className="grid grid-cols-[1rem_minmax(0,1fr)] text-[13px] leading-relaxed text-(--color-paper)">
                  <span className="text-(--color-accent)">—</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
            <div className="kicker mt-6">
              <b>What we will not say</b>
            </div>
            <ul className="mt-3 space-y-1.5">
              {PROMISES.unsupported.map((r) => (
                <li key={r} className="grid grid-cols-[1rem_minmax(0,1fr)] text-[13px] leading-relaxed text-(--color-paper-faint)">
                  <span>×</span>
                  <span className="line-through decoration-(--color-rule-2)">{r}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="cell p-6 sm:p-8">
            <div className="kicker">
              <b>Gates</b> before a real asset
            </div>
            <ul className="mt-3 space-y-3">
              {GATES.map((g) => (
                <li key={g.id} className="text-[13px] leading-relaxed">
                  <div className="flex items-baseline gap-2">
                    <span className="tabular text-(--color-accent)">{g.id}</span>
                    <span className="text-(--color-paper)">{g.name}</span>
                    <span className="tabular ml-auto text-[10px] uppercase tracking-[0.14em]" style={{ color: GATE_COLOUR[g.status] }}>
                      {g.status.toLowerCase().replace('_', ' ')}
                    </span>
                  </div>
                  <div className="text-(--color-paper-faint)">{g.today}</div>
                </li>
              ))}
            </ul>
            <div className="kicker mt-6">Deferred</div>
            <p className="mt-2 text-[12px] leading-relaxed text-(--color-paper-faint)">{spec.deferred.join(' · ')}.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
