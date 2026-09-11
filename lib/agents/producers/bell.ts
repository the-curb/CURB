/**
 * THE BELL — the first agent wired through the runtime.
 *
 * Its whole job is the sentence nobody else prints: the chain and the exchange
 * do not run on the same clock. It publishes when the session phase changes and
 * stays quiet otherwise — a five-minute agent that repeats itself every five
 * minutes is noise, and NOTHING_TO_SAY is a real outcome with its own heartbeat.
 */

import type { Producer, ProducerResult } from '../runtime.ts';
import type { DeclaredFigure } from '../../doctrine/policy.ts';
import { isRead } from '../../doctrine/reading.ts';
import { readBlockNumber } from '../../chain/rpc.ts';
import { activeNetwork } from '../../chain/networks.ts';
import { phaseLabel, readSession, type SessionState } from '../../market/session.ts';

const SESSION_SOURCE = 'exchange session calendar · computed (NYSE/Nasdaq rules)';

/** The phase this agent last told anyone about, or null if it never has. */
/**
 * The phase this agent last told anyone about.
 *
 * Three answers, not two. `UNDETERMINED` means the store would not say — and
 * that is deliberately not folded into "never published", because the two lead
 * to opposite behaviour: one means stay quiet, the other means speak.
 */
async function lastPublishedPhase(
  store: Parameters<Producer>[0]['store'],
): Promise<{ phase: string | null } | { undetermined: string }> {
  const recent = await store.recentPublications(25);
  if (recent.state === 'UNREAD') {
    return { undetermined: `${recent.reason}${recent.detail ? `: ${recent.detail}` : ''}` };
  }
  const mine = recent.value.find((p) => p.agentId === 'bell');
  return { phase: mine ? (mine.headline.match(/^[A-Z\- ]+/)?.[0]?.trim() ?? null) : null };
}

function narrate(session: SessionState, blockToken: string | null): string {
  const chainLine =
    blockToken === null
      ? 'The chain was not reachable on this run, so its height is shown as absent rather than guessed.'
      : `Robinhood Chain stood at block ${blockToken} when this was read, and it has not paused.`;

  if (session.phase === 'REGULAR') {
    return [
      `Regular trading is under way. The session opened at ${session.regularOpenUtc} and runs to ${session.regularCloseUtc}.`,
      chainLine,
      'While the exchange is open the two clocks agree about what a price means. They will stop agreeing at the close.',
    ].join(' ');
  }

  if (session.phase === 'PRE' || session.phase === 'POST') {
    return [
      `The regular session is not running; this is ${phaseLabel(session.phase).toLowerCase()}.`,
      `The next regular open is ${session.nextRegularOpenUtc}.`,
      chainLine,
      'Prints in extended hours are thinner than the regular session, and a figure read here should not be described as the day.',
    ].join(' ');
  }

  const reason = session.holiday
    ? `The exchange is shut: ${session.holiday}.`
    : 'The exchange is shut.';
  return [
    reason,
    session.nextRegularOpenUtc
      ? `The next regular open is ${session.nextRegularOpenUtc}.`
      : 'The next regular open could not be determined and is shown as absent.',
    chainLine,
    'A price carried across a closed market is a memory rather than a quote. It is reported here with its age, and it is not refreshed against anything.',
  ].join(' ');
}

export const bellProducer: Producer = async ({ now, store }): Promise<ProducerResult> => {
  const session = readSession(now);
  const network = activeNetwork();

  // The calendar is computed, so it always answers: that is one source reached.
  let sourcesReached = 1;
  let oldestInputAt: Date = new Date(session.observedAt);

  const block = await readBlockNumber({ intervalSeconds: 300 });
  const figures: DeclaredFigure[] = [];
  let blockToken: string | null = null;

  if (isRead(block)) {
    sourcesReached += 1;
    blockToken = block.value.toLocaleString('en-US');
    figures.push({
      token: blockToken,
      source: `${network.label} · eth_blockNumber`,
      retrievedAt: block.retrievedAt,
    });
    const readAt = new Date(block.retrievedAt);
    if (readAt < oldestInputAt) oldestInputAt = readAt;
  }

  const phase = phaseLabel(session.phase);
  const previous = await lastPublishedPhase(store);

  // When the store will not say what we last published, the safe side is to
  // speak: a duplicate session line is harmless, a missed change is not.
  const undetermined = 'undetermined' in previous ? previous.undetermined : null;

  if (!('undetermined' in previous) && previous.phase === phase) {
    // Nothing changed. Say nothing, and leave a heartbeat saying so.
    return { publication: null, sourcesReached, oldestInputAt };
  }

  return {
    publication: {
      headline: `${phase} · ${session.calendarDay}`,
      body: narrate(session, blockToken),
      figures,
      readings: { 'block height': block },
    },
    sourcesReached,
    oldestInputAt,
    ...(undetermined === null
      ? {}
      : {
          note: `could not read what was last published (${undetermined}), so this may repeat a line already sent`,
        }),
  };
};
