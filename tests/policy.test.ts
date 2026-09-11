import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { figuresIn, screen, type DeclaredFigure } from '../lib/doctrine/policy.ts';
import { read, unread } from '../lib/doctrine/reading.ts';
import { UNKNOWABLE_FROM_CHAIN } from '../lib/chain/tokens.ts';

const figure = (token: string): DeclaredFigure => ({
  token,
  source: 'coingecko',
  retrievedAt: '2026-09-10T22:29:49.255Z',
});

function blockedRules(text: string, figures: readonly DeclaredFigure[] = []) {
  const verdict = screen({ text, figures });
  return verdict.decision === 'BLOCK' ? verdict.breaches.map((b) => b.rule) : [];
}

describe('banned claims', () => {
  const cases: readonly [string, string][] = [
    ['You own the underlying shares.', 'share ownership'],
    ['Guaranteed redemption at any time.', 'guaranteed redemption'],
    ['Enjoy 24/7 liquidity on every position.', '24/7 liquidity'],
    ['Holders receive automatic dividends.', 'automatic dividends'],
    ['We route for best execution.', 'best execution'],
    ['A risk-free way to hold equity exposure.', 'risk-free'],
    ['Available to anyone with a wallet.', 'available to anyone'],
    ['Every token is fully backed.', 'fully backed'],
  ];

  for (const [text, label] of cases) {
    it(`blocks ${label}`, () => {
      assert.ok(blockedRules(text).includes('BANNED_CLAIM'), `expected a block for: ${text}`);
    });
  }
});

describe('advice, forecasts and verdicts', () => {
  it('blocks an entry point', () => {
    assert.ok(blockedRules('A reasonable entry point is forming.').includes('ADVICE_SHAPE'));
  });

  it('blocks a stop-loss', () => {
    assert.ok(blockedRules('Set a stop-loss below the range.').includes('ADVICE_SHAPE'));
  });

  it('blocks an instruction to act', () => {
    assert.ok(blockedRules('You should buy while it is quiet.').includes('ADVICE_SHAPE'));
  });

  it('blocks a directional forecast', () => {
    assert.ok(blockedRules('The token is poised to rally into the close.').includes('FORECAST'));
  });

  it('blocks a yield claim', () => {
    assert.ok(blockedRules('Holders earn APY on deposits.').includes('FORECAST'));
  });

  it('blocks a safety verdict', () => {
    assert.ok(blockedRules('The contract is safe.').includes('VERDICT'));
  });

  it('blocks a fraud verdict', () => {
    assert.ok(blockedRules('This one is a rug.').includes('VERDICT'));
  });

  it('blocks an eligibility determination', () => {
    assert.ok(
      blockedRules('You are eligible to hold this instrument.').includes('ELIGIBILITY_OR_LEGAL'),
    );
  });

  it('blocks a legal characterisation', () => {
    assert.ok(blockedRules('This is not a security.').includes('ELIGIBILITY_OR_LEGAL'));
  });
});

describe('the unsourced-figure gate', () => {
  it('blocks a number that was never declared', () => {
    assert.ok(blockedRules('Realised volatility ran 47.67% over the month.').includes(
      'UNSOURCED_FIGURE',
    ));
  });

  it('allows the same number once it carries a source', () => {
    const verdict = screen({
      text: 'Realised volatility ran 47.67% over the month.',
      figures: [figure('47.67%')],
    });
    assert.equal(verdict.decision, 'ALLOW');
  });

  it('matches a declared figure through its formatting', () => {
    const verdict = screen({
      text: 'The chain stood at block 59,786,108.',
      figures: [figure('59,786,108')],
    });
    assert.equal(verdict.decision, 'ALLOW');
  });

  it('treats timestamps as coordinates, not measurements', () => {
    const verdict = screen({
      text: 'The next regular open is 2026-09-11T13:30:00.000Z, and the bell rings at 09:30 local.',
      figures: [],
    });
    assert.equal(verdict.decision, 'ALLOW');
  });

  it('still blocks a magnitude hiding next to a timestamp', () => {
    assert.ok(
      blockedRules('At 09:30 the desk counted 412 transfers.').includes('UNSOURCED_FIGURE'),
    );
  });
});

