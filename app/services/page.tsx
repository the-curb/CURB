import Link from 'next/link';
import { creditsStatus } from '@/lib/credits/config';
import { creditRateHistoryKey } from '@/lib/credits/maintenance';
import { topUpReadiness } from '@/lib/credits/top-up';
import { receipts } from '@/lib/credits/receipts';
import { MINIMUM_DECISION, MINIMUM_OPEN_CENTS, NOTICE_DAYS, PRICES_DECISION, SERVICES, centsText } from '@/lib/credits/prices';
import { curbForCents, curbText, usd18Text } from '@/lib/credits/rate';
import { explorerAddress } from '@/lib/chain/networks';
import { hookPermissions, isNativeCurrency, ZERO_ADDRESS } from '@/lib/chain/uniswap-v4';
import { getStoreAsync } from '@/lib/store';
import { launchStatus } from '@/lib/launch/status';
import { rateHistory } from '@/lib/launch/evidence';
import { CreditDesk } from '../components/credit-desk';
import { KeyMaker } from '../components/key-maker';
import { BRAND } from '@/lib/brand';
import { DEFAULT_KINDS, WIDE_BASIS_BPS, type ConditionKind } from '@/lib/ops/alerts';
import { ACCESS, accessMode } from '@/lib/credits/access';
import { SERVICES_COPY as C, bandText, fill } from '@/lib/copy/services';

/** An address as text, linked to the chain's explorer where the profile publishes one; the address itself stays visible. */
function Addr({ address, href }: { address: string; href: string | null }) {
  return href === null ? (
    <span className="tabular break-all">{address}</span>
  ) : (
    <a href={href} className="tabular break-all underline decoration-(--color-rule) underline-offset-4 hover:decoration-(--color-accent)" rel="noreferrer">
      {address}
    </a>
  );
}

export const dynamic = 'force-dynamic';
export const metadata = { title: C.title, description: C.description };

const linkClass = 'underline decoration-(--color-accent) underline-offset-4 hover:text-(--color-paper)';

/**
 * The services page. It opens on what a reader can use and what it costs —
 * nothing, while the desk is free — then the one flow that needs a key, the
 * alerts, then what the CURB token is and is not. The payment machinery the
 * token was built for (the price list, the rate read from a pool at a block,
 * the desk, the receipts, the top-up) sits folded at the end, under a heading
 * that says it is switched off; in the paid mode it opens by itself. Every
 * figure that depends on a rate says where the rate came from, and nothing
 * here is a condition of the position product.
 */
