/**
 * THE TALLY — on-chain flow, over a stated block window.
 *
 * The figure that ruins a story is transfers against distinct addresses. Two
 * hundred transfers among three wallets is not distribution, and a count on its
 * own cannot tell the two apart — which is why both are reported side by side
 * and neither is reported alone.
 *
 * What this agent will not do is imply it has measured holder concentration.
 * Concentration is a property of the whole history; a window of recent blocks
 * cannot establish it, and a "top holders" table built from a window would be
 * confidently wrong. It is declared as needing an indexer this system does not
 * have, rather than approximated.
 */

import type { Producer, ProducerResult } from '../runtime.ts';
import type { DeclaredFigure } from '../../doctrine/policy.ts';
import { isRead } from '../../doctrine/reading.ts';
import { activeNetwork } from '../../chain/networks.ts';
import { readBlockNumber, readLogs } from '../../chain/rpc.ts';
import { decodeAddressWord, decodeUint, formatUnits } from '../../chain/abi.ts';
import { keccak256Hex } from '../../chain/keccak.ts';
import { readTokenUint } from '../../chain/token-read.ts';
import { TOKENS } from '../../chain/tokens.ts';

const INTERVAL = 6 * 3600;

/** Derived, not pinned: keccak256('Transfer(address,address,uint256)'). */
const TRANSFER_TOPIC = keccak256Hex('Transfer(address,address,uint256)');

/**
 * How far back to look. Stated in every report, because the window is the whole
 * context for every count below it.
 *
 * Kept well under the node's result cap on purpose. A wider window is not a
 * richer report — it is a query the node either refuses outright or, worse,
 * silently truncates, which would turn a count into an undercount that looks
 * exactly like a count.
 */
const WINDOW_BLOCKS = 500;

/**
 * The node returns at most this many logs for one query and says so when it
 * refuses. A result at or above the cap cannot be trusted as a total: it is a
 * floor, and it is reported as one.
 */
const LOG_RESULT_CAP = 10_000;

/** Concentration questions a block window cannot answer. */
const NEEDS_FULL_HISTORY = [
  'Holder concentration. The share held by the largest accounts is a property of the entire history of a token, not of a window of recent blocks. A ranking built from this window would look authoritative and be wrong.',
  'Whether an address is one holder or many. One custodian address can stand for thousands of people, and one person can hold across many addresses. Nothing on chain distinguishes them.',
  'Whether a transfer was a sale. A transfer moves units between addresses; it does not record a price, a counterparty agreement, or an intention.',
] as const;

