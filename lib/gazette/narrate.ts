/**
 * The narrated lede.
 *
 * Code computes, the model narrates. That sentence is a contract here, not a
 * slogan, and this file is where it is enforced:
 *
 *   - The model receives the day's record and the exact list of figures it may
 *     repeat. It may use those figures verbatim. It may not introduce, round,
 *     convert, or estimate any number.
 *   - Its prose passes `screen()` — the same gate every agent passes — with the
 *     edition's declared figures. A number that is not in the record blocks the
 *     lede. A forecast, a verdict, or advice blocks the lede.
 *   - A blocked, refused, or failed narration is recorded as that outcome. The
 *     templated lede stands, and the page says a narration was attempted and
 *     what became of it. Nothing is substituted silently.
 *
 * Only closed days are narrated. Today's edition changes with every tick, and
 * prose written over a moving record describes a moment that has already gone.
 * Yesterday is stable: one call, one row, ever — pinned to a hash of the
 * composition it was written for.
 */

import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { figuresIn, screen, type DeclaredFigure } from '../doctrine/policy.ts';
import type { NarrationRecord, Store } from '../store/types.ts';
import { composeEdition, type Edition } from './edition.ts';
import { BRAND } from '../brand.ts';

export const DEFAULT_NARRATION_MODEL = 'claude-opus-5';
/** @deprecated the model is chosen at call time; see narrationModel(). */
export const NARRATION_MODEL = DEFAULT_NARRATION_MODEL;

/**
 * The model the lede is asked of. `CURB_NARRATION_MODEL` names another, for
 * a gateway that does not serve the default or a model that will not write
 * this lede (production: claude-opus-4-8 through SumoPod's OpenAI-format
 * route, 21 September 2026 — see narrationApi()). The record keeps the model
 * the answer says served it, so the page never names one it did not use.
 */
export function narrationModel(): string {
  return process.env.CURB_NARRATION_MODEL?.trim() || DEFAULT_NARRATION_MODEL;
}

/**
 * How long a failed call waits before the day is asked again. A failure is
 * not a verdict: an empty balance, a key that did not authenticate, a network
 * that did not answer say nothing about the day, and the day should be
 * narrated once they are fixed. A refusal and a policy block are verdicts and
 * stand — for the model that gave them. A refusal from one model says nothing
 * about another: when the deployment names a different model, a refused day is
 * asked again (21 September 2026: claude-opus-5 stopped on a content filter
 * through SumoPod for every day's prompt, claude-opus-4-8 wrote the lede).
 * Hourly, not every tick: a setup that stays broken costs a call an hour, not
 * one every five minutes.
 */
export const NARRATION_RETRY_SECONDS = 3600;

function retryDue(record: NarrationRecord, now: Date): boolean {
  if (record.outcome === 'REFUSED') return record.model !== narrationModel();
  return record.outcome === 'MODEL_FAILED' && now.getTime() - Date.parse(record.generatedAt) >= NARRATION_RETRY_SECONDS * 1000;
}

/**
 * Pins a narration to the composition it was written for. Only the parts the
 * prose can be about are hashed: a change in `composedAt` is not a change in
 * the day.
 */
export function editionHash(edition: Edition): string {
  const material = {
    day: edition.day,
    headline: edition.headline,
    sections: edition.sections.map((s) => [s.agent.id, s.headline, s.body, s.publishedAt, s.filings]),
    notRead: edition.notRead.map((n) => [n.agent.id, n.outcome, n.at, n.detail]),
    ledger: edition.ledger,
    blocked: edition.blockedOutputs,
  };
  return createHash('sha256').update(JSON.stringify(material)).digest('hex').slice(0, 16);
}

export interface NarrationPrompt {
  readonly system: string;
  readonly user: string;
  /** Every figure the model is permitted to repeat, and the gate will check against. */
  readonly figures: readonly DeclaredFigure[];
  readonly allowedLiterals: readonly string[];
}

const SYSTEM = `You write the lede for ${BRAND.paper.name}, a daily paper about stock tokens on Robinhood Chain.

The paper's rule is that code computes and you narrate. Every number in the record you are given was measured by an agent and carries its source. You may repeat those numbers exactly as they are written. You may not introduce any number that is not in the record, and you may not round, convert, total, or estimate one.

You never forecast, advise, rate, or judge. You do not say what will happen, what a reader should do, or whether anything is good, bad, safe, risky, healthy, high, or low. You describe what was measured, what could not be read, and what was stopped.

What was not read is as much the story as what was. When agents could not complete a reading, say so plainly and name them. When nothing was stopped by policy, you may say so.

When you give a count for a list, name every item it counts, or drop the count. Never write "the six widest" and then name three.

Write two to four sentences of plain, dry, specific prose. No headline. No bullet points. No preamble. Do not address the reader.`;

