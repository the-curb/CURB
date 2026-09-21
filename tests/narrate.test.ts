import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { composeEdition } from '../lib/gazette/edition.ts';
import {
  buildNarrationPrompt,
  daySettledAt,
  editionHash,
  narrateClosedDay,
  narrateEdition,
  narrationModel,
  narrationConfigured,
  NARRATION_RETRY_SECONDS,
  type NarrationClient,
} from '../lib/gazette/narrate.ts';
import type { DayRecord, NarrationRecord, Store } from '../lib/store/types.ts';

/**
 * The narrator is tested without a network and without a key. What is under
 * test is not the model — it is the contract around the model: that the prose
 * it returns passes the same gate as every agent, and that every way the call
 * can end is recorded as an outcome rather than swallowed.
 */

const DAY = '2026-09-10';
const LATER = new Date('2026-09-11T15:00:00.000Z');

const record: DayRecord = {
  day: DAY,
  publications: [
    {
      id: 'p1',
      agentId: 'pillar',
      publishedAt: `${DAY}T10:00:00.000Z`,
      headline: 'FEEDS · 2 read · CLOSED',
      body: 'LINK / USD: 11.43, updated 61m ago.',
      figures: [
        { token: '11.43', source: 'chainlink · LINK / USD', retrievedAt: `${DAY}T10:00:00.000Z` },
        { token: '61', source: 'chainlink · LINK / USD updatedAt', retrievedAt: `${DAY}T10:00:00.000Z` },
      ],
      sourcesReached: 3,
    },
  ],
  heartbeats: [
    {
      agentId: 'pillar',
      runAt: `${DAY}T10:00:00.000Z`,
      outcome: 'PUBLISHED',
      sourcesReached: 3,
      sourcesExpected: 3,
      oldestInputAt: null,
      publicationId: 'p1',
      detail: null,
    },
    {
      agentId: 'tally',
      runAt: `${DAY}T11:00:00.000Z`,
      outcome: 'COVERAGE_BELOW_MINIMUM',
      sourcesReached: 0,
      sourcesExpected: 3,
      oldestInputAt: null,
      publicationId: null,
      detail: 'the chain head could not be read',
    },
  ],
  blocks: [],
};

const closed = composeEdition(record, LATER);

/** A client that answers with whatever the test scripts. */
function scripted(text: string, stop: Anthropic.Message['stop_reason'] = 'end_turn'): NarrationClient {
  return {
    messages: {
      async create(): Promise<Anthropic.Message> {
        // Shaped to the SDK's own Message type, so a drift in the SDK fails
        // this file at typecheck rather than being hidden behind a cast.
        const message: Anthropic.Message = {
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5',
          content: text === '' ? [] : [{ type: 'text', text, citations: null }],
          stop_reason: stop,
          stop_sequence: null,
          stop_details: stop === 'refusal' ? { type: 'refusal', category: null, explanation: 'declined' } : null,
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            output_tokens_details: null,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
            cache_creation: null,
            server_tool_use: null,
            service_tier: null,
            inference_geo: null,
          },
          container: null,
        };
        return message;
      },
    },
  };
}

function failing(error: Error): NarrationClient {
  return { messages: { async create() { throw error; } } };
}

describe('the prompt', () => {
  it('hands the model exactly the figures the gate will accept', () => {
    const prompt = buildNarrationPrompt(closed);
    const tokens = prompt.figures.map((f) => f.token);
    assert.ok(tokens.includes('11.43'));
    assert.ok(tokens.includes('61'));
    // The ledger's own counts are declared too, sourced to the ledger.
    assert.ok(prompt.figures.some((f) => f.token === '1' && /ledger/.test(f.source)));
    assert.match(prompt.user, /FIGURES YOU MAY REPEAT/);
    assert.match(prompt.user, /THE TALLY: COVERAGE_BELOW_MINIMUM/);
  });

  it('tells the model the rule in the system prompt, not the user turn', () => {
    const prompt = buildNarrationPrompt(closed);
    assert.match(prompt.system, /never forecast, advise, rate, or judge/);
    assert.match(prompt.system, /may not introduce any number/);
  });
});