export const tallyProducer: Producer = async (): Promise<ProducerResult> => {
  const network = activeNetwork();
  const opts = { intervalSeconds: INTERVAL, timeoutMs: 30_000 };

  const head = await readBlockNumber(opts);
  if (!isRead(head)) {
    return {
      publication: null,
      sourcesReached: 0,
      oldestInputAt: null,
      note: `the chain head could not be read (${head.reason}), so no window could be defined`,
    };
  }

  const toBlock = head.value;
  const fromBlock = Math.max(0, toBlock - WINDOW_BLOCKS);

  const figures: DeclaredFigure[] = [];
  const measured: string[] = [];
  const notRead: string[] = [];
  let sourcesReached = 0;
  let oldestInputAt: Date | null = new Date(head.retrievedAt);

  const windowFigure = WINDOW_BLOCKS.toLocaleString('en-US');
  figures.push({
    token: windowFigure,
    source: `${network.label} · eth_blockNumber`,
    retrievedAt: head.retrievedAt,
  });
  figures.push({
    token: toBlock.toLocaleString('en-US'),
    source: `${network.label} · eth_blockNumber`,
    retrievedAt: head.retrievedAt,
  });

  for (const token of TOKENS) {
    const [logs, decimals] = await Promise.all([
      readLogs(token.address, [TRANSFER_TOPIC], fromBlock, toBlock, opts),
      readTokenUint(token.address, 'decimals', opts),
    ]);

    if (!isRead(logs)) {
      // A node that refused the range is not a token with no transfers.
      notRead.push(
        `— ${token.observedSymbol}: transfers could not be read (${logs.reason}${logs.detail ? `, ${logs.detail}` : ''}). This is not a count of zero.`,
      );
      continue;
    }
    sourcesReached += 1;
    const at = new Date(logs.retrievedAt);
    if (at < oldestInputAt) oldestInputAt = at;

    const entries = logs.value;
    const senders = new Set<string>();
    const receivers = new Set<string>();
    let minted = 0n;
    let burned = 0n;
    let largest = 0n;

    for (const entry of entries) {
      const from = entry.topics[1] ? decodeAddressWord(entry.topics[1]) : null;
      const to = entry.topics[2] ? decodeAddressWord(entry.topics[2]) : null;
      const amount = decodeUint(entry.data) ?? 0n;

      if (from === null) minted += amount;
      else senders.add(from.toLowerCase());
      if (to === null) burned += amount;
      else receivers.add(to.toLowerCase());
      if (amount > largest) largest = amount;
    }

    const transfers = String(entries.length);
    const distinctSenders = String(senders.size);
    const distinctReceivers = String(receivers.size);
    for (const value of [transfers, distinctSenders, distinctReceivers]) {
      figures.push({
        token: value,
        source: `${network.label} · ${token.observedSymbol} Transfer logs`,
        retrievedAt: logs.retrievedAt,
      });
    }

    if (entries.length === 0) {
      measured.push(
        `— ${token.observedSymbol}: no transfers in this window. The window was read successfully, so this is a measured zero rather than an absence.`,
      );
      continue;
    }

    // A result at the cap was cut off by the node, not bounded by the chain.
    // Everything derived from it — the count, the distinct addresses, the
    // largest transfer — describes the truncated set and nothing beyond it.
    const capped = entries.length >= LOG_RESULT_CAP;
    if (capped) {
      notRead.push(
        `— ${token.observedSymbol}: the node returned its maximum of ${LOG_RESULT_CAP.toLocaleString('en-US')} logs for this window, so the set was cut off. Every figure below for this token is a floor, not a total, and the true counts are higher by an unknown amount.`,
      );
    }

    const churn =
      senders.size === 0
        ? ''
        : ` That is ${transfers} transfers among ${distinctSenders} sending and ${distinctReceivers} receiving addresses — the second pair is what separates distribution from churn.`;

    let line = capped
      ? `— ${token.observedSymbol}: at least ${transfers} transfers — the node cut the result off at its limit, so this is a floor.${churn}`
      : `— ${token.observedSymbol}: ${transfers} transfers.${churn}`;

    if (isRead(decimals)) {
      const scale = Number(decimals.value);
      const largestText = formatUnits(largest, scale);
      figures.push({
        token: largestText,
        source: `${network.label} · ${token.observedSymbol} Transfer logs`,
        retrievedAt: logs.retrievedAt,
      });
      line += ` The largest single transfer was ${largestText}.`;

      if (minted > 0n || burned > 0n) {
        const mintedText = formatUnits(minted, scale);
        const burnedText = formatUnits(burned, scale);
        figures.push(
          {
            token: mintedText,
            source: `${network.label} · ${token.observedSymbol} Transfer logs`,
            retrievedAt: logs.retrievedAt,
          },
          {
            token: burnedText,
            source: `${network.label} · ${token.observedSymbol} Transfer logs`,
            retrievedAt: logs.retrievedAt,
          },
        );
        line += ` Units entered supply from the zero address totalling ${mintedText}, and units sent to it totalling ${burnedText}.`;
      }
    } else {
      notRead.push(
        `— ${token.observedSymbol}: decimals could not be read, so transfer sizes are not scaled and no amount is shown.`,
      );
    }

    measured.push(line);
  }

  /**
   * Carried on every path, not only the empty one.
   *
   * An earlier version returned this note only when nothing at all was read,
   * while the declared minimum is two — so a run that reached one source was
   * blocked by the runtime on coverage and the reason went missing, which is
   * precisely the diagnosis gap the note exists to close. A producer should not
   * be restating a threshold the registry already declares; it should hand over
   * what it knows and let the runtime judge.
   */
  const note = notRead.length > 0 ? notRead.join(' ').slice(0, 400) : undefined;

  if (sourcesReached === 0) {
    return { publication: null, sourcesReached, oldestInputAt, note };
  }

  const body = [
    `MEASURED · a window of ${windowFigure} blocks ending at ${toBlock.toLocaleString('en-US')}`,
    ...measured,
    '',
    'NOT READ',
    ...(notRead.length > 0
      ? notRead
      : ['— Every token in the registry returned its transfers for this window.']),
    '',
    'NOT ESTABLISHED BY A WINDOW',
    ...NEEDS_FULL_HISTORY.map((line) => `— ${line}`),
    '— Every count above describes this window only. A quiet window is not a quiet token, and nothing here is a statement about whether any figure is high or low.',
  ].join('\n');

  return {
    publication: {
      headline: `FLOW · ${TOKENS.length} tokens · ${windowFigure} blocks`,
      body,
      figures,
      allowedLiterals: [LOG_RESULT_CAP.toLocaleString("en-US")],
    },
    sourcesReached,
    oldestInputAt,
    note,
  };
};
