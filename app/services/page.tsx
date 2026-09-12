import Link from 'next/link';
import { latestDeskCode } from '@/lib/credits/code';
import { creditsStatus } from '@/lib/credits/config';
import { latestRate } from '@/lib/credits/maintenance';
import { receipts } from '@/lib/credits/receipts';
import { MINIMUM_DECISION, MINIMUM_OPEN_CENTS, NOTICE_DAYS, PRICES_DECISION, PRICES_STATUS, SERVICES, TERMS_DECISION, centsText } from '@/lib/credits/prices';
import { curbForCents, curbText, usd18Text } from '@/lib/credits/rate';
import { explorerAddress } from '@/lib/chain/networks';
import { getStoreAsync } from '@/lib/store';
import { CreditDesk } from '../components/credit-desk';

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
export const metadata = { title: 'Services and the credit desk' };

/**
 * The services page: the price list in dollars, the rate a dollar is in
 * CURB as last read — with its block, or the reason there is none — the
 * key and the top-up, and what the token does not do. Every figure that
 * depends on a rate says where the rate came from. Nothing here is a
 * condition of the position product.
 */
export default async function ServicesPage() {
  const status = creditsStatus();
  const store = await getStoreAsync();
  const configured = status.state === 'CONFIGURED';
  const [rate, code, paid] = await Promise.all([configured ? latestRate(store) : null, configured ? latestDeskCode(store) : null, receipts(store)]);
  const minimumCurb = rate?.state === 'READ' ? curbForCents(rate.rate, BigInt(MINIMUM_OPEN_CENTS)) : null;
  const decimals = rate?.state === 'READ' ? rate.rate.token.decimals : null;
  const link = (address: string) => (status.state === 'CONFIGURED' ? explorerAddress(status.config.network, address) : null);

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 sm:py-16">
      <header className="mb-8">
        <div className="kicker">
          <b>Services</b> · the credit desk · <Link href="/mechanism/decisions/token" className="hover:text-(--color-paper)">the token record</Link> · decided by {TERMS_DECISION.by}, {TERMS_DECISION.on}
        </div>
        <h1 className="display mt-4 max-w-3xl text-4xl text-(--color-paper) sm:text-5xl">Prices in dollars. Payment in CURB, at whatever a CURB is when the payment is mined.</h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-(--color-paper-dim)">
          A CURB paid to the credit desk is a prepaid unit of a service that exists today, and nothing else. The desk reads the token&rsquo;s price from a pool at a block, states the market capitalisation that price implies, and credits a key in dollars at the rate at the block its top-up was mined. Nothing here is a condition of forming, holding or claiming a position.
        </p>
      </header>

      <section className="cells grid-cols-1 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="cell p-6 sm:p-8">
          <div className="kicker">
            <b>The price list</b> · US dollars · {PRICES_STATUS} by {PRICES_DECISION.by}, {PRICES_DECISION.on} · {NOTICE_DAYS} days&rsquo; notice of any change
          </div>
          <table className="mt-4 w-full text-[13px]">
            <tbody>
              <tr className="border-t border-(--color-rule) align-top">
                <td className="py-3 pr-4 text-(--color-paper)">Opening a key</td>
                <td className="py-3 pr-4 text-(--color-paper-dim)">
                  The minimum credited, cumulatively across top-ups, before a key can be used. <span className="text-(--color-paper-faint)">Decided by {MINIMUM_DECISION.by}, {MINIMUM_DECISION.on}.</span>
                </td>
                <td className="tabular py-3 text-right whitespace-nowrap text-(--color-paper)">{centsText(MINIMUM_OPEN_CENTS)}</td>
              </tr>
              {SERVICES.map((s) => (
                <tr key={s.id} className="border-t border-(--color-rule) align-top">
                  <td className="py-3 pr-4 text-(--color-paper)">{s.title}</td>
                  <td className="py-3 pr-4 text-(--color-paper-dim)">
                    {s.what}. <span className="tabular text-(--color-paper-faint)">{s.path}</span>
                  </td>
                  <td className="tabular py-3 text-right whitespace-nowrap text-(--color-paper)">
                    {centsText(s.cents)} <span className="text-(--color-paper-faint)">/ {s.unit}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-4 text-[12px] leading-relaxed text-(--color-paper-faint)">
            Everything the site shows today stays free: the series pages, the latest evidence, the instrument file, the previews, the wallet lookups, the status endpoint and the Gazette. The paid endpoints are the history and the fan-out. A call is charged only when it is answered; a call that is refused is not charged. The terms, decided with the prices: credits do not expire while the service they buy is offered; a service closes with {NOTICE_DAYS} days&rsquo; notice here and in the journal; nothing is refunded in dollars or in CURB, because the contract has no refund path and the desk offers none.
          </p>
        </div>

        <div className="cell p-6 sm:p-8">
          <div className="kicker">
            <b>The rate</b> · read from the chain · never typed in
          </div>
          {status.state !== 'CONFIGURED' ? (
            <>
              <p className="mt-3 text-sm leading-relaxed text-(--color-paper)">No rate. {status.state === 'CONFIG_INVALID' ? `The record is invalid: ${status.detail}` : 'No token exists, no desk is deployed and no pool is read.'}</p>
              <p className="mt-3 text-[12px] leading-relaxed text-(--color-paper-faint)">
                The price list stays in dollars and no CURB amount is quoted until the token trades in a pool the desk&rsquo;s chain profile can read. The desk will not type a price in by hand: a rate that was not read from the chain is not a rate the desk states.
              </p>
            </>
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
                <dt className="kicker">One CURB</dt>
                <dd className="tabular mt-1 text-(--color-paper)">{usd18Text(rate.rate.usdPerCurb18, 8)}</dd>
              </div>
              <div>
                <dt className="kicker">Market capitalisation · price × supply</dt>
                <dd className="tabular mt-1 text-(--color-paper)">
                  {usd18Text(rate.rate.marketCapUsd18, 2)} <span className="text-(--color-paper-faint)">· supply {curbText(BigInt(rate.rate.token.supply), rate.rate.token.decimals, 0)} CURB</span>
                </dd>
              </div>
              <div>
                <dt className="kicker">{centsText(MINIMUM_OPEN_CENTS)} · the opening minimum</dt>
                <dd className="tabular mt-1 text-(--color-paper)">{minimumCurb === null ? '—' : `${curbText(minimumCurb, rate.rate.token.decimals)} CURB`}</dd>
              </div>
              <div>
                <dt className="kicker">Read</dt>
                <dd className="tabular mt-1 text-[12px] text-(--color-paper-dim)">
                  block {rate.rate.block} · {rate.at} · {rate.rate.pool.kind === 'uniswap-v2-pair' ? 'pair' : 'v3 pool'} <Addr address={rate.rate.pool.address} href={link(rate.rate.pool.address)} /> on {status.config.network.label} · quote <Addr address={rate.rate.pool.quoteAddress} href={link(rate.rate.pool.quoteAddress)} /> {rate.rate.quote.kind === 'usd-stable' ? 'taken as US dollars' : `priced by feed ${rate.rate.quote.feed}`}
                  {rate.rate.basis === 'EVENTS' ? ` · from the pool's event at block ${rate.rate.pool.eventBlock}` : ''}
                </dd>
              </div>
              <div>
                <dt className="kicker">The rule</dt>
                <dd className="mt-1 text-[12px] leading-relaxed text-(--color-paper-faint)">
                  The price is the pool&rsquo;s own at the block — the ratio of a pair&rsquo;s reserves, or a v3 pool&rsquo;s square-root price; the capitalisation is that price times <span className="tabular">totalSupply()</span>, so CURB for a dollar figure is the figure times supply over capitalisation. A top-up is credited at the rate at the block it was mined: by state while the node still serves that block, else from the pool&rsquo;s own last event at or before it; only if neither can be had is the head when indexed used — and the credit says which.
                </dd>
              </div>
            </dl>
          )}
        </div>
      </section>

      <section className="mt-10 cells grid-cols-1 md:grid-cols-2">
        <div className="cell p-6 sm:p-8">
          <div className="kicker">
            <b>The desk and the treasury</b> · code verified every tick
          </div>
          {status.state !== 'CONFIGURED' ? (
            <p className="mt-3 text-sm leading-relaxed text-(--color-paper-faint)">No desk is deployed and no treasury is named. When one is, this block shows the desk&rsquo;s address, the treasury every top-up goes to, and whether the code on chain is the contract in this repository paying to that treasury.</p>
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
                  ) : code.code.state === 'MATCHES' ? (
                    <>
                      <span className="text-(--color-paper)">MATCHES</span> the build at commit <span className="tabular">{code.code.buildCommit?.slice(0, 10)}</span>; the immutables hold the token and the treasury above · read {code.code.readAt}
                    </>
                  ) : (
                    <span style={{ color: code.code.state === 'MISMATCH' ? 'var(--color-state-dark)' : 'var(--color-state-stale)' }}>
                      {code.code.state}{code.code.detail ? ` — ${code.code.detail}` : ''} · read {code.code.readAt}
                    </span>
                  )}
                </dd>
              </div>
            </dl>
          )}
        </div>
        <div className="cell p-6 sm:p-8">
          <div className="kicker">
            <b>Receipts</b> · what the desk has taken in, as credited
          </div>
          {paid.storeFault !== null ? (
            <p className="mt-3 text-sm" style={{ color: 'var(--color-state-stale)' }}>
              The receipts could not be read: {paid.storeFault}.
            </p>
          ) : paid.topUps === 0 ? (
            <p className="mt-3 text-sm leading-relaxed text-(--color-paper-faint)">No top-up has been credited. {configured ? 'The indexer reads the desk every fifteen minutes.' : 'There is no desk to pay.'}</p>
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
                  {paid.lastBlock ?? '—'} · {paid.cursor ?? '—'} · {paid.waitingForRate}
                </dd>
              </div>
            </dl>
          )}
          <p className="mt-4 text-[12px] leading-relaxed text-(--color-paper-faint)">Derived from the keys&rsquo; rows on every request; never a second record. The budget for what is received is in the token record, and the spending of it is logged under the operator policy.</p>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="display text-2xl text-(--color-paper) sm:text-3xl">A key, a quote, a top-up, a balance.</h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-(--color-paper-dim)">
          The key is made in this browser and never sent to make it; the desk learns of its hash when the chain credits it. The top-up is one call, <span className="tabular">topUp(bytes32 keyHash, uint256 amount)</span>, signed in a wallet of the payer&rsquo;s own; the site holds no key and sends nothing. The balance is public by hash.
        </p>
        <div className="mt-6">
          <CreditDesk
            configured={status.state === 'CONFIGURED'}
            desk={status.state === 'CONFIGURED' ? status.config.desk : null}
            network={status.state === 'CONFIGURED' ? status.config.network.label : null}
            decimals={decimals}
          />
        </div>
      </section>

      <section className="mt-10 cells grid-cols-1 md:grid-cols-2">
        <div className="cell p-6 sm:p-8">
          <div className="kicker">
            <b>The order of work</b> · as the site can see it · nothing typed in
          </div>
          <ol className="mt-3 space-y-2 text-[13px] leading-relaxed">
            {[
              ['The services and the gate exist', 'done', 'this page, the paid endpoints, the indexer, the rate reader — rehearsed on a local chain'],
              ['The credit desk contract is reviewed', 'not done', 'a self-review is filed; no independent reviewer has reported (the register\u2019s A2)'],
              [
                'The token exists and the desk is deployed on Robinhood Chain',
                status.state === 'CONFIGURED' ? (code?.code?.state === 'MATCHES' ? 'done' : 'configured, code not yet verified') : 'not done',
                status.state === 'CONFIGURED' ? `desk ${status.config.desk} on ${status.config.network.label}` : 'no token exists; nothing is configured',
              ],
              [
                'The pool is recorded and the rate is read',
                status.state !== 'CONFIGURED' ? 'not done' : rate?.state === 'READ' ? 'done' : 'configured, no rate read yet',
                status.state !== 'CONFIGURED' ? 'no pool exists' : rate?.state === 'READ' ? `block ${rate.rate.block}, ${rate.rate.pool.kind}` : 'the pool has not answered with a price',
              ],
              ['The interviews run', 'not done', 'the guide is ready; nobody has been interviewed (the register\u2019s A5)'],
            ].map(([step, state, detail], i) => (
              <li key={step} className="flex gap-3">
                <span className="tabular text-(--color-accent)">{String(i + 1).padStart(2, '0')}</span>
                <span>
                  <span className="text-(--color-paper)">{step}</span> <span className={state === 'done' ? 'text-(--color-paper)' : 'text-(--color-paper-faint)'}>· {state}</span>
                  <span className="block text-[12px] text-(--color-paper-faint)">{detail}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <div className="cell p-6 sm:p-8">
          <div className="kicker">
            <b>What the token does not do</b>
          </div>
          <ul className="mt-3 space-y-2 text-[13px] leading-relaxed text-(--color-paper-dim)">
            <li>It is not a condition of forming, holding or claiming a position. Positions never depend on a CURB price or a bridge.</li>
            <li>It is not a claim on the components any series holds, on the treasury, on fees or on revenue. No fee sharing, no buyback and no burn is proposed.</li>
            <li>It is not a loss guarantor for any series, holder or issuer failure.</li>
            <li>Its price is not a fact about the position product; the site never adds the two.</li>
            <li>It is not capital protected, cannot-be-frozen, the same as holding anything, automatically safer, always sellable at a reference value, higher-earning, a sign of independent issuers, or first of its kind — the eight claims the desk refuses for the position, refused for the token.</li>
            <li>It gives the desk no admin key over anything: the credit desk contract has no owner, no pause, no upgrade and holds no balance.</li>
          </ul>
        </div>
        <div className="cell p-6 sm:p-8 md:col-span-2">
          <div className="kicker">
            <b>The order of work, decided, and what exists</b>
          </div>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-[13px] leading-relaxed text-(--color-paper-dim)">
            <li>The services, the key store, the top-up indexer and the price reader exist first — this page, <span className="tabular">/api/credits</span>, the paid endpoints, <span className="tabular">contracts/src/CreditDesk.sol</span> with its tests — rehearsed on a local chain with a mock token and a mock pool.</li>
            <li>The credit desk contract is reviewed with the series contract.</li>
            <li>The token launches; its address, decimals and supply are read from the chain; the desk is deployed pointing at the token and the operator multisig; the pool is recorded when it exists. Until then this page says NOT CONFIGURED.</li>
            <li>If a launch raises anything, the budget is published first: the independent review, the legal read, infrastructure, a logged reserve. The split is in <Link href="/mechanism/decisions/token" className="underline decoration-(--color-accent) underline-offset-4 hover:text-(--color-paper)">the record</Link>.</li>
          </ol>
          <p className="mt-4 text-[12px] leading-relaxed text-(--color-paper-faint)">
            No token exists. No pool exists. Nothing is configured. A launchpad&rsquo;s terms are not assumed here. The <Link href="/mechanism/decisions/assumptions" className="underline decoration-(--color-accent) underline-offset-4 hover:text-(--color-paper)">assumption register</Link> says what is assumed meanwhile, and none of it is stated as fact on this page.
          </p>
        </div>
      </section>
    </main>
  );
}
