/**
 * THE TALLY — on-chain flow, measured as a rate over a stated sample.
 *
 * The figure that ruins a story is transfers against distinct addresses. Two
 * hundred transfers among three wallets is not distribution, and a count on its
 * own cannot tell the two apart — which is why both are reported side by side
 * and neither is reported alone.
 *
 * Why a sample and not a total: this chain moves at hundreds of transfers a
 * second and the public node refuses any query matching more than ten thousand
 * logs, so an hour of flow is not readable from here by any paging. What is
 * readable is a short window — about a minute of chain time — read in one
 * query per group and split when the node says it matched too much. Every
 * count is stated as what it is: a rate within that sample, never a total for
 * the hour, never extrapolated. Over a day the samples become a series.
 *
 * What this agent will not do is imply it has measured holder concentration.
 * Concentration is a property of the whole history; a sample of recent blocks
 * cannot establish it, and a "top holders" table built from a sample would be
 * confidently wrong. It is declared as needing an indexer this system does not
 * have, rather than approximated.
 */

import type { Producer, ProducerResult } from '../runtime.ts';
import { figuresIn, type DeclaredFigure } from '../../doctrine/policy.ts';
import type { ObservationRecord } from '../../store/types.ts';
import { isRead } from '../../doctrine/reading.ts';
import { activeNetwork } from '../../chain/networks.ts';
import { readBlockNumber, rpcCall } from '../../chain/rpc.ts';
import { readLogWindow, LOG_RESULT_CAP, type LogWindow } from '../../chain/logs.ts';
import { decodeAddressWord, decodeUint, formatUnits } from '../../chain/abi.ts';
import { keccak256Hex } from '../../chain/keccak.ts';
import { TOKENS } from '../../chain/tokens.ts';
import { STOCK_TOKENS } from '../../chain/stock-tokens.ts';

const INTERVAL = 3600;

/** Derived, not pinned: keccak256('Transfer(address,address,uint256)'). */
const TRANSFER_TOPIC = keccak256Hex('Transfer(address,address,uint256)');

/**
 * The sample, in blocks. About fifty seconds of chain time at the rate
 * measured when this was sized (0.10 s per block) — wide enough to hold a
 * rate, narrow enough that the node answers it in one or two pages.
 */
export const SAMPLE_BLOCKS = 500;

/** How many of the most active stock tokens to name. The rest are a count. */
const NAMED = 5;

/** Concentration questions a sample cannot answer. */
const NEEDS_FULL_HISTORY = [
  'Holder concentration. The share held by the largest accounts is a property of the entire history of a token, not of a sample of recent blocks. A ranking built from this sample would look authoritative and be wrong.',
  'Whether an address is one holder or many. One custodian address can stand for thousands of people, and one person can hold across many addresses. Nothing on chain distinguishes them.',
  'Whether a transfer was a sale. A transfer moves units between addresses; it does not record a price, a counterparty agreement, or an intention.',
  'The total for the hour. The node will not answer a query that matches more than ten thousand logs, and an hour of this chain is far past that. The sample is a rate, and a rate is not a total.',
] as const;

export interface Subject {
  readonly key: string;
  readonly symbol: string;
  readonly address: string;
  readonly decimals: number;
}

/** What one token did in the sample. Pure arithmetic over its logs. */
export interface Flow {
  readonly subject: Subject;
  readonly transfers: number;
  readonly senders: number;
  readonly receivers: number;
  readonly minted: bigint;
  readonly burned: bigint;
  readonly largest: bigint;
}

