/**
 * The runtime. Every published line travels this route and there is no way around it:
 *
 *   PRODUCE → PROVENANCE → POLICY → PUBLISH → HEARTBEAT
 *
 * Provenance runs before policy on purpose. Policy's unsourced-figure gate reads
 * the declared figure set to decide which numbers are allowed in the narration —
 * so the set has to be validated first, or a figure carrying an empty source
 * would launder every number that matched it.
 *
 * The heartbeat is written on every real run, including the runs that look like
 * nothing happened. An agent that fails quietly must not look identical to one
 * that had nothing to say.
 *
 * A dry run writes nothing at all. A rehearsal that moves the state you use to
 * judge production is not a rehearsal.
 */

import { randomUUID } from 'node:crypto';
import { AGENTS, isDue, type AgentId, type AgentSpec } from './registry.ts';
import { screen, type DeclaredFigure, type PolicyBreach } from '../doctrine/policy.ts';
import type { Reading } from '../doctrine/reading.ts';
import { getStore } from '../store/fs.ts';
import type {
  BlockRecord,
  ObservationRecord,
  HeartbeatRecord,
  PublicationRecord,
  RunOutcome,
  Store,
} from '../store/types.ts';

export interface CandidatePublication {
  readonly headline: string;
  readonly body: string;
  /** Every number in `body` must appear here, with where it came from and when. */
  readonly figures: readonly DeclaredFigure[];
  /** Readings referenced by the text, so an absence cannot be dressed as a value. */
  readonly readings?: Readonly<Record<string, Reading<unknown>>>;
  readonly allowedLiterals?: readonly string[];
}

export interface ProducerResult {
  /** Null means nothing to say this run. That is an outcome, not a failure. */
  readonly publication: CandidatePublication | null;
  readonly sourcesReached: number;
  /** The oldest input that fed this run — the Warden's second unfakeable number. */
  readonly oldestInputAt: Date | null;
  /**
   * Measurements taken on this run, kept so a series can accumulate.
   *
   * These are persisted whatever happens to the narration. Policy governs what
   * is published, not what was measured — a sentence blocked for its wording
   * must not punch a hole in the record of what the sources actually said.
   */
  readonly observations?: readonly ObservationRecord[];
  /**
   * Why the sources that failed, failed. A coverage failure that only reports a
   * count is not diagnosable: "reached 1 of 2" says nothing about which source
   * went missing or why. A run that could not look should say what it could not
   * look at.
   */
  readonly note?: string;
}

export interface ProducerContext {
  readonly spec: AgentSpec;
  readonly now: Date;
  /**
   * Read-only use, by convention: a producer looks at what it already said so it
   * can stay quiet instead of repeating itself. Writing is the runtime's job.
   */
  readonly store: Store;
}

export type Producer = (ctx: ProducerContext) => Promise<ProducerResult>;

export interface RunOptions {
  readonly store?: Store;
  readonly now?: Date;
  readonly dryRun?: boolean;
}

export interface RunRecord {
  readonly agentId: AgentId;
  readonly outcome: RunOutcome;
  readonly heartbeat: HeartbeatRecord;
  readonly publicationId: string | null;
  readonly breaches: readonly PolicyBreach[];
  /** False for a dry run — nothing was persisted. */
  readonly persisted: boolean;
  /**
   * What the store did with this run, so a write failure is visible rather than
   * swallowed. `atomic: false` is the store reporting that the publication and
   * its heartbeat were written separately and could, on a crash, disagree.
   * Null on a dry run, which writes nothing by design.
   */
  readonly storage:
    | { readonly state: 'WRITTEN'; readonly atomic?: boolean }
    | { readonly state: 'FAILED'; readonly reason: string; readonly partial?: boolean }
    | null;
}

/**
 * The declared promoter's disclosure is appended here, by code, on every output.
 * Leaving it to the agent's own good manners is how it goes missing on the post
 * that mattered.
 */
const PROMOTION_DISCLOSURE =
  'Disclosed: this is promotion. The account posting it benefits from your attention. No forecast, no target, no advice.';

/** A figure that cannot carry its source and the time it was read does not go out. */
function checkProvenance(figures: readonly DeclaredFigure[]): string | null {
  for (const figure of figures) {
    if (figure.source.trim() === '') {
      return `figure "${figure.token}" carries no source`;
    }
    if (Number.isNaN(new Date(figure.retrievedAt).getTime())) {
      return `figure "${figure.token}" carries no readable timestamp`;
    }
  }
  return null;
}

