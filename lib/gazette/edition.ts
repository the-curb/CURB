/**
 * The Curb Gazette — one day's record, set as a paper.
 *
 * An edition is a pure derivation of the day's record. It adds nothing the
 * agents did not publish, and it cannot disagree with them, because it is
 * composed from the same rows every time. There is no second store of
 * "articles" that could drift from the publications they describe.
 *
 * The agents are the reporters. Each section is filed by the agent that
 * measured it, under the district it works in, and that agent's declared
 * refusal rides along — so a reader sees not only what was said but what the
 * author is built to refuse to say.
 *
 * Two parts of every edition are about what did NOT happen: the agents that
 * could not read, and the outputs that policy stopped. A paper that printed
 * only the successes would be the flattering half.
 */

import { AGENT_BY_ID, type AgentId, type AgentSpec } from '../agents/registry.ts';
import { BRAND } from '../brand.ts';
import type { DeclaredFigure } from '../doctrine/policy.ts';
import type { DayRecord, HeartbeatRecord, RunOutcome } from '../store/types.ts';

export interface EditionSection {
  readonly district: string;
  readonly agent: AgentSpec;
  readonly headline: string;
  readonly body: string;
  readonly figures: readonly DeclaredFigure[];
  readonly publishedAt: string;
  /**
   * How many times this agent filed that day. The section shows the latest
   * filing; the count keeps the earlier ones from disappearing. An agent on a
   * fifteen-minute interval files nearly a hundred times a day, and a paper
   * that printed all of them would be a log.
   */
  readonly filings: number;
}

export interface NotRead {
  readonly agent: AgentSpec;
  readonly outcome: RunOutcome;
  readonly at: string;
  readonly detail: string | null;
}

export interface StoppedByPolicy {
  readonly agent: AgentSpec;
  readonly at: string;
  readonly breaches: readonly { readonly rule: string; readonly matched: string }[];
}

export interface SourceOfRecord {
  readonly source: string;
  /** How many declared figures cited it that day. */
  readonly figures: number;
  readonly firstReadAt: string;
}

export type Ledger = Readonly<Record<RunOutcome, number>>;

export interface Edition {
  readonly day: string;
  readonly masthead: string;
  readonly headline: string;
  /** The lede: what the day was, in the paper's own count. */
  readonly standfirst: string;
  readonly sections: readonly EditionSection[];
  readonly notRead: readonly NotRead[];
  readonly sources: readonly SourceOfRecord[];
  readonly ledger: Ledger;
  readonly blockedOutputs: number;
  /** Each output the policy gate kept back that day: who, when, and the rule with the text that tripped it. */
  readonly stoppedByPolicy: readonly StoppedByPolicy[];
  /** True while the day is still being recorded; the edition will grow. */
  readonly isToday: boolean;
  readonly composedAt: string;
}

const EMPTY_LEDGER: Ledger = {
  PUBLISHED: 0,
  NOTHING_TO_SAY: 0,
  COVERAGE_BELOW_MINIMUM: 0,
  PROVENANCE_INCOMPLETE: 0,
  POLICY_BLOCKED: 0,
  PRODUCER_FAILED: 0,
};

/**
 * Which section leads. A session change is the day's news when there is one;
 * otherwise the order follows what a reader of a market paper would open to.
 */
const LEAD_ORDER: readonly AgentId[] = [
  'bell',
  'archivist',
  'tally',
  'pillar',
  'registrar',
  'surveyor',
  'counsel',
  'warden',
  'herald',
];

function districtOrder(district: string): number {
  const index = BRAND.universe.districts.findIndex((d) => d.name === district);
  return index === -1 ? BRAND.universe.districts.length : index;
}

/**
 * Latest run per agent among the ones that could not complete a reading. A run
 * the policy gate stopped is not one of them — the reading was complete and
 * the text was kept back — so it is counted with the blocked outputs instead.
 */