export function tallyFlows(subjects: readonly Subject[], window: LogWindow): Flow[] {
  const acc = new Map<string, { transfers: number; senders: Set<string>; receivers: Set<string>; minted: bigint; burned: bigint; largest: bigint }>();
  for (const s of subjects) acc.set(s.address.toLowerCase(), { transfers: 0, senders: new Set(), receivers: new Set(), minted: 0n, burned: 0n, largest: 0n });

  for (const entry of window.logs) {
    const bucket = acc.get(entry.address.toLowerCase());
    if (!bucket) continue;
    const from = entry.topics[1] ? decodeAddressWord(entry.topics[1]) : null;
    const to = entry.topics[2] ? decodeAddressWord(entry.topics[2]) : null;
    const amount = decodeUint(entry.data) ?? 0n;
    bucket.transfers += 1;
    if (from === null) bucket.minted += amount;
    else bucket.senders.add(from.toLowerCase());
    if (to === null) bucket.burned += amount;
    else bucket.receivers.add(to.toLowerCase());
    if (amount > bucket.largest) bucket.largest = amount;
  }

  return subjects.map((subject) => {
    const b = acc.get(subject.address.toLowerCase())!;
    return { subject, transfers: b.transfers, senders: b.senders.size, receivers: b.receivers.size, minted: b.minted, burned: b.burned, largest: b.largest };
  });
}

/** Transfers per minute within a sample of `spanSeconds`, one decimal. */
export function perMinute(transfers: number, spanSeconds: number): string {
  return spanSeconds > 0 ? ((transfers * 60) / spanSeconds).toFixed(1) : '0.0';
}