function heartbeat(
  spec: AgentSpec,
  now: Date,
  outcome: RunOutcome,
  sourcesReached: number,
  oldestInputAt: Date | null,
  publicationId: string | null,
  detail: string | null,
): HeartbeatRecord {
  return {
    agentId: spec.id,
    runAt: now.toISOString(),
    outcome,
    sourcesReached,
    sourcesExpected: spec.sourcesExpected,
    oldestInputAt: oldestInputAt ? oldestInputAt.toISOString() : null,
    publicationId,
    detail,
  };
}

export async function runAgent(
  spec: AgentSpec,
  producer: Producer,
  opts: RunOptions = {},
): Promise<RunRecord> {
  const now = opts.now ?? new Date();
  const store = opts.store ?? getStore();
  const dryRun = opts.dryRun === true;

  const finish = async (
    hb: HeartbeatRecord,
    breaches: readonly PolicyBreach[] = [],
    storage: RunRecord['storage'] = null,
  ): Promise<RunRecord> => {
    let stored = storage;
    if (!dryRun && stored === null) {
      const written = await store.writeHeartbeat(hb);
      // A heartbeat that failed to save is a fact about the system. It travels
      // back to the caller instead of vanishing into a void the scheduler
      // cannot see — the run happened whether or not the record of it landed.
      stored = written.state === 'WRITTEN' ? { state: 'WRITTEN' } : written;
    }
    return {
      agentId: spec.id,
      outcome: hb.outcome,
      heartbeat: hb,
      publicationId: hb.publicationId,
      breaches,
      persisted: !dryRun,
      storage: stored,
    };
  };

  // ── PRODUCE ────────────────────────────────────────────────────────────────
  let result: ProducerResult;
  try {
    result = await producer({ spec, now, store });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'unknown producer failure';
    return finish(heartbeat(spec, now, 'PRODUCER_FAILED', 0, null, null, detail));
  }

  // Measurements are recorded before any gate runs. What was measured and what
  // is publishable are different questions, and the record answers the first.
  //
  // A failed observation write does not stop the run — the reading still
  // happened and is still publishable — but it is not swallowed either: a gap in
  // the series changes what the Surveyor can compute later, so it rides along on
  // the heartbeat where somebody will see it.
  let seriesFault: string | null = null;
  if (!dryRun && result.observations && result.observations.length > 0) {
    const written = await store.writeObservations(result.observations);
    if (written.state === 'FAILED') {
      seriesFault = `observations not stored: ${written.reason}`;
    }
  }

  /** Join whatever the run has to explain into one heartbeat detail line. */
  const withFault = (detail: string | null): string | null =>
    [detail, seriesFault].filter(Boolean).join(' · ') || null;

  // ── COVERAGE ───────────────────────────────────────────────────────────────
  // Below the stated minimum, no reading is declared and no figures are offered.
  // The system says it could not look. That is a third state, and it does not
  // collapse into "fine".
  if (result.sourcesReached < spec.minimumSources) {
    return finish(
      heartbeat(
        spec,
        now,
        'COVERAGE_BELOW_MINIMUM',
        result.sourcesReached,
        result.oldestInputAt,
        null,
        withFault(
          [
            `reached ${result.sourcesReached} of a required minimum ${spec.minimumSources}`,
            result.note,
          ]
            .filter(Boolean)
            .join(' · '),
        ),
      ),
    );
  }

  if (result.publication === null) {
    return finish(
      heartbeat(
        spec,
        now,
        'NOTHING_TO_SAY',
        result.sourcesReached,
        result.oldestInputAt,
        null,
        withFault(result.note ?? null),
      ),
    );
  }

  const candidate = result.publication;
  const body =
    spec.posture === 'PROMOTES' ? `${candidate.body}\n\n${PROMOTION_DISCLOSURE}` : candidate.body;

  // ── PROVENANCE ─────────────────────────────────────────────────────────────
  const provenanceFault = checkProvenance(candidate.figures);
  if (provenanceFault !== null) {
    return finish(
      heartbeat(
        spec,
        now,
        'PROVENANCE_INCOMPLETE',
        result.sourcesReached,
        result.oldestInputAt,
        null,
        withFault(provenanceFault),
      ),
    );
  }

  // ── POLICY ─────────────────────────────────────────────────────────────────
  // Code, not an instruction inside a prompt. A prompt is a request; this is a check.
  const verdict = screen({
    text: `${candidate.headline}\n${body}`,
    figures: candidate.figures,
    ...(candidate.readings === undefined ? {} : { readings: candidate.readings }),
    ...(candidate.allowedLiterals === undefined
      ? {}
      : { allowedLiterals: candidate.allowedLiterals }),
  });

  if (verdict.decision === 'BLOCK') {
    const block: BlockRecord = {
      id: randomUUID(),
      agentId: spec.id,
      blockedAt: now.toISOString(),
      headline: candidate.headline,
      body,
      breaches: verdict.breaches,
    };
    // A blocked output is an event to look at, not a silence.
    if (!dryRun) await store.writeBlock(block);
    return finish(
      heartbeat(
        spec,
        now,
        'POLICY_BLOCKED',
        result.sourcesReached,
        result.oldestInputAt,
        null,
        withFault(verdict.breaches.map((b) => `${b.rule}:${b.matched}`).join(' · ')),
      ),
      verdict.breaches,
    );
  }

  // ── PUBLISH + HEARTBEAT ────────────────────────────────────────────────────
  // Written together, because they describe one event. A publication with no
  // heartbeat went out without being recorded as having run, and a heartbeat
  // pointing at a publication that was never written describes something that
  // does not exist. Which of those two an operator is looking at is exactly
  // what `partial` tells them.
  const publication: PublicationRecord = {
    id: randomUUID(),
    agentId: spec.id,
    publishedAt: now.toISOString(),
    headline: candidate.headline,
    body,
    figures: candidate.figures,
    sourcesReached: result.sourcesReached,
  };
  const beat = heartbeat(
    spec,
    now,
    'PUBLISHED',
    result.sourcesReached,
    result.oldestInputAt,
    publication.id,
    withFault(null),
  );

  if (dryRun) return finish(beat);

  const stored = await store.publishAtomically(publication, beat);
  return finish(
    beat,
    [],
    stored.state === 'WRITTEN'
      ? { state: 'WRITTEN', atomic: stored.atomic }
      : { state: 'FAILED', reason: stored.reason, partial: stored.partial },
  );
}

