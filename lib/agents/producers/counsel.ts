/**
 * COUNSEL — eligibility, rights and restrictions.
 *
 * The only agent that reads documents rather than the chain, and the one with
 * the narrowest job: point at the published terms, quote what was recorded, and
 * refuse every determination that belongs to the issuer.
 *
 * It applies the same three states to documents that the rest of the system
 * applies to figures. A link is not a reading. A register that lists five
 * sources the same way when one has been read and four have not is claiming
 * coverage it does not have, which is the document-shaped version of printing a
 * zero for a figure nobody looked up.
 */

import type { Producer, ProducerResult } from '../runtime.ts';
import type { DeclaredFigure } from '../../doctrine/policy.ts';
import {
  NEVER_DETERMINED,
  readSources,
  TERMS_SOURCES,
  unreadSources,
} from '../../chain/terms.ts';

const REGISTER_SOURCE = 'the published-terms register, kept in this repository with dates';

export const counselProducer: Producer = async ({ now }): Promise<ProducerResult> => {
  const read = readSources();
  const unread = unreadSources();

  // The register always answers: it is the record of what has and has not been
  // read, and that record is the primary thing this agent publishes. Each
  // document actually read is a further source on top of it.
  const sourcesReached = 1 + read.length;

  const figures: DeclaredFigure[] = [];
  const declare = (token: string) =>
    figures.push({ token, source: REGISTER_SOURCE, retrievedAt: now.toISOString() });

  const totalCount = String(TERMS_SOURCES.length);
  const readCount = String(read.length);
  const unreadCount = String(unread.length);
  [totalCount, readCount, unreadCount].forEach(declare);

  const readLines = read.map(
    (source) =>
      `— ${source.title} (${source.url}), read ${source.readAt}. It is the authority for ${source.covers}. Recorded: ${source.recorded}`,
  );

  const unreadLines = unread.map(
    (source) =>
      `— ${source.title} (${source.url}) is the authority for ${source.covers}. This system holds the link and has not read the page, so nothing here describes what it says.`,
  );

  const body = [
    `THE REGISTER · ${readCount} of ${totalCount} sources read`,
    ...(readLines.length > 0
      ? readLines
      : ['— No published source has been read, so this register carries no quotations.']),
    '',
    `NOT READ · ${unreadCount} of ${totalCount}`,
    ...(unreadLines.length > 0
      ? unreadLines
      : ['— Every source in the register has been read.']),
    '',
    'NEVER DETERMINED HERE',
    ...NEVER_DETERMINED.map((line) => `— ${line}`),
    '',
    'HOW TO READ THIS',
    '— A quotation above is what a page said on the date beside it. Pages change, and a recorded line is evidence of what was published then, not a guarantee of what is published now.',
    '— Pointing at a term is not interpreting it. Where the wording matters to a decision, the issuer’s page is the thing to read, not this summary of it.',
  ].join('\n');

  return {
    publication: {
      headline: `TERMS · ${readCount} of ${totalCount} sources read`,
      body,
      figures,
      // 24/5 names the schedule the vendor page states for stock feeds.
      allowedLiterals: ['24', '5'],
    },
    sourcesReached,
    oldestInputAt:
      read.length > 0 && read[0]?.readAt ? new Date(read[0].readAt) : null,
  };
};