export default async function ServicesPage() {
  const status = creditsStatus();
  const store = await getStoreAsync();
  const configured = status.state === 'CONFIGURED';
  const now = new Date();
  const mode = accessMode();
  const free = mode === 'FREE';
  const historyKey = status.state === 'CONFIGURED' ? creditRateHistoryKey(status.config) : null;
  // The tick is scheduled every five minutes; 400 readings cover a day with room for a faster schedule, and the day's filter does the rest.
  const [readiness, paid, history, launch] = await Promise.all([topUpReadiness(store, status, now), receipts(store), historyKey === null ? null : store.observations(historyKey, 400), launchStatus(store, process.cwd(), now)]);
  const { rateRead, code } = readiness;
  const rate = rateRead?.rate ?? null;
  const rateFault = rateRead?.storeFault ?? null;
  // The desk's own reads of the rate over the last day: how many, and the range — a reader can see the figure above is one of a series, not a single sample.
  const range = rateHistory(history, now, historyKey);
  const { codeCurrent, rateCurrent } = readiness.quoteReadiness;
  const minimumCurb = rate?.state === 'READ' ? curbForCents(rate.rate, BigInt(MINIMUM_OPEN_CENTS)) : null;
  const decimals = rate?.state === 'READ' ? rate.rate.token.decimals : null;
  const link = (address: string) => (status.state === 'CONFIGURED' ? explorerAddress(status.config.network, address) : null);
  const band = bandText(WIDE_BASIS_BPS);
  const kinds = Object.keys(C.alerts.kinds) as ConditionKind[];

  const deskState =
    status.state !== 'CONFIGURED'
      ? C.token.state.notDone
      : code === null || code.storeFault !== null
        ? 'configured; the verification could not be read'
        : code.code === null
          ? 'configured; code not yet verified'
          : codeCurrent
            ? 'recent code verified'
            : code.code.state === 'MATCHES'
              ? 'configured; a new verification is needed'
              : `configured; the code on chain is not the build (${code.code.state})`;
  const rateState = status.state !== 'CONFIGURED' || status.config.priceSource === null ? C.token.state.notDone : rateCurrent ? 'recent rate read' : 'configured; no current rate confirmed';
  const rateDetail =
    status.state !== 'CONFIGURED'
      ? 'No pool is configured here.'
      : status.config.priceSource === null
        ? 'No pool is recorded. Top-ups are indexed and wait, unpriced.'
        : rateFault !== null
          ? `The store did not answer (${rateFault}).`
          : rate === null
            ? 'No tick has read the pool yet.'
            : rate.state === 'READ'
              ? `Block ${rate.rate.block}, ${rate.rate.pool.kind}.`
              : `The pool has not answered with a price: ${rate.reason}.`;
  const standing: ReadonlyArray<readonly [string, string, string]> = [
    [C.token.steps.services, C.token.state.done, C.token.details.services],
    [C.token.steps.review, C.token.state.notDone, C.token.details.review],
    [C.token.steps.desk, deskState, status.state === 'CONFIGURED' ? `Desk ${status.config.desk} on ${status.config.network.label}.` : 'No token or desk is configured here.'],
    [C.token.steps.rate, rateState, rateDetail],
    [C.token.steps.interviews, C.token.state.notDone, C.token.details.interviews],
  ];

  const priceRows = (
    <>
      <tr className="border-t border-(--color-rule) align-top">
        <td className="py-3 pr-4 text-(--color-paper)">{C.use.minimum}</td>
        <td className="py-3 pr-4 text-(--color-paper-dim)">
          {C.use.minimumWhat} <span className="text-(--color-paper-faint)">{fill(C.decided, { by: MINIMUM_DECISION.by, on: MINIMUM_DECISION.on })}</span>
        </td>
        <td className="tabular py-3 text-right whitespace-nowrap text-(--color-paper)">{centsText(MINIMUM_OPEN_CENTS)}</td>
      </tr>
      {SERVICES.map((s) => (
        <tr key={s.id} className="border-t border-(--color-rule) align-top">
          <td className="py-3 pr-4 text-(--color-paper)">{s.title}</td>
          <td className="tabular py-3 pr-4 text-(--color-paper-faint)">{s.path}</td>
          <td className="tabular py-3 text-right text-(--color-paper)">
            <span className="whitespace-nowrap">{centsText(s.cents)}</span> <span className="block text-(--color-paper-faint)">/ {s.unit}</span>
          </td>
        </tr>
      ))}
    </>
  );

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 sm:py-16">
      <header className="mb-10">
        <div className="kicker">
          <b>{C.kicker}</b>
        </div>
        <h1 className="display mt-4 max-w-3xl text-4xl text-(--color-paper) sm:text-5xl">{C.headline[mode]}</h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-(--color-paper-dim)">{C.sub[mode]}</p>
        {free ? <p className="mt-3 text-[12px] text-(--color-paper-faint)">{fill(C.decided, { by: ACCESS.decidedBy, on: ACCESS.decidedOn })}</p> : null}
      </header>

      <section className="cells grid-cols-1">
        <div className="cell p-6 sm:p-8">
          <div className="kicker">
            <b>{C.use.kicker}</b>
          </div>
          <table className="mt-4 w-full table-fixed text-[13px] wrap-anywhere">
            <colgroup><col className="w-[30%]" /><col className="w-[50%]" /><col className="w-[20%]" /></colgroup>
            <thead>
              <tr className="kicker text-left">
                <th className="pb-2 pr-4 font-normal">{C.use.columns.service}</th>
                <th className="pb-2 pr-4 font-normal">{C.use.columns.what}</th>
                <th className="pb-2 text-right font-normal">{C.use.columns.cost}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-(--color-rule) align-top">
                <td className="py-3 pr-4 text-(--color-paper)">{C.use.open.title}</td>
                <td className="py-3 pr-4 text-(--color-paper-dim)">
                  {C.use.open.what} <span className="tabular hidden text-[12px] text-(--color-paper-faint) sm:block">{C.use.open.path}</span>
                </td>
                <td className="py-3 text-right text-(--color-paper)">{C.use.free}</td>
              </tr>
              {SERVICES.map((s) => (
                <tr key={s.id} className="border-t border-(--color-rule) align-top">
                  <td className="py-3 pr-4 text-(--color-paper)">{s.title}</td>
                  <td className="py-3 pr-4 text-(--color-paper-dim)">
                    {C.use.services[s.id]} <span className="tabular hidden text-[12px] text-(--color-paper-faint) sm:block">{s.path}</span>
                  </td>
                  <td className="tabular py-3 text-right text-(--color-paper)">
                    {free ? (
                      C.use.free
                    ) : (
                      <>
                        <span className="whitespace-nowrap">{centsText(s.cents)}</span> <span className="block text-(--color-paper-faint)">/ {s.unit}</span>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {free ? null : (
                <tr className="border-t border-(--color-rule) align-top">
                  <td className="py-3 pr-4 text-(--color-paper)">{C.use.minimum}</td>
                  <td className="py-3 pr-4 text-(--color-paper-dim)">{C.use.minimumWhat}</td>
                  <td className="tabular py-3 text-right whitespace-nowrap text-(--color-paper)">{centsText(MINIMUM_OPEN_CENTS)}</td>
                </tr>
              )}
            </tbody>
          </table>
          {free ? (
            <details className="mt-4 text-[12px]">
              <summary className="kicker cursor-pointer hover:text-(--color-paper)">{C.use.record}</summary>
              <p className="mt-3 max-w-2xl leading-relaxed text-(--color-paper-faint)">{fill(C.use.recordNote, { on: PRICES_DECISION.on })}</p>
              <table className="mt-3 w-full table-fixed wrap-anywhere">
                <colgroup><col className="w-[28%]" /><col className="w-[46%]" /><col className="w-[26%]" /></colgroup>
                <tbody>{priceRows}</tbody>
              </table>
            </details>
          ) : null}
        </div>
      </section>

      <section id="alerts" className="mt-10 scroll-mt-24 cells grid-cols-1 md:grid-cols-2">
        <div className="cell p-6 sm:p-8">
          <div className="kicker">
            <b>{C.alerts.kicker}</b>
          </div>
          <h2 className="display mt-3 text-2xl text-(--color-paper) sm:text-3xl">{C.alerts.headline}</h2>
          <ol className="mt-6 space-y-5">
            {C.alerts.steps.map((step, i) => (
              <li key={step.title} className="flex gap-3">
                <span className="tabular text-(--color-accent)">{String(i + 1).padStart(2, '0')}</span>
                <div className="min-w-0">
                  <div className="text-[15px] text-(--color-paper)">{step.title}</div>
                  <p className="mt-1 text-[13px] leading-relaxed text-(--color-paper-dim)">{step.body}</p>
                  {i === 0 ? (
                    <div className="mt-3">
                      <KeyMaker labels={C.alerts.key} />
                      <p className="mt-3 text-[12px] text-(--color-paper-faint)">{C.alerts.key.server}</p>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-[13px] text-(--color-paper)">{free ? C.alerts.free : C.alerts.paid}</p>
        </div>
        <div className="cell p-6 sm:p-8">
          <div className="kicker">
            <b>{C.alerts.kindsTitle}</b>
          </div>
          <dl className="mt-4 space-y-4">
            {kinds.map((kind) => (
              <div key={kind}>
                <dt className="kicker">
                  {kind} · {DEFAULT_KINDS.includes(kind) ? C.alerts.byDefault : C.alerts.onRequest}
                </dt>
                <dd className="mt-1 text-[13px] leading-relaxed text-(--color-paper-dim)">{fill(C.alerts.kinds[kind], { band })}</dd>
              </div>
            ))}
          </dl>
          <div className="kicker mt-6">{C.alerts.example}</div>
          <pre className="tabular mt-3 overflow-x-auto border border-(--color-rule) bg-(--color-ink) p-4 text-[12px] leading-relaxed text-(--color-paper)">{`POST ${BRAND.origin}/api/subscriptions
x-curb-key: curb_…
{ "url": "https://example.com/curb", "tokens": ["AAPL", "TSLA"] }
# kinds default to ${DEFAULT_KINDS.join(', ')}; add "kinds": ["desk"] for the plumbing

GET    ${BRAND.origin}/api/subscriptions
DELETE ${BRAND.origin}/api/subscriptions   { "id": "…" }`}</pre>
        </div>
      </section>

      <section className="mt-10 cells grid-cols-1 md:grid-cols-2">
        <div className="cell p-6 sm:p-8">
          <div className="kicker">
            <b>{C.token.kicker}</b>
          </div>
          <h2 className="display mt-3 text-2xl text-(--color-paper) sm:text-3xl">{C.token.headline}</h2>
          <p className="mt-3 text-[14px] leading-relaxed text-(--color-paper-dim)">
            {C.token.lede} {C.token.holders}
          </p>
          <div className="kicker mt-6">{C.token.notTitle}</div>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-[13px] leading-relaxed text-(--color-paper-dim)">
            {C.token.not.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        <div className="cell p-6 sm:p-8">
          <div className="kicker">
            <b>{C.token.statusTitle}</b>
          </div>
          <ol className="mt-4 space-y-3 text-[13px] leading-relaxed">
            {standing.map(([step, state, detail], i) => (
              <li key={step} className="flex gap-3">
                <span className="tabular text-(--color-accent)">{String(i + 1).padStart(2, '0')}</span>
                <span className="min-w-0 wrap-anywhere">
                  <span className="text-(--color-paper)">{step}</span>{' '}
                  <span className={state === C.token.state.done ? 'text-(--color-paper)' : 'text-(--color-paper-faint)'}>· {state}</span>
                  <span className="block text-[12px] text-(--color-paper-faint)">{detail}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-5 text-[13px] leading-relaxed text-(--color-paper-dim)">
            {C.token.venue} {C.token.venueTerms} {C.token.noBalance}
          </p>
          <p className="mt-3 text-[13px] leading-relaxed text-(--color-paper-dim)">{C.token.budget}</p>
          <p className="mt-4 text-[12px] text-(--color-paper-faint)">
            <Link href="/mechanism/decisions/token" className={linkClass}>
              {C.token.record}
            </Link>{' '}
            ·{' '}
            <Link href="/mechanism/decisions/assumptions" className={linkClass}>
              {C.token.assumptions}
            </Link>
          </p>
        </div>
      </section>

      <details className="mt-10 border border-(--color-rule)" open={!free}>
        <summary className="kicker cursor-pointer px-6 py-4 hover:text-(--color-paper) sm:px-8">{C.machinery.summary[mode]}</summary>
        <div className="px-6 pb-8 sm:px-8">
          <p className="max-w-2xl text-[13px] leading-relaxed text-(--color-paper-dim)">{C.machinery.lede}</p>
          <div className="kicker mt-5">{C.machinery.termsTitle[mode]}</div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[12px] leading-relaxed text-(--color-paper-faint)">
            {C.machinery.terms.map((line) => (
              <li key={line}>{fill(line, { days: NOTICE_DAYS })}</li>
            ))}
          </ul>

          <section className="mt-6 cells grid-cols-1 md:grid-cols-2">
            <div className="cell p-6">
              <div className="kicker">
                <b>The rate</b> · read from the chain · never typed in
              </div>
              {status.state !== 'CONFIGURED' ? (
                <>
                  <p className="mt-3 text-sm leading-relaxed text-(--color-paper)">No rate. {status.state === 'CONFIG_INVALID' ? `The record is invalid: ${status.detail}` : 'No token, desk or pool is configured here.'}</p>
                  <p className="mt-3 text-[12px] leading-relaxed text-(--color-paper-faint)">{C.machinery.noRate}</p>
                </>
              ) : rateFault !== null ? (
                <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--color-state-stale)' }}>
                  The last rate could not be read from the store ({rateFault}). Nothing is stated in its place; a store that does not answer is not a tick that never ran.
                </p>
              ) : rate === null ? (
                <p className="mt-3 text-sm leading-relaxed text-(--color-paper)">The desk is configured on {status.config.network.label}; no tick has read the pool yet.</p>
              ) : rate.state === 'UNREAD' ? (
                <>
                  <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--color-state-stale)' }}>
                    No rate at {rate.at}{rate.block !== null ? ` (block ${rate.block})` : ''}: {rate.reason}
                    {rate.detail ? ` — ${rate.detail}` : ''}.
                  </p>
                  <p className="mt-3 text-[12px] leading-relaxed text-(--color-paper-faint)">Nothing is quoted from an earlier read. The next tick reads again.</p>
                </>
              ) : (
                <dl className="mt-4 space-y-3 text-[13px]">
                  <div>
                    <dt className="kicker">One CURB · last sampled rate {rateCurrent ? '' : '· not a current read'}</dt>
                    <dd className="tabular mt-1 text-(--color-paper)">
                      {usd18Text(rate.rate.usdPerCurb18, 8)}
                      {rate.rate.guard.applied ? (
                        <span className="text-(--color-paper-faint)">
                          {' '}
                          · at the block {usd18Text(rate.rate.guard.atBlockUsdPerCurb18, 8)}; the lowest of {rate.rate.guard.samples} in the {rate.rate.guard.windowBlocks.toLocaleString('en-US')} blocks before is credited
                        </span>
                      ) : (
                        <span className="text-(--color-paper-faint)"> · at the block, and the lowest of {rate.rate.guard.samples} in the {rate.rate.guard.windowBlocks.toLocaleString('en-US')} blocks before</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="kicker">Market capitalisation · price × supply</dt>
                    <dd className="tabular mt-1 text-(--color-paper)">
                      {usd18Text(rate.rate.marketCapUsd18, 2)} <span className="text-(--color-paper-faint)">· supply {curbText(BigInt(rate.rate.token.supply), rate.rate.token.decimals, 0)} CURB</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="kicker">Readings in the last 24 hours</dt>
                    <dd className="tabular mt-1 text-[12px] text-(--color-paper-dim)">
                      {range.state === 'UNREAD' ? `UNREAD — ${range.detail}` : range.count === 0 ? 'No stored observations in this window' : `${range.count} · lowest ${usd18Text(range.low!, 8)} · highest ${usd18Text(range.high!, 8)}`}
                    </dd>
                  </div>
                  <div>
                    <dt className="kicker">{centsText(MINIMUM_OPEN_CENTS)} · the opening minimum</dt>
                    <dd className="tabular mt-1 text-(--color-paper)">{minimumCurb === null ? '—' : `${curbText(minimumCurb, rate.rate.token.decimals)} CURB`}</dd>
                  </div>
                  <div>
                    <dt className="kicker">Read</dt>
                    <dd className="tabular mt-1 text-[12px] text-(--color-paper-dim)">
                      block {rate.rate.block} · {rate.at} ·{' '}
                      {rate.rate.pool.kind === 'uniswap-v4-pool' ? (
                        <>
                          {/* A v4 pool has no address: its id inside the manager, which is what the explorer can show. */}
                          v4 pool <span className="tabular break-all">{rate.rate.pool.address}</span> in the manager <Addr address={rate.rate.pool.poolManager ?? '?'} href={rate.rate.pool.poolManager ? link(rate.rate.pool.poolManager) : null} />
                        </>
                      ) : (
                        <>
                          {rate.rate.pool.kind === 'uniswap-v2-pair' ? 'pair' : 'v3 pool'} <Addr address={rate.rate.pool.address} href={link(rate.rate.pool.address)} />
                        </>
                      )}{' '}
                      on {status.config.network.label} · quote {isNativeCurrency(rate.rate.pool.quoteAddress) ? 'native ETH' : <Addr address={rate.rate.pool.quoteAddress} href={link(rate.rate.pool.quoteAddress)} />}{' '}
                      {rate.rate.quote.kind === 'usd-stable' ? 'taken as US dollars' : `priced by feed ${rate.rate.quote.feed}`}
                      {status.config.priceSource?.v4 !== undefined && status.config.priceSource.v4.key.hooks !== ZERO_ADDRESS ? (
                        <>
                          {' '}· hook <Addr address={status.config.priceSource.v4.key.hooks} href={link(status.config.priceSource.v4.key.hooks)} />
                          {hookPermissions(status.config.priceSource.v4.key.hooks).beforeSwap
                            ? ' — it may act before a swap, so a pool price is what the hook lets it be; read its terms'
                            : hookPermissions(status.config.priceSource.v4.key.hooks).afterSwapReturnsDelta
                              ? ' — it acts after a swap and takes from its output, so buying CURB costs the venue’s cut on top of the pool’s price; it cannot move the price the desk reads'
                              : ''}
                        </>
                      ) : null}
                      {rate.rate.basis === 'EVENTS' ? ` · from the pool's event at block ${rate.rate.pool.eventBlock}` : ''}
                    </dd>
                  </div>
                  <div>
                    <dt className="kicker">The rule</dt>
                    <dd className="mt-1 text-[12px] leading-relaxed text-(--color-paper-faint)">
                      The price is the pool&rsquo;s own at the block — the ratio of a pair&rsquo;s reserves, or a v3 pool&rsquo;s square-root price; the capitalisation is that price times <span className="tabular">totalSupply()</span>. A top-up is credited at the rate at the block it was mined: by state while the node still serves that block, else from the pool&rsquo;s own last event at or before it; only if the pool had no price at that block — it did not exist yet, or held nothing to trade — is the head when indexed used, and the credit says which. The price a top-up is credited at is that block&rsquo;s or the lowest the pool showed in the window before it (about an hour), whichever is lower. This limits credit from a short spike; it does not guarantee resistance to sustained manipulation or a thin pool. So CURB for a dollar figure is the figure over the credited price — the figure times supply over capitalisation when the block&rsquo;s own price is the lower, more CURB when the window&rsquo;s low is.
                    </dd>
                  </div>
                </dl>
              )}
            </div>

            <div className="cell p-6">
              <div className="kicker">
                <b>The desk and the treasury</b> · {status.state === 'CONFIGURED' ? 'verification attempted every tick' : 'nothing to verify while no desk is configured'}
              </div>
              {status.state !== 'CONFIGURED' ? (
                <p className="mt-3 text-sm leading-relaxed text-(--color-paper-faint)">
                  No payment desk is configured here. {launch.treasury === null ? 'No valid treasury creation record is available here.' : <>The treasury is a {launch.treasury.threshold}-of-{launch.treasury.owners} Safe on Robinhood Chain: <span className="tabular break-all">{launch.treasury.address}</span>, created at block {launch.treasury.block.toLocaleString('en-US')}. That records its creation. It does not verify a deployed payment desk.</>}
                </p>
              ) : (
                <dl className="mt-4 space-y-3 text-[12px]">
                  <div>
                    <dt className="kicker">Desk · on {status.config.network.label}</dt>
                    <dd className="mt-1 text-(--color-paper)">
                      <Addr address={status.config.desk} href={link(status.config.desk)} />
                    </dd>
                  </div>
                  <div>
                    <dt className="kicker">Treasury · where every top-up goes</dt>
                    <dd className="mt-1 text-(--color-paper)">
                      <Addr address={status.config.treasury} href={link(status.config.treasury)} />
                    </dd>
                  </div>
                  <div>
                    <dt className="kicker">Code against the build</dt>
                    <dd className="mt-1 leading-relaxed text-(--color-paper-dim)">
                      {code === null || code.storeFault !== null ? (
                        <span style={{ color: 'var(--color-state-stale)' }}>not readable{code?.storeFault ? ` — ${code.storeFault}` : ''}</span>
                      ) : code.code === null ? (
                        'not yet verified — no tick has read the desk'
                      ) : codeCurrent ? (
                        <>
                          <span className="text-(--color-paper)">MATCHES</span> the build at commit <span className="tabular">{code.code.buildCommit?.slice(0, 10)}</span>; the immutables hold the token and the treasury above · read {code.code.readAt}
                        </>
                      ) : code.code.state === 'MATCHES' ? (
                        <span style={{ color: 'var(--color-state-stale)' }}>A previous read matched at {code.code.readAt}; it is older than 30 minutes or does not establish the token and treasury now configured. Wait for a new verification.</span>
                      ) : (
                        <span style={{ color: code.code.state === 'MISMATCH' ? 'var(--color-state-dark)' : 'var(--color-state-stale)' }}>
                          {code.code.state}{code.code.detail ? ` — ${code.code.detail}` : ''} · read {code.code.readAt}
                        </span>
                      )}
                    </dd>
                  </div>
                </dl>
              )}

              <div className="kicker mt-8">
                <b>Receipts</b> · what the desk has taken in, as credited
              </div>
              {paid.storeFault !== null ? (
                <p className="mt-3 text-sm" style={{ color: 'var(--color-state-stale)' }}>
                  The receipts could not be read: {paid.storeFault}.
                </p>
              ) : paid.topUps === 0 ? (
                <p className="mt-3 text-sm leading-relaxed text-(--color-paper-faint)">
                  No top-up has been credited.{' '}
                  {!configured
                    ? 'There is no desk configured here to pay.'
                    : paid.waitingForRate !== null && paid.waitingForRate > 0
                      ? `${paid.waitingForRate} top-up${paid.waitingForRate === 1 ? ' is' : 's are'} read from the chain and waiting for a rate${paid.cursor !== null ? ` · indexed to block ${paid.cursor}` : ''}.`
                      : paid.pendingState === 'READ' ? `No top-up is waiting for a rate in the index read to block ${paid.cursor}.` : ''}
                </p>
              ) : (
                <dl className="mt-4 space-y-3 text-[12px]">
                  <div>
                    <dt className="kicker">Top-ups · keys</dt>
                    <dd className="tabular mt-1 text-(--color-paper)">
                      {paid.topUps} · {paid.keys}
                    </dd>
                  </div>
                  <div>
                    <dt className="kicker">CURB received · credited</dt>
                    <dd className="tabular mt-1 text-(--color-paper)">
                      {decimals === null ? `${paid.curbBaseUnits} base units` : `${curbText(BigInt(paid.curbBaseUnits), decimals)} CURB`} · {centsText(BigInt(paid.cents))}
                    </dd>
                  </div>
                  <div>
                    <dt className="kicker">Priced at own block · at head when indexed</dt>
                    <dd className="tabular mt-1 text-(--color-paper-dim)">
                      {paid.pricedAtOwnBlock} · {paid.pricedAtHead}
                    </dd>
                  </div>
                  <div>
                    <dt className="kicker">Last top-up block · indexed to · waiting for a rate</dt>
                    <dd className="tabular mt-1 text-(--color-paper-dim)">
                      {paid.lastBlock ?? '—'} · {paid.cursor ?? '—'} · {paid.waitingForRate ?? 'not read'}
                    </dd>
                  </div>
                </dl>
              )}
              {paid.pendingState !== 'READ' ? (
                <p className="mt-3 text-[12px]" style={{ color: 'var(--color-state-stale)' }}>
                  {paid.pendingState === 'UNREAD' ? `The pending top-up index could not be read (${paid.pendingFault}).` : 'No pending top-up index has been recorded yet.'} The number waiting for a rate is unknown; credited receipts above are a separate reading.
                </p>
              ) : null}
              <p className="mt-4 text-[12px] leading-relaxed text-(--color-paper-faint)">Derived from the keys&rsquo; rows on every request, never a second record.</p>
            </div>
          </section>

          <h3 className="display mt-8 text-xl text-(--color-paper) sm:text-2xl">{C.machinery.keyTitle}</h3>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-(--color-paper-dim)">
            {C.machinery.keyLede} <span className="tabular">topUp(bytes32 keyHash, uint256 amount)</span>
          </p>
          <div className="mt-4">
            <CreditDesk
              configured={status.state === 'CONFIGURED'}
              desk={status.state === 'CONFIGURED' ? status.config.desk : null}
              network={status.state === 'CONFIGURED' ? status.config.network.label : null}
              decimals={decimals}
              topUpHeld={readiness.topUpHeld}
            />
          </div>
          {status.state === 'CONFIGURED' ? (
            <p className="mt-4 text-[12px] leading-relaxed text-(--color-paper-faint)">
              {status.config.priceSource === null
                ? `A desk is configured on ${status.config.network.label} and no pool is recorded yet: top-ups are indexed and wait, unpriced, for one. While the token trades only on its launch curve, the desk does not read that curve and quotes nothing; a top-up sent now is credited at the pool's price at the first successful read after the pool is recorded — which may be far from the curve's price — and if no pool ever exists the CURB sits at the treasury and the credit never prices.`
                : `A desk and a pool are configured on ${status.config.network.label}; what the sections above show is what was read from them.`}
            </p>
          ) : null}
        </div>
      </details>
    </main>
  );
}