export const tallyProducer: Producer = async (): Promise<ProducerResult> => {
  const network = activeNetwork();
  const opts = { intervalSeconds: INTERVAL, timeoutMs: 60_000 };

  const head = await readBlockNumber(opts);
  if (!isRead(head)) {
    return { publication: null, sourcesReached: 0, oldestInputAt: null, note: `the chain head could not be read (${head.reason}), so no sample could be defined` };
  }
  const toBlock = head.value;
  const fromBlock = Math.max(0, toBlock - SAMPLE_BLOCKS + 1);

  // The sample's span in time is read from the chain, not assumed from a rate.
  const [first, last] = await Promise.all([
    rpcCall<{ timestamp: string }>('eth_getBlockByNumber', [`0x${fromBlock.toString(16)}`, false], opts),
    rpcCall<{ timestamp: string }>('eth_getBlockByNumber', [`0x${toBlock.toString(16)}`, false], opts),
  ]);
  const spanSeconds = isRead(first) && isRead(last) ? Number(last.value.timestamp) - Number(first.value.timestamp) : null;

  const settlement: Subject[] = TOKENS.map((t) => ({ key: t.key, symbol: t.observedSymbol, address: t.address, decimals: t.observedDecimals }));
  const stock: Subject[] = STOCK_TOKENS.map((t) => ({ key: t.key, symbol: t.ticker, address: t.address, decimals: t.decimals }));

  // Two groups, two queries over the same sample: a refusal on one leaves the
  // other standing, and the two are different stories anyway.
  const settlementWindow = await readLogWindow(settlement.map((s) => s.address), [TRANSFER_TOPIC], fromBlock, toBlock, opts);
  const stockWindow = await readLogWindow(stock.map((s) => s.address), [TRANSFER_TOPIC], fromBlock, toBlock, opts);

  const figures: DeclaredFigure[] = [];
  const literals = new Set<string>();
  const literal = (n: number) => {
    literals.add(String(n));
    return String(n);
  };
  const observations: ObservationRecord[] = [];
  const measured: string[] = [];
  const notRead: string[] = [];
  let sourcesReached = 0;
  const retrievedAt = settlementWindow.retrievedAt ?? stockWindow.retrievedAt ?? head.retrievedAt;
  const oldestInputAt = new Date(retrievedAt);
  const declare = (token: string, source: string) => figures.push({ token, source, retrievedAt });

  const sampleBlocks = String(SAMPLE_BLOCKS);
  literals.add(sampleBlocks);
  declare(toBlock.toLocaleString('en-US'), `${network.label} · eth_blockNumber`);
  if (spanSeconds !== null) declare(String(spanSeconds), `${network.label} · eth_getBlockByNumber timestamps`);
  const spanText = spanSeconds === null ? 'an unread span of chain time' : `${spanSeconds} seconds of chain time`;

  const describeGaps = (label: string, window: LogWindow) => {
    for (const u of window.unread) {
      notRead.push(`— ${label}, blocks ${u.fromBlock.toLocaleString('en-US')} to ${u.toBlock.toLocaleString('en-US')}: not answered (${u.reason}). Counts for this group exclude them; that is a gap, not a quiet stretch.`);
      declare(u.fromBlock.toLocaleString('en-US'), `${network.label} · eth_getLogs`);
      declare(u.toBlock.toLocaleString('en-US'), `${network.label} · eth_getLogs`);
    }
    for (const c of window.capped) {
      notRead.push(`— ${label}, blocks ${c.fromBlock.toLocaleString('en-US')} to ${c.toBlock.toLocaleString('en-US')}: the node returned its maximum of ${LOG_RESULT_CAP.toLocaleString('en-US')} logs, so counts covering them are floors.`);
      declare(c.fromBlock.toLocaleString('en-US'), `${network.label} · eth_getLogs`);
      declare(c.toBlock.toLocaleString('en-US'), `${network.label} · eth_getLogs`);
    }
  };
  const partial = (window: LogWindow) => (window.unread.length > 0 || window.capped.length > 0 ? 'at least ' : '');

  // ── settlement assets, one line each ────────────────────────────────────
  describeGaps('Settlement assets', settlementWindow);
  if (settlementWindow.pagesRead === 0) {
    notRead.push('— Settlement assets: no page of the sample was answered, so nothing is said about them.');
  } else {
    for (const flow of tallyFlows(settlement, settlementWindow)) {
      sourcesReached += 1;
      const src = `${network.label} · ${flow.subject.symbol} Transfer logs`;
      const rate = spanSeconds === null ? null : perMinute(flow.transfers, spanSeconds);
      if (rate !== null) observations.push({ key: `${flow.subject.key}:transfers-per-minute`, observedAt: retrievedAt, value: Number(rate), source: src });
      if (flow.transfers === 0) {
        measured.push(`— ${flow.subject.symbol}: no transfers in the sample. The sample was read, so this is a measured zero rather than an absence.`);
        continue;
      }
      const transfers = String(flow.transfers);
      const senders = String(flow.senders);
      const receivers = String(flow.receivers);
      const largest = formatUnits(flow.largest, flow.subject.decimals);
      [transfers, senders, receivers, largest].forEach((v) => declare(v, src));
      if (rate !== null) declare(rate, `${src} · per minute, computed by code over the sample`);
      let line = `— ${flow.subject.symbol}: ${partial(settlementWindow)}${transfers} transfers in the sample${rate === null ? '' : `, ${rate} a minute`}, among ${senders} sending and ${receivers} receiving addresses — the second pair is what separates distribution from churn. The largest single transfer was ${largest}.`;
      if (flow.minted > 0n || flow.burned > 0n) {
        const minted = formatUnits(flow.minted, flow.subject.decimals);
        const burned = formatUnits(flow.burned, flow.subject.decimals);
        declare(minted, src);
        declare(burned, src);
        line += ` Units entered supply from the zero address totalling ${minted}, and units sent to it totalling ${burned}.`;
      }
      measured.push(line);
    }
  }

  // ── stock tokens, as a book ──────────────────────────────────────────────
  describeGaps('Stock tokens', stockWindow);
  if (stockWindow.pagesRead === 0) {
    notRead.push('— Stock tokens: no page of the sample was answered, so nothing is said about them.');
  } else {
    sourcesReached += 1;
    const flows = tallyFlows(stock, stockWindow);
    const active = flows.filter((f) => f.transfers > 0).sort((a, b) => b.transfers - a.transfers);
    const total = active.reduce((n, f) => n + f.transfers, 0);
    const stockSource = `${network.label} · stock-token Transfer logs`;
    for (const f of active) {
      if (spanSeconds !== null) observations.push({ key: `${f.subject.key}:transfers-per-minute`, observedAt: retrievedAt, value: Number(perMinute(f.transfers, spanSeconds)), source: `${network.label} · ${f.subject.symbol} Transfer logs` });
    }
    if (spanSeconds !== null) observations.push({ key: 'stock-tokens:transfers-per-minute', observedAt: retrievedAt, value: Number(perMinute(total, spanSeconds)), source: stockSource });

    if (active.length === 0) {
      measured.push(`— Stock tokens: none of the ${literal(stock.length)} tokens in the issuer's registry moved in the sample. The sample was read; these are measured zeros.`);
    } else {
      declare(String(total), stockSource);
      const rate = spanSeconds === null ? null : perMinute(total, spanSeconds);
      if (rate !== null) declare(rate, `${stockSource} · per minute, computed by code over the sample`);
      const named = active.slice(0, NAMED).map((f) => {
        const src = `${network.label} · ${f.subject.symbol} Transfer logs`;
        declare(String(f.transfers), src);
        declare(String(f.senders), src);
        declare(String(f.receivers), src);
        return `${f.subject.symbol} ${f.transfers} (${f.senders} sending, ${f.receivers} receiving)`;
      });
      measured.push(
        `— Stock tokens: ${partial(stockWindow)}${total} transfers in the sample${rate === null ? '' : `, ${rate} a minute`}, across ${literal(active.length)} of the ${literal(stock.length)} tokens in the issuer's registry; ${literal(stock.length - active.length)} did not move. Most active: ${named.join(', ')}.`,
      );
      const minted = active.filter((f) => f.minted > 0n);
      const burned = active.filter((f) => f.burned > 0n);
      if (minted.length > 0 || burned.length > 0) {
        measured.push(
          `— Units entered supply on ${literal(minted.length)} stock tokens and left it on ${literal(burned.length)} within the sample: ${[...new Set([...minted, ...burned].map((f) => f.subject.symbol))].join(', ')}. The chain records the movement; it does not record who asked for it or why.`,
        );
      }
    }
  }

  // A failure line carries whatever the source said, and what a source says can
  // hold a number: "HTTP 429", "exceeds limit of 10000". Printing it undeclared
  // blocks the whole filing. Those numbers came from that source, at this run;
  // they are declared as such, and the gate agrees.
  for (const line of notRead) figures.push(...figuresIn(line, `${network.label} · as reported in a refusal`, retrievedAt));

  const note = notRead.length > 0 ? notRead.join(' ').slice(0, 400) : undefined;
  if (sourcesReached === 0) {
    return { publication: null, sourcesReached, oldestInputAt, observations, note };
  }

  const body = [
    `MEASURED · a sample of ${sampleBlocks} blocks, ${spanText}, ending at block ${toBlock.toLocaleString('en-US')}`,
    ...measured,
    '',
    'NOT READ',
    ...(notRead.length > 0 ? notRead : ['— Every page of the sample was answered in full.']),
    '',
    'NOT ESTABLISHED BY A SAMPLE',
    ...NEEDS_FULL_HISTORY.map((line) => `— ${line}`),
    '— Every count above describes this sample only. A quiet sample is not a quiet token, and nothing here is a statement about whether any figure is high or low.',
  ].join('\n');

  literals.add(String(TOKENS.length + STOCK_TOKENS.length));

  return {
    publication: {
      headline: `FLOW · ${TOKENS.length + STOCK_TOKENS.length} tokens · ${sampleBlocks}-block sample${notRead.length > 0 ? ' · gaps' : ''}`,
      body,
      figures,
      allowedLiterals: [LOG_RESULT_CAP.toLocaleString('en-US'), ...literals],
    },
    sourcesReached,
    oldestInputAt,
    observations,
    note,
  };
};