describe('the hash', () => {
  it('ignores when the edition was composed', () => {
    const a = composeEdition(record, new Date('2026-09-11T15:00:00Z'));
    const b = composeEdition(record, new Date('2026-09-12T09:00:00Z'));
    assert.equal(editionHash(a), editionHash(b));
  });

  it('changes when the record changes', () => {
    const more = { ...record, blocks: [{ id: 'b', agentId: 'pillar' as const, blockedAt: `${DAY}T12:00:00.000Z`, headline: 'h', body: 'b', breaches: [] }] };
    assert.notEqual(editionHash(closed), editionHash(composeEdition(more, LATER)));
  });
});

describe('outcomes', () => {
  it('narrates clean prose that repeats only the record’s figures', async () => {
    const r = await narrateEdition(closed, {
      now: LATER,
      client: scripted('One agent filed. LINK / USD read 11.43, updated 61m ago. The Tally could not read the chain head and said so.'),
    });
    assert.equal(r.outcome, 'NARRATED');
    assert.match(r.standfirst ?? '', /11\.43/);
    assert.equal(r.model, 'claude-opus-5');
    assert.equal(r.editionHash, editionHash(closed));
  });

  it('blocks a number the record does not hold', async () => {
    // 12.00 is not in the record. The model does not get to round.
    const r = await narrateEdition(closed, { now: LATER, client: scripted('LINK / USD read about 12.00.') });
    assert.equal(r.outcome, 'POLICY_BLOCKED');
    assert.match(r.detail ?? '', /UNSOURCED_FIGURE/);
    assert.equal(r.standfirst, null);
  });

  it('blocks advice, exactly as it would from an agent', async () => {
    const r = await narrateEdition(closed, { now: LATER, client: scripted('LINK / USD read 11.43. You should buy before the open.') });
    assert.equal(r.outcome, 'POLICY_BLOCKED');
    assert.match(r.detail ?? '', /ADVICE_SHAPE/);
  });

  it('blocks a forecast', async () => {
    const r = await narrateEdition(closed, { now: LATER, client: scripted('LINK / USD read 11.43 and is poised to rally.') });
    assert.equal(r.outcome, 'POLICY_BLOCKED');
    assert.match(r.detail ?? '', /FORECAST/);
  });

  it('records a refusal as a refusal', async () => {
    const r = await narrateEdition(closed, { now: LATER, client: scripted('', 'refusal') });
    assert.equal(r.outcome, 'REFUSED');
    assert.equal(r.detail, 'declined');
  });

  it('records an empty answer as a failure, not as a blank lede', async () => {
    const r = await narrateEdition(closed, { now: LATER, client: scripted('') });
    assert.equal(r.outcome, 'MODEL_FAILED');
  });

  it('records an API failure with its reason', async () => {
    const r = await narrateEdition(closed, { now: LATER, client: failing(new Error('socket hang up')) });
    assert.equal(r.outcome, 'MODEL_FAILED');
    assert.equal(r.detail, 'socket hang up');
  });

  it('will not narrate a live edition', async () => {
    const live = composeEdition({ ...record, day: '2026-09-11' }, LATER);
    assert.equal(live.isToday, true);
    const r = await narrateEdition(live, { now: LATER, client: scripted('anything') });
    assert.equal(r.outcome, 'MODEL_FAILED');
    assert.match(r.detail ?? '', /live edition/);
  });

  it('reports not-configured when there is no key and no client', async () => {
    const saved = { key: process.env.ANTHROPIC_API_KEY, token: process.env.ANTHROPIC_AUTH_TOKEN };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    try {
      const r = await narrateEdition(closed, { now: LATER });
      assert.equal(r.outcome, 'NOT_CONFIGURED');
    } finally {
      if (saved.key !== undefined) process.env.ANTHROPIC_API_KEY = saved.key;
      if (saved.token !== undefined) process.env.ANTHROPIC_AUTH_TOKEN = saved.token;
    }
  });
});