/**
 * Builds the prompt from the edition and, separately, the figure set the gate
 * will enforce. The two are derived from the same object so they cannot drift:
 * a figure the model is told it may use is a figure the gate will accept.
 */
export function buildNarrationPrompt(edition: Edition): NarrationPrompt {
  const figures: DeclaredFigure[] = [];
  const seen = new Set<string>();
  for (const section of edition.sections) {
    for (const figure of section.figures) {
      const key = `${figure.token}|${figure.source}`;
      if (seen.has(key)) continue;
      seen.add(key);
      figures.push(figure);
    }
  }

  // The ledger's counts are the paper's own arithmetic over the record. They
  // are declared with that as their source, so the model may say "six agents
  // filed" and the gate will accept the six.
  const ledgerSource = `the day's ledger, counted by code over the record for ${edition.day}`;
  const ledgerAt = edition.composedAt;
  for (const n of Object.values(edition.ledger)) {
    if (n > 0) figures.push({ token: String(n), source: ledgerSource, retrievedAt: ledgerAt });
  }
  const agentsFiled = new Set(edition.sections.map((s) => s.agent.id)).size;
  if (agentsFiled > 0) figures.push({ token: String(agentsFiled), source: ledgerSource, retrievedAt: ledgerAt });
  if (edition.notRead.length > 0) figures.push({ token: String(edition.notRead.length), source: ledgerSource, retrievedAt: ledgerAt });
  if (edition.blockedOutputs > 0) figures.push({ token: String(edition.blockedOutputs), source: ledgerSource, retrievedAt: ledgerAt });

  const filings = edition.sections
    .map(
      (s) =>
        `[${s.agent.name} · ${s.district}]${s.filings > 1 ? ` (latest of ${s.filings} filings)` : ''}\n${s.headline}\n${s.body}`,
    )
    .join('\n\n');

  const notRead =
    edition.notRead.length === 0
      ? '(every agent that ran completed its reading)'
      : edition.notRead
          .map((n) => `- ${n.agent.name}: ${n.outcome}${n.detail ? ` — ${n.detail}` : ''}`)
          .join('\n');

  const ledger = Object.entries(edition.ledger)
    .map(([k, v]) => `${k.toLowerCase().replace(/_/g, ' ')} ${v}`)
    .join(' · ');

  const figureList = figures.map((f) => `- ${f.token}  (${f.source})`).join('\n');

  const user = `DAY: ${edition.day} — a closed edition; the record is final.

FRONT PAGE HEADLINE
${edition.headline}

FILINGS
${filings || '(no agent filed)'}

NOT READ
${notRead}

LEDGER
${ledger} · outputs stopped by policy ${edition.blockedOutputs}

FIGURES YOU MAY REPEAT, EXACTLY AS WRITTEN
${figureList || '(none — the record holds no figures today; write without numbers)'}
Any number printed in the filings above may also be repeated, exactly as printed. No other number may appear.

Write the lede.`;

  // Every number printed in a filing already passed the gate when the filing
  // was published: as a declared figure, or as the agent's own count — a
  // literal ("28 of 28 tickers", "258 pools") the publication record does not
  // keep. Repeating one adds nothing to the record, so the narrator may; a
  // number that is not printed in any filing still blocks the lede. Found on
  // 21 September 2026, when a lede repeating "28", "258" and "35" from the
  // day's filings was stopped as unsourced.
  const printed = new Set<string>();
  for (const s of edition.sections) {
    for (const f of figuresIn(`${s.headline}\n${s.body}`, s.agent.name, s.publishedAt)) printed.add(f.token);
  }

  return {
    system: SYSTEM,
    user,
    figures,
    allowedLiterals: [...printed],
  };
}

/**
 * The one call this module makes, as a type — so a test can hand in a fake
 * that returns a scripted Message without standing up the whole SDK client.
 */
export interface NarrationClient {
  readonly messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  };
}

export interface NarrateOptions {
  /** Injected for tests. Defaults to a client reading ANTHROPIC_API_KEY. */
  readonly client?: NarrationClient;
  /** Injected for tests of the OpenAI-format route. Defaults to the global fetch. */
  readonly fetch?: typeof fetch;
  readonly now?: Date;
}

