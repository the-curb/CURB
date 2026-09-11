/**
 * THE HERALD — declared promotion.
 *
 * The one agent that wants something from the reader, and the one that says so
 * first. Its disclosure is appended by the runtime, not by this file, so it
 * cannot go missing on the post that mattered.
 *
 * It promotes by reporting, which is the only kind of promotion this system can
 * do honestly: the figures it publishes are read back from the same heartbeat
 * and publication store every other agent writes to. If the roster is thin, the
 * promotion says the roster is thin.
 */

import type { Producer, ProducerResult } from '../runtime.ts';
import type { DeclaredFigure } from '../../doctrine/policy.ts';
import { AGENTS, AGENT_COUNTS } from '../registry.ts';
import { RULE_COUNT } from '../../doctrine/policy.ts';
import { BRAND } from '../../brand.ts';

const STORE_SOURCE = 'the heartbeat and publication store, read at the moment of posting';

export const heraldProducer: Producer = async ({ now, store }): Promise<ProducerResult> => {
  const [heartbeatsRead, countsRead] = await Promise.all([
    store.latestHeartbeats(),
    store.recordCounts(),
  ]);

  // The promoter is the last agent that should be allowed to round an unreadable
  // store down to a flattering zero, so it refuses to post at all rather than
  // describe a roster it could not see.
  if (heartbeatsRead.state === 'UNREAD') {
    return {
      publication: null,
      sourcesReached: 0,
      oldestInputAt: null,
      note: `the heartbeat store could not be read (${heartbeatsRead.reason}), so nothing is claimed about what is running`,
    };
  }

  const heartbeats = heartbeatsRead.value;
  // Real counts from the store, not the length of a bounded read: a window of
  // the newest two hundred is two hundred forever once the store passes it,
  // and a promoter quoting that as the number kept would be publishing a
  // floor as a total.
  const counts = countsRead.state === 'UNREAD' ? null : countsRead.value;

  const figures: DeclaredFigure[] = [];
  const declare = (token: string) =>
    figures.push({ token, source: STORE_SOURCE, retrievedAt: now.toISOString() });

  const observedAgents = String(heartbeats.length);
  const totalAgents = String(AGENT_COUNTS.total);
  const measuring = String(AGENT_COUNTS.measure);
  const rules = String(RULE_COUNT);
  [observedAgents, totalAgents, measuring, rules].forEach(declare);

  // Both counts are declared only when both were read. A promoter reporting a
  // publication count beside an unreadable block count would be picking the
  // flattering half of the pair.
  const tally =
    counts === null
      ? '— The publication and block counts could not be read from the store, so neither is quoted here. Quoting the first without the second would be choosing the flattering half.'
      : (() => {
          const published = String(counts.publications);
          const blocked = String(counts.blocks);
          declare(published);
          declare(blocked);
          return `— ${published} ${counts.publications === 1 ? 'publication is' : 'publications are'} in the store, and ${blocked} ${counts.blocks === 1 ? 'output was' : 'outputs were'} stopped by policy before reaching a channel. Both counts come from the same store; the second is not hidden to make the first look better.`;
        })();

  const neverRan = AGENTS.filter((agent) => !heartbeats.some((h) => h.agentId === agent.id));
  const neverRanCount = String(neverRan.length);
  declare(neverRanCount);

  const rosterLine =
    neverRan.length === 0
      ? `— Every one of the ${totalAgents} agents has run at least once.`
      : `— ${observedAgents} of ${totalAgents} agents have run at least once. The other ${neverRanCount} are described in the register and have not: ${neverRan
          .map((a) => a.name)
          .join(', ')}. They are named rather than left out of the count.`;

  const body = [
    `${BRAND.thesis}`,
    `${BRAND.stage}`,
    '',
    'WHAT IS RUNNING',
    rosterLine,
    `— ${measuring} of the agents measure and report. This one promotes, and says so in the line appended below every time it posts.`,
    tally,
    // Worded around the forbidden phrases rather than quoting them: the gate
    // reads text, not intent, and it is not given an exception for this file.
    `— ${rules} publication rules run in code ahead of every post, including this one. The rules against forecasting, and against naming a level to trade at, bind this agent exactly as they bind the measuring ones.`,
    '',
    'WHAT YOU ARE NOT BEING OFFERED',
    '— No forecast, no target, no operational parameter. Not because they would be unpopular, but because this system has no way to produce one it could stand behind.',
    '— Nothing to buy. There is no token, no sale, and no allocation attached to any of this.',
    '— No claim that a figure published here is correct. The claim is narrower and it is the whole point: every figure carries where it came from and when it was read, and anything that could not be read is shown as absent rather than as zero.',
  ].join('\n');

  return {
    publication: {
      headline: `THE CURB · ${observedAgents} of ${totalAgents} agents observed`,
      body,
      figures,
    },
    sourcesReached: 1,
    oldestInputAt: null,
  };
};