describe('narrateClosedDay, once the day has settled', () => {
  /**
   * Only the three store methods the function touches. The cast is the test
   * admitting it is a fake; the assertion is on how many times the day record
   * is read, which is the whole point of the settling rule.
   */
  function storeWith(existing: NarrationRecord | null) {
    const calls = { dayRecord: 0, narration: 0, writes: 0 };
    const store = {
      async narration() {
        calls.narration += 1;
        return { state: 'VERIFIED', value: existing, source: 'fake', retrievedAt: LATER.toISOString(), ageSeconds: 0, intervalSeconds: 60 };
      },
      async dayRecord() {
        calls.dayRecord += 1;
        return { state: 'VERIFIED', value: record, source: 'fake', retrievedAt: LATER.toISOString(), ageSeconds: 0, intervalSeconds: 60 };
      },
      async writeNarration() {
        calls.writes += 1;
        return { state: 'WRITTEN' };
      },
    } as unknown as Store;
    return { store, calls };
  }
  const narrated: NarrationRecord = { day: DAY, editionHash: editionHash(closed), outcome: 'NARRATED', standfirst: 'x', model: 'm', detail: null, generatedAt: `${DAY}T23:59:00.000Z` };

  it('leaves an existing narration alone without reading the day back', async () => {
    const { store, calls } = storeWith(narrated);
    const after = new Date(daySettledAt(DAY).getTime() + 60_000);
    const r = await narrateClosedDay(store, DAY, after, { client: scripted('would be new prose') });
    assert.equal(r.state, 'ALREADY_DONE');
    assert.equal(calls.dayRecord, 0);
    assert.equal(calls.writes, 0);
  });

  it('still recomposes and compares inside the settling window', async () => {
    const { store, calls } = storeWith(narrated);
    const before = new Date(daySettledAt(DAY).getTime() - 60_000);
    const r = await narrateClosedDay(store, DAY, before, { client: scripted('would be new prose') });
    assert.equal(r.state, 'ALREADY_DONE'); // same hash: nothing to redo
    assert.equal(calls.dayRecord, 1);
  });

  it('narrates a settled day that was never narrated', async () => {
    const { store, calls } = storeWith(null);
    const after = new Date(daySettledAt(DAY).getTime() + 60_000);
    const r = await narrateClosedDay(store, DAY, after, { client: scripted('One agent filed. LINK / USD read 11.43, updated 61m ago.') });
    assert.equal(r.state, 'ATTEMPTED');
    assert.equal(calls.dayRecord, 1);
    assert.equal(calls.writes, 1);
  });

  it('retries a settled day recorded as not configured once a client is available', async () => {
    const { store, calls } = storeWith({ ...narrated, outcome: 'NOT_CONFIGURED', standfirst: null, model: null, detail: 'no ANTHROPIC_API_KEY' });
    const after = new Date(daySettledAt(DAY).getTime() + 60_000);
    const saved = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-key-for-configured-check';
    try {
      const r = await narrateClosedDay(store, DAY, after, { client: scripted('One agent filed.') });
      assert.equal(r.state, 'ATTEMPTED');
      assert.equal(calls.writes, 1);
    } finally {
      if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = saved;
    }
  });
// 21 September 2026: two days failed on an empty credit balance. A failed
  // call is not a verdict on the day; once the account is fixed the day is
  // narrated, asked at most once an hour. A refusal still stands.
  it('asks a failed day again after an hour, not before, and never re-asks a refusal', async () => {
    const failedAt = new Date(daySettledAt(DAY).getTime() + 60_000);
    const failed: NarrationRecord = { ...narrated, outcome: 'MODEL_FAILED', standfirst: null, model: 'claude-opus-5', detail: 'API error 400: credit balance is too low', generatedAt: failedAt.toISOString() };
    const soon = new Date(failedAt.getTime() + 10 * 60_000);
    const later = new Date(failedAt.getTime() + NARRATION_RETRY_SECONDS * 1000 + 60_000);

    const early = storeWith(failed);
    assert.equal((await narrateClosedDay(early.store, DAY, soon, { client: scripted('One agent filed.') })).state, 'ALREADY_DONE');
    assert.equal(early.calls.writes, 0);

    const due = storeWith(failed);
    const r = await narrateClosedDay(due.store, DAY, later, { client: scripted('One agent filed.') });
    assert.equal(r.state, 'ATTEMPTED');
    assert.equal(due.calls.writes, 1);

    const refused = storeWith({ ...failed, outcome: 'REFUSED' });
    assert.equal((await narrateClosedDay(refused.store, DAY, later, { client: scripted('One agent filed.') })).state, 'ALREADY_DONE');
  });

  it('asks a refused day again only when the deployment names a different model', async () => {
    const saved = process.env.CURB_NARRATION_MODEL;
    const at = new Date(daySettledAt(DAY).getTime() + 60_000);
    const refusedBy5: NarrationRecord = { ...narrated, outcome: 'REFUSED', standfirst: null, model: 'claude-opus-5', detail: 'content filter', generatedAt: at.toISOString() };
    const soon = new Date(at.getTime() + 60_000);
    try {
      process.env.CURB_NARRATION_MODEL = 'claude-opus-5';
      const same = storeWith(refusedBy5);
      assert.equal((await narrateClosedDay(same.store, DAY, soon, { client: scripted('One agent filed.') })).state, 'ALREADY_DONE', 'the same model does not get asked twice');
      process.env.CURB_NARRATION_MODEL = 'claude-opus-4-8';
      const other = storeWith(refusedBy5);
      const r = await narrateClosedDay(other.store, DAY, soon, { client: scripted('One agent filed.') });
      assert.equal(r.state, 'ATTEMPTED', 'a different model is a new ask');
      assert.equal(other.calls.writes, 1);
    } finally {
      if (saved === undefined) delete process.env.CURB_NARRATION_MODEL;
      else process.env.CURB_NARRATION_MODEL = saved;
    }
  });

  it('asks the model the deployment names, and defaults to Claude Opus 5', async () => {
    const saved = process.env.CURB_NARRATION_MODEL;
    try {
      delete process.env.CURB_NARRATION_MODEL;
      assert.equal(narrationModel(), 'claude-opus-5');
      process.env.CURB_NARRATION_MODEL = 'claude-opus-4-6';
      assert.equal(narrationModel(), 'claude-opus-4-6');
      let asked = '';
      const client: NarrationClient = {
        messages: {
          async create(params: { model: string }) {
            asked = params.model;
            return scripted('One agent filed.').messages.create(params as never);
          },
        },
      } as unknown as NarrationClient;
      await narrateEdition(closed, { now: LATER, client });
      assert.equal(asked, 'claude-opus-4-6');
    } finally {
      if (saved === undefined) delete process.env.CURB_NARRATION_MODEL;
      else process.env.CURB_NARRATION_MODEL = saved;
    }
  });
});