/** The producers wired up so far. An agent with no producer is not yet running. */
export type ProducerTable = Partial<Record<AgentId, Producer>>;

export interface TickResult {
  readonly at: string;
  readonly ran: readonly RunRecord[];
  /** Agents that were due but have no producer wired. Named, never hidden. */
  readonly notImplemented: readonly AgentId[];
  /** Agents whose interval had not elapsed, and on-request agents. */
  readonly notDue: readonly AgentId[];
  /**
   * Agents we could not decide about, because the heartbeat store would not say
   * when they last ran.
   *
   * This is its own outcome on purpose. Due-ness is derived from the last run,
   * so an unreadable store means the question has no answer — and neither
   * default is safe to assume. Running blind risks publishing twice; silently
   * treating it as not-due risks an agent that never runs again while the
   * dashboard shows nothing wrong. So it runs nothing and says which agents it
   * could not judge.
   */
  readonly undetermined: readonly { readonly agentId: AgentId; readonly reason: string }[];
}

/**
 * One timer serves every interval: each agent is asked whether its own interval
 * has elapsed. Agents without an interval are answered on request and are never
 * counted as failures for staying quiet.
 */
export async function tick(
  producers: ProducerTable,
  opts: RunOptions = {},
): Promise<TickResult> {
  const now = opts.now ?? new Date();
  const store = opts.store ?? getStore();

  const ran: RunRecord[] = [];
  const notImplemented: AgentId[] = [];
  const notDue: AgentId[] = [];
  const undetermined: { agentId: AgentId; reason: string }[] = [];

  for (const spec of AGENTS) {
    const last = await store.latestHeartbeat(spec.id);

    // An unreadable store does not mean the agent never ran. Due-ness cannot be
    // derived from an absence we could not confirm, so nothing is assumed.
    if (last.state === 'UNREAD') {
      undetermined.push({
        agentId: spec.id,
        reason: `${last.reason}${last.detail ? ` — ${last.detail}` : ''}`,
      });
      continue;
    }

    const lastRunAt = last.value ? new Date(last.value.runAt) : null;
    if (!isDue(spec, lastRunAt, now)) {
      notDue.push(spec.id);
      continue;
    }
    const producer = producers[spec.id];
    if (!producer) {
      notImplemented.push(spec.id);
      continue;
    }
    ran.push(await runAgent(spec, producer, { ...opts, now, store }));
  }

  return { at: now.toISOString(), ran, notImplemented, notDue, undetermined };
}
