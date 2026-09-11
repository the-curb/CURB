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
});