describe('the OpenAI-format route, for a gateway that serves Claude only there', () => {
  const ENV = ['CURB_NARRATION_API', 'CURB_NARRATION_BASE_URL', 'CURB_NARRATION_API_KEY', 'CURB_NARRATION_MODEL', 'ANTHROPIC_API_KEY'] as const;
  function withEnv(values: Partial<Record<(typeof ENV)[number], string>>, run: () => Promise<void>) {
    const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
    for (const k of ENV) delete process.env[k];
    Object.assign(process.env, values);
    return run().finally(() => {
      for (const k of ENV) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });
  }
  function gateway(status: number, body: unknown, seen: { url?: string; auth?: string; model?: string } = {}) {
    return (async (url: string | URL | Request, init?: RequestInit) => {
      seen.url = String(url);
      seen.auth = (init?.headers as Record<string, string>)?.authorization;
      seen.model = JSON.parse(String(init?.body)).model;
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
  }
  const base = { CURB_NARRATION_API: 'openai', CURB_NARRATION_BASE_URL: 'https://gateway.test/v1/', ANTHROPIC_API_KEY: 'sk-test-gateway', CURB_NARRATION_MODEL: 'claude-opus-5' };

  it('asks /chat/completions with the key as a bearer, and keeps the model that answered', () =>
    withEnv(base, async () => {
      const seen: { url?: string; auth?: string; model?: string } = {};
      const r = await narrateEdition(closed, { now: LATER, fetch: gateway(200, { model: 'claude-opus-5', choices: [{ finish_reason: 'stop', message: { content: 'One agent filed.' } }] }, seen) });
      assert.equal(r.outcome, 'NARRATED');
      assert.equal(r.standfirst, 'One agent filed.');
      assert.equal(r.model, 'claude-opus-5');
      assert.equal(seen.url, 'https://gateway.test/v1/chat/completions');
      assert.equal(seen.auth, 'Bearer sk-test-gateway');
      assert.equal(seen.model, 'claude-opus-5');
    }));

  it('records a gateway error as a failed call, to be asked again', () =>
    withEnv(base, async () => {
      const r = await narrateEdition(closed, { now: LATER, fetch: gateway(404, { error: { message: 'model not found' } }) });
      assert.equal(r.outcome, 'MODEL_FAILED');
      assert.match(r.detail ?? '', /API error 404: model not found/);
    }));

  it('treats a content-filter stop as a refusal, which stands', () =>
    withEnv(base, async () => {
      const r = await narrateEdition(closed, { now: LATER, fetch: gateway(200, { model: 'claude-opus-5', choices: [{ finish_reason: 'content_filter', message: { content: '' } }] }) });
      assert.equal(r.outcome, 'REFUSED');
    }));

  it('puts the answer through the same gate as every agent', () =>
    withEnv(base, async () => {
      const r = await narrateEdition(closed, { now: LATER, fetch: gateway(200, { model: 'claude-opus-5', choices: [{ finish_reason: 'stop', message: { content: 'This token is guaranteed to reach a price target of 500.' } }] }) });
      assert.equal(r.outcome, 'POLICY_BLOCKED');
    }));

  it('is not configured without a base URL, and says which setting is missing', () =>
    withEnv({ CURB_NARRATION_API: 'openai', ANTHROPIC_API_KEY: 'sk-test' }, async () => {
      assert.equal(narrationConfigured(), false);
      const r = await narrateEdition(closed, { now: LATER });
      assert.equal(r.outcome, 'NOT_CONFIGURED');
      assert.match(r.detail ?? '', /CURB_NARRATION_BASE_URL/);
    }));
});

describe('the numbers a lede may repeat', () => {
  // A filing's own counts pass its gate as literals and are not kept as
  // declared figures. The narrator may repeat any number printed in a filing,
  // and nothing else.
  const withCount: DayRecord = {
    ...record,
    publications: [{ ...record.publications[0]!, body: 'LINK / USD: 11.43, updated 61m ago. 35 of 35 feeds answered.' }],
  };
  const edition = composeEdition(withCount, LATER);

  it('lets the lede repeat a count printed in a filing', async () => {
    const r = await narrateEdition(edition, { now: LATER, client: scripted('One agent filed: 35 of 35 feeds answered, and LINK / USD read 11.43.') });
    assert.equal(r.outcome, 'NARRATED', r.detail ?? '');
  });

  it('still stops a number printed nowhere in the record', async () => {
    const r = await narrateEdition(edition, { now: LATER, client: scripted('One agent filed: 4,000 feeds answered.') });
    assert.equal(r.outcome, 'POLICY_BLOCKED');
    assert.match(r.detail ?? '', /4,000/);
  });

  it('tells the model which numbers it may use', () => {
    assert.match(buildNarrationPrompt(edition).user, /Any number printed in the filings above may also be repeated/);
  });
});