describe('absence must not be dressed as a value', () => {
  it('blocks a number printed beside an unread reading', () => {
    const verdict = screen({
      text: 'Holder concentration stands at 42%.',
      figures: [figure('42%')],
      readings: { 'Holder concentration': unread('SOURCE_NOT_CONNECTED') },
    });
    assert.equal(verdict.decision, 'BLOCK');
    assert.ok(
      verdict.decision === 'BLOCK' &&
        verdict.breaches.some((b) => b.rule === 'ABSENT_RENDERED_AS_VALUE'),
    );
  });

  it('allows the same label when the reading was actually taken', () => {
    const reading = read({
      value: 42,
      source: 'solana rpc',
      retrievedAt: new Date(),
      intervalSeconds: 3600,
    });
    const verdict = screen({
      text: 'Holder concentration stands at 42%.',
      figures: [figure('42%')],
      readings: { 'Holder concentration': reading },
    });
    assert.equal(verdict.decision, 'ALLOW');
  });
});

describe('hex identifiers are names, not magnitudes', () => {
  it('allows a full contract address without declaring its digits', () => {
    const verdict = screen({
      text: 'The implementation slot points at 0x68184C449E1a8f34fA18d289737129FD27B66f8F.',
      figures: [],
    });
    assert.equal(verdict.decision, 'ALLOW');
  });

  it('allows the elided form used in headlines', () => {
    const verdict = screen({
      text: 'REGISTRY · USDG · 0x5fc5…d168 was read at this block.',
      figures: [],
    });
    assert.equal(verdict.decision, 'ALLOW');
  });

  it('still blocks a magnitude sitting next to an address', () => {
    assert.ok(
      blockedRules('0x5fc5…d168 holds 4,812 accounts.').includes('UNSOURCED_FIGURE'),
    );
  });
});

describe("the agents' own fixed prose passes their own gate", () => {
  // The Registrar prints this block on every audit. If a rule ever starts
  // catching it, that is found here rather than as a POLICY_BLOCKED in production.
  it('clears the Registrar’s third block', () => {
    for (const line of UNKNOWABLE_FROM_CHAIN) {
      const verdict = screen({ text: line, figures: [] });
      assert.equal(
        verdict.decision,
        'ALLOW',
        `blocked: ${line}\n${verdict.decision === 'BLOCK' ? JSON.stringify(verdict.breaches) : ''}`,
      );
    }
  });
});

describe('clean copy', () => {
  it('passes prose that measures and does not conclude', () => {
    const verdict = screen({
      text: 'The exchange is shut. The chain has not paused, and a price carried across a closed market is reported here with its age.',
      figures: [],
    });
    assert.equal(verdict.decision, 'ALLOW');
  });
});

describe('figuresIn — the numbers a failure line carries', () => {
  it('declares status codes and limits from a refusal, sourced to the source that refused', () => {
    const figures = figuresIn('SOURCE_UNREACHABLE — HTTP 429; rpc error -32000: logs matched by query exceeds limit of 10000', 'Robinhood Chain · as reported in a refusal', '2026-09-11T17:16:00.000Z');
    assert.deepEqual(figures.map((f) => f.token).sort(), ['10000', '32000', '429'].sort());
    assert.ok(figures.every((f) => f.source === 'Robinhood Chain · as reported in a refusal'));
  });

  it('skips coordinates, hex identifiers, years and small ordinals, and repeats', () => {
    const figures = figuresIn('at 2026-09-11T17:16:00Z block 0x5fc5…d168 tried 3 times in 2026, HTTP 503, HTTP 503', 's', 't');
    assert.deepEqual(figures.map((f) => f.token), ['503']);
  });

  it('makes the Tally’s rate-limited gap line pass the gate — the filing that was lost', () => {
    const line = '— Stock tokens, blocks 60,338,000 to 60,338,499: not answered (SOURCE_UNREACHABLE — HTTP 429). Counts for this group exclude them; that is a gap, not a quiet stretch.';
    const blocked = screen({ text: line, figures: [{ token: '60,338,000', source: 's', retrievedAt: 't' }, { token: '60,338,499', source: 's', retrievedAt: 't' }] });
    assert.equal(blocked.decision, 'BLOCK');
    const declared = screen({
      text: line,
      figures: [{ token: '60,338,000', source: 's', retrievedAt: 't' }, { token: '60,338,499', source: 's', retrievedAt: 't' }, ...figuresIn(line, 'Robinhood Chain · as reported in a refusal', 't')],
    });
    assert.equal(declared.decision, 'ALLOW', JSON.stringify(declared));
  });
});