function collectNotRead(heartbeats: readonly HeartbeatRecord[]): NotRead[] {
  const latest = new Map<AgentId, HeartbeatRecord>();
  for (const h of heartbeats) {
    if (h.outcome === 'PUBLISHED' || h.outcome === 'NOTHING_TO_SAY' || h.outcome === 'POLICY_BLOCKED') continue;
    const held = latest.get(h.agentId);
    if (!held || h.runAt > held.runAt) latest.set(h.agentId, h);
  }
  return [...latest.values()]
    .map((h) => ({ agent: AGENT_BY_ID[h.agentId], outcome: h.outcome, at: h.runAt, detail: h.detail }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

function collectSources(publications: DayRecord['publications']): SourceOfRecord[] {
  const seen = new Map<string, { figures: number; firstReadAt: string }>();
  for (const publication of publications) {
    for (const figure of publication.figures) {
      const held = seen.get(figure.source);
      if (!held) seen.set(figure.source, { figures: 1, firstReadAt: figure.retrievedAt });
      else {
        held.figures += 1;
        if (figure.retrievedAt < held.firstReadAt) held.firstReadAt = figure.retrievedAt;
      }
    }
  }
  return [...seen.entries()]
    .map(([source, v]) => ({ source, ...v }))
    .sort((a, b) => b.figures - a.figures || a.source.localeCompare(b.source));
}

function tally(heartbeats: readonly HeartbeatRecord[]): Ledger {
  const counts: Record<RunOutcome, number> = { ...EMPTY_LEDGER };
  for (const h of heartbeats) counts[h.outcome] += 1;
  return counts;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The lede is the paper counting itself. It is templated, not written, so it
 * cannot claim a day was quieter or busier than the ledger says.
 */
function standfirst(
  sections: readonly EditionSection[],
  reports: number,
  notRead: readonly NotRead[],
  blocked: number,
  ledger: Ledger,
  isToday: boolean,
): string {
  const filed = new Set(sections.map((s) => s.agent.id)).size;
  const parts: string[] = [];

  parts.push(
    filed === 0
      ? 'No agent filed.'
      : `${plural(filed, 'agent', 'agents')} filed, ${plural(reports, 'report', 'reports')} in all.`,
  );

  if (ledger.NOTHING_TO_SAY > 0) {
    parts.push(
      `${plural(ledger.NOTHING_TO_SAY, 'run', 'runs')} ended with nothing to say — a real outcome, recorded as one.`,
    );
  }

  if (notRead.length > 0) {
    parts.push(
      `${plural(notRead.length, 'agent', 'agents')} could not complete a reading, and each is named below with the reason.`,
    );
  }

  parts.push(
    blocked === 0
      ? 'Nothing was stopped by policy.'
      : `${plural(blocked, 'output was', 'outputs were')} stopped by policy before reaching this page, and kept.`,
  );

  parts.push(
    isToday
      ? 'The day is still being recorded; this edition grows until midnight UTC.'
      : 'Every figure carries where it came from and when it was read.',
  );

  return parts.join(' ');
}

/** The Bell's headline carries the exchange's calendar day (ET), which is not the paper's UTC day; filings from before the clock was named are read the same way. */
function nameTheClock(agentId: string, headline: string): string {
  if (agentId !== 'bell') return headline;
  const old = /^(.+) · (\d{4}-\d{2}-\d{2})$/.exec(headline);
  return old ? `${old[1]} · exchange day ${old[2]} ET` : headline;
}

function chooseHeadline(sections: readonly EditionSection[], day: string): string {
  for (const id of LEAD_ORDER) {
    const lead = sections.find((s) => s.agent.id === id);
    if (lead) return lead.headline;
  }
  return `The record for ${day}`;
}

export function composeEdition(record: DayRecord, now: Date = new Date()): Edition {
  // Latest filing per agent, with the count of how many there were. Sources of
  // record are still collected from every filing, so a figure cited at 10:00
  // and gone by 11:00 is not dropped from the citations.
  const latest = new Map<AgentId, { publication: (typeof record.publications)[number]; filings: number }>();
  for (const p of record.publications) {
    const held = latest.get(p.agentId);
    if (!held) latest.set(p.agentId, { publication: p, filings: 1 });
    else {
      held.filings += 1;
      if (p.publishedAt > held.publication.publishedAt) held.publication = p;
    }
  }

  const sections: EditionSection[] = [...latest.values()]
    .map(({ publication: p, filings }) => {
      const agent = AGENT_BY_ID[p.agentId];
      return {
        district: agent.district,
        agent,
        headline: nameTheClock(p.agentId, p.headline),
        body: p.body,
        figures: p.figures,
        publishedAt: p.publishedAt,
        filings,
      };
    })
    .sort(
      (a, b) =>
        districtOrder(a.district) - districtOrder(b.district) ||
        LEAD_ORDER.indexOf(a.agent.id) - LEAD_ORDER.indexOf(b.agent.id) ||
        a.publishedAt.localeCompare(b.publishedAt),
    );

  const notRead = collectNotRead(record.heartbeats);
  const ledger = tally(record.heartbeats);
  const isToday = now.toISOString().slice(0, 10) === record.day;

  return {
    day: record.day,
    masthead: BRAND.paper.name,
    headline: chooseHeadline(sections, record.day),
    standfirst: standfirst(sections, record.publications.length, notRead, record.blocks.length, ledger, isToday),
    sections,
    notRead,
    sources: collectSources(record.publications),
    ledger,
    blockedOutputs: record.blocks.length,
    stoppedByPolicy: [...record.blocks]
      .map((b) => ({ agent: AGENT_BY_ID[b.agentId], at: b.blockedAt, breaches: b.breaches.map((x) => ({ rule: x.rule, matched: x.matched })) }))
      .sort((a, b) => a.at.localeCompare(b.at)),
    isToday,
    composedAt: now.toISOString(),
  };
}

/** YYYY-MM-DD in UTC, the paper's calendar. */
export function utcDay(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

export function isValidDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  // The parse must give the same day back. JavaScript rolls 2026-09-31 forward
  // into October rather than refusing it, and an edition composed for a day the
  // calendar does not have would report "no agent filed" about nothing.
  const at = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === day;
}