/**
 * Which wire format the lede is asked in. The default is the Anthropic Messages
 * API through the official SDK. `CURB_NARRATION_API=openai` asks an
 * OpenAI-format gateway instead, at `CURB_NARRATION_BASE_URL` (…/chat/completions)
 * with `CURB_NARRATION_API_KEY`, else `ANTHROPIC_API_KEY`. That route exists
 * because the owner's gateway, SumoPod, answers Claude models only there:
 * measured 21 September 2026, its /anthropic/v1/messages returned 404 with a
 * valid key while /v1/chat/completions answered claude-opus-5. The same gate
 * screens the text either way.
 */
export type NarrationApi = 'anthropic' | 'openai';

export function narrationApi(): NarrationApi {
  return process.env.CURB_NARRATION_API === 'openai' ? 'openai' : 'anthropic';
}

function narrationKey(): string | undefined {
  return process.env.CURB_NARRATION_API_KEY || process.env.ANTHROPIC_API_KEY || undefined;
}

export function narrationConfigured(): boolean {
  if (narrationApi() === 'openai') return Boolean(process.env.CURB_NARRATION_BASE_URL && narrationKey());
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

type Asked = { readonly kind: 'text'; readonly text: string; readonly model: string } | { readonly kind: 'refused'; readonly model: string; readonly detail: string } | { readonly kind: 'failed'; readonly detail: string };

/** The lede asked over an OpenAI-format chat completion. Never throws. */
async function askOpenAiFormat(prompt: NarrationPrompt, doFetch: typeof fetch): Promise<Asked> {
  const url = `${(process.env.CURB_NARRATION_BASE_URL ?? '').replace(/\/+$/, '')}/chat/completions`;
  try {
    const response = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${narrationKey() ?? ''}` },
      body: JSON.stringify({
        model: narrationModel(),
        max_tokens: 1024,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const body = (await response.json().catch(() => null)) as {
      model?: string;
      choices?: { finish_reason?: string; message?: { content?: string | null } }[];
      error?: { message?: string };
    } | null;
    if (!response.ok) return { kind: 'failed', detail: `API error ${response.status}: ${body?.error?.message ?? 'no message'}` };
    const choice = body?.choices?.[0];
    const model = body?.model ?? narrationModel();
    if (choice?.finish_reason === 'content_filter') return { kind: 'refused', model, detail: 'the gateway reported a content filter stop' };
    return { kind: 'text', text: (choice?.message?.content ?? '').trim(), model };
  } catch (cause) {
    return { kind: 'failed', detail: cause instanceof Error ? cause.message : 'unknown failure' };
  }
}

/**
 * Narrate one closed edition. Every path returns a record; none throws. The
 * record is what gets stored, whatever happened — a day the model refused is a
 * day the model refused, and that stays in the archive.
 */
export async function narrateEdition(
  edition: Edition,
  opts: NarrateOptions = {},
): Promise<NarrationRecord> {
  const now = opts.now ?? new Date();
  const hash = editionHash(edition);
  const base = { day: edition.day, editionHash: hash, generatedAt: now.toISOString() };

  if (edition.isToday) {
    return {
      ...base,
      outcome: 'MODEL_FAILED',
      standfirst: null,
      model: null,
      detail: 'refused to narrate a live edition: the record is still changing',
    };
  }

  if (!opts.client && !narrationConfigured()) {
    return {
      ...base,
      outcome: 'NOT_CONFIGURED',
      standfirst: null,
      model: null,
      detail: narrationApi() === 'openai' ? 'no CURB_NARRATION_BASE_URL or key for the OpenAI-format route' : 'no ANTHROPIC_API_KEY',
    };
  }

  const prompt = buildNarrationPrompt(edition);

  let text: string;
  let served: string;
  if (!opts.client && narrationApi() === 'openai') {
    const asked = await askOpenAiFormat(prompt, opts.fetch ?? fetch);
    if (asked.kind === 'failed') return { ...base, outcome: 'MODEL_FAILED', standfirst: null, model: narrationModel(), detail: asked.detail };
    if (asked.kind === 'refused') return { ...base, outcome: 'REFUSED', standfirst: null, model: asked.model, detail: asked.detail };
    return settle(asked.text, asked.model);
  }

  const client = opts.client ?? new Anthropic();
  try {
    const response = await client.messages.create({
      model: narrationModel(),
      // A lede is two to four sentences. The cap is a hard reason, not a lowball.
      max_tokens: 1024,
      output_config: { effort: 'medium' },
      system: [{ type: 'text', text: prompt.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt.user }],
    });

    if (response.stop_reason === 'refusal') {
      return {
        ...base,
        outcome: 'REFUSED',
        standfirst: null,
        model: response.model,
        detail: response.stop_details?.explanation ?? 'the model declined without an explanation',
      };
    }

    text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    served = response.model;
  } catch (cause) {
    const detail =
      cause instanceof Anthropic.AuthenticationError
        ? 'authentication failed'
        : cause instanceof Anthropic.RateLimitError
          ? 'rate limited'
          : cause instanceof Anthropic.APIError
            ? `API error ${cause.status}: ${cause.message}`
            : cause instanceof Error
              ? cause.message
              : 'unknown failure';
    return { ...base, outcome: 'MODEL_FAILED', standfirst: null, model: narrationModel(), detail };
  }

  return settle(text, served);

  /** Whatever route asked it, the answer meets the same checks. */
  function settle(answer: string, model: string): NarrationRecord {
    if (answer === '') {
      return { ...base, outcome: 'MODEL_FAILED', standfirst: null, model, detail: 'the model returned no text' };
    }

    // The same gate as every agent. The model is not exempt for being the model.
    const verdict = screen({ text: answer, figures: prompt.figures, allowedLiterals: prompt.allowedLiterals });
    if (verdict.decision === 'BLOCK') {
      return {
        ...base,
        outcome: 'POLICY_BLOCKED',
        standfirst: null,
        model,
        detail: verdict.breaches.map((b) => `${b.rule}: "${b.matched}"`).join(' · '),
      };
    }

    return { ...base, outcome: 'NARRATED', standfirst: answer, model, detail: null };
  }
}

export type NarrateDayResult =
  | { readonly state: 'ALREADY_DONE'; readonly day: string }
  | { readonly state: 'RECORD_UNREADABLE'; readonly day: string; readonly reason: string }
  | { readonly state: 'ATTEMPTED'; readonly day: string; readonly record: NarrationRecord; readonly stored: boolean };

/**
 * Narrate one closed day, once.
 *
 * Idempotent by hash: a day already narrated for the same composition is left
 * alone. A day whose composition changed — a late row, a corrected record —
 * gets narrated again, because the old prose was about a different edition.
 * Called from the scheduler after the agents run, for yesterday.
 */
/**
 * How long after a day closes its record is still treated as moving. A tick
 * that straddles midnight files its last rows minutes into the next day; two
 * hours is far past that. After it, a narration that exists stands without
 * recomposing the day — reading a full day's record every five minutes to
 * confirm nothing changed is a cost with no corresponding fact.
 */
export const SETTLE_SECONDS = 2 * 3600;

export function daySettledAt(day: string): Date {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + 24 * 3600 * 1000 + SETTLE_SECONDS * 1000);
}

export async function narrateClosedDay(
  store: Store,
  day: string,
  now: Date = new Date(),
  opts: NarrateOptions = {},
): Promise<NarrateDayResult> {
  // The cheap check first: a narration that already stands for a settled day
  // is left alone without reading the day back. Inside the settling window
  // the full comparison below still runs, so a late row is still caught.
  if (now.getTime() >= daySettledAt(day).getTime()) {
    const settled = await store.narration(day);
    if (settled.state === 'VERIFIED' && settled.value !== null) {
      if ((settled.value.outcome !== 'NOT_CONFIGURED' || !narrationConfigured()) && !retryDue(settled.value, now)) {
        return { state: 'ALREADY_DONE', day };
      }
    }
  }

  const record = await store.dayRecord(day);
  if (record.state === 'UNREAD') {
    return { state: 'RECORD_UNREADABLE', day, reason: record.reason };
  }
  const edition = composeEdition(record.value, now);
  if (edition.isToday) return { state: 'ALREADY_DONE', day };

  // An empty day has nothing to narrate. The record already says nothing was
  // recorded; asking a model to say it again would spend a call to add nothing,
  // and the page has no front section to show the result on anyway.
  if (edition.sections.length === 0 && edition.notRead.length === 0) {
    return { state: 'ALREADY_DONE', day };
  }

  const hash = editionHash(edition);
  const existing = await store.narration(day);
  if (existing.state === 'VERIFIED' && existing.value?.editionHash === hash) {
    // NOT_CONFIGURED is not a result to keep: the moment a key appears, the day
    // should be narrated. A failed call is asked again after an hour. Every
    // other outcome — a refusal, a policy block, a lede — stands.
    if ((existing.value.outcome !== 'NOT_CONFIGURED' || !narrationConfigured()) && !retryDue(existing.value, now)) {
      return { state: 'ALREADY_DONE', day };
    }
  }

  const narration = await narrateEdition(edition, { ...opts, now });
  const written = await store.writeNarration(narration);
  return { state: 'ATTEMPTED', day, record: narration, stored: written.state === 'WRITTEN' };
}

/** YYYY-MM-DD of the UTC day before `now`. */
export function yesterdayOf(now: Date): string {
  return new Date(now.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10);
}
