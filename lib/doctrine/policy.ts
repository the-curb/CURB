/**
 * Policy. This stage is code, not an instruction inside a prompt.
 *
 * A prompt is a request; this is a check. Every candidate output passes through
 * `screen()` before it can be published, and there is no way around it. If policy
 * blocks an output it is not published and the reason is recorded — a blocked
 * output is an event to look at, not a silence.
 *
 * The banned-claim list is the "Batas klaim" section of the editorial baseline,
 * expressed as something a machine enforces rather than something a writer
 * remembers. Tokenized equities is a domain where an over-claim is not a
 * marketing problem; it is a securities problem.
 */

import type { Reading } from './reading.ts';
import { isRead } from './reading.ts';

export type PolicyRule =
  | 'BANNED_CLAIM'
  | 'ADVICE_SHAPE'
  | 'FORECAST'
  | 'VERDICT'
  | 'ELIGIBILITY_OR_LEGAL'
  | 'UNSOURCED_FIGURE'
  | 'ABSENT_RENDERED_AS_VALUE';

export interface PolicyBreach {
  readonly rule: PolicyRule;
  /** The exact text that tripped the rule, so the reason is inspectable. */
  readonly matched: string;
  readonly explanation: string;
}

export type PolicyVerdict =
  | { readonly decision: 'ALLOW' }
  | { readonly decision: 'BLOCK'; readonly breaches: readonly PolicyBreach[] };

interface RuleSpec {
  readonly rule: PolicyRule;
  readonly pattern: RegExp;
  readonly explanation: string;
}

/**
 * Claims the editorial baseline forbids outright. These are not hedged, softened
 * or contextualised — they are removed. A reader who needs one of these answers
 * has to get it from the issuer, not from us.
 */
const BANNED_CLAIMS: readonly RuleSpec[] = [
  {
    rule: 'BANNED_CLAIM',
    pattern: /\bowns?\s+(?:the\s+)?underlying\s+shares?\b/i,
    explanation: 'A token holder’s claim is issuer-specific and is not share ownership.',
  },
  {
    rule: 'BANNED_CLAIM',
    pattern: /\bguaranteed\s+redemption\b/i,
    explanation: 'Redemption is an issuer term, subject to conditions we do not control.',
  },
  {
    rule: 'BANNED_CLAIM',
    pattern: /\b24\s*\/\s*7\s+liquidity\b/i,
    explanation: 'The chain runs continuously; the underlying market and its liquidity do not.',
  },
  {
    rule: 'BANNED_CLAIM',
    pattern: /\bautomatic\s+(?:stock\s+)?dividends?\b/i,
    explanation: 'Distributions depend on the issuer and the corporate-action adapter.',
  },
  {
    rule: 'BANNED_CLAIM',
    pattern: /\bbest\s+execution\b/i,
    explanation: 'A regulated term of art. Nothing here routes or executes an order.',
  },
  {
    rule: 'BANNED_CLAIM',
    pattern: /\brisk[-\s]?free\b/i,
    explanation: 'No position described here is risk-free.',
  },
  {
    rule: 'BANNED_CLAIM',
    pattern: /\bavailable\s+to\s+(?:anyone|everyone)\b/i,
    explanation: 'Eligibility is jurisdictional and issuer-specific. See the restricted list.',
  },
  {
    rule: 'BANNED_CLAIM',
    pattern: /\b(?:fully|1:1|one[-\s]to[-\s]one)\s+backed\b/i,
    explanation: 'Backing is an issuer attestation we can cite, never a claim we make.',
  },
];

/** Operational parameters. We publish structure; we never publish an instruction. */
const ADVICE_SHAPES: readonly RuleSpec[] = [
  {
    rule: 'ADVICE_SHAPE',
    pattern: /\b(?:entry|exit)\s+(?:point|price|level|zone)\b/i,
    explanation: 'No entries. Structure is published; the decision is not ours to shape.',
  },
  {
    rule: 'ADVICE_SHAPE',
    pattern: /\bstop[-\s]?loss\b|\btake[-\s]?profit\b/i,
    explanation: 'No stops, no targets — even when asked.',
  },
  {
    rule: 'ADVICE_SHAPE',
    pattern: /\b(?:price\s+target|target\s+price)\b/i,
    explanation: 'A price target is a forecast wearing a number.',
  },
  {
    rule: 'ADVICE_SHAPE',
    pattern: /\byou\s+should\s+(?:buy|sell|hold|short|accumulate|exit|enter)\b/i,
    explanation: 'Never an instruction to act.',
  },
  {
    rule: 'ADVICE_SHAPE',
    pattern: /\b(?:strong\s+)?(?:buy|sell)\s+(?:rating|recommendation|signal)\b/i,
    explanation: 'We do not rate and we do not recommend.',
  },
];

const FORECASTS: readonly RuleSpec[] = [
  {
    rule: 'FORECAST',
    pattern: /\b(?:will|should|is\s+(?:set|poised|expected))\s+to\s+(?:reach|hit|rally|climb|fall|drop|double)\b/i,
    explanation: 'No forecast of price, return or direction.',
  },
  {
    rule: 'FORECAST',
    pattern: /\bexpected\s+(?:return|yield|gain)\b|\bprojected\s+(?:return|price|value)\b/i,
    explanation: 'No expected return, yield or multiple.',
  },
  {
    rule: 'FORECAST',
    pattern: /\b\d+\s*x\s+(?:return|gain|upside)\b|\bAPY\b/i,
    explanation: 'No multiples and no yield figures. Nothing here produces income.',
  },
];

const VERDICTS: readonly RuleSpec[] = [
  {
    rule: 'VERDICT',
    pattern: /\b(?:is|are|looks?|appears?)\s+(?:completely\s+|totally\s+)?(?:safe|secure|legit|trustworthy)\b/i,
    explanation: 'We list what was checked. A safety verdict is the part we cannot verify.',
  },
  {
    rule: 'VERDICT',
    pattern: /\b(?:is|are)\s+a?\s*(?:scam|rug|rugpull|fraud|honeypot)\b/i,
    explanation: 'We list what was found. A fraud verdict is an accusation, not a measurement.',
  },
  {
    rule: 'VERDICT',
    pattern: /\baudited\s+and\s+safe\b|\bverified\s+safe\b/i,
    explanation: 'An audit is a scope, not a badge.',
  },
];

const ELIGIBILITY_AND_LEGAL: readonly RuleSpec[] = [
  {
    rule: 'ELIGIBILITY_OR_LEGAL',
    pattern: /\byou\s+(?:are|will\s+be)\s+eligible\b/i,
    explanation: 'Eligibility is determined by the issuer, not by this system.',
  },
  {
    rule: 'ELIGIBILITY_OR_LEGAL',
    pattern: /\b(?:this\s+)?is\s+not\s+a\s+security\b/i,
    explanation: 'A legal characterisation we are not positioned to make.',
  },
  {
    rule: 'ELIGIBILITY_OR_LEGAL',
    pattern: /\btax[-\s]?free\b|\bno\s+tax\s+(?:liability|consequences?)\b/i,
    explanation: 'No tax advice, in either direction.',
  },
  {
    rule: 'ELIGIBILITY_OR_LEGAL',
    pattern: /\bwallet\s+login\s+(?:is|counts\s+as)\s+KYC\b/i,
    explanation: 'A wallet signature proves control of a key. It is not identity verification.',
  },
];

const ALL_RULES: readonly RuleSpec[] = [
  ...BANNED_CLAIMS,
  ...ADVICE_SHAPES,
  ...FORECASTS,
  ...VERDICTS,
  ...ELIGIBILITY_AND_LEGAL,
];

/**
 * A figure the producer declares it measured, with where it came from. The
 * narration may only contain numbers that appear in this set.
 */
export interface DeclaredFigure {
  /** Exactly as it will appear in the text, e.g. "47.67%", "$77,928", "63". */
  readonly token: string;
  readonly source: string;
  readonly retrievedAt: string;
}

export interface ScreenInput {
  /** The sentence the model wrote. */
  readonly text: string;
  /** Every figure the producer measured, with provenance. */
  readonly figures?: readonly DeclaredFigure[];
  /**
   * Literals that are allowed to appear without provenance: counts of our own
   * things ("8 agents"), list ordinals, years. Keep this list short and boring.
   */
  readonly allowedLiterals?: readonly string[];
  /**
   * Readings referenced by the output. Any UNREAD reading whose label appears in
   * the text next to a number is a rendered absence — the exact bug this whole
   * system exists to prevent.
   */
  readonly readings?: Readonly<Record<string, Reading<unknown>>>;
}

/** Years and simple list ordinals never need a source. */
const INHERENTLY_ALLOWED = /^(?:19|20)\d{2}$|^(?:[1-9]|10)$/;

/** Numeric-looking runs: 1,234.56 · 47.67% · $77,928 · 4663 */
const NUMERIC_RUN = /[$€£]?\d[\d,]*(?:\.\d+)?%?/g;

/**
 * Timestamps are coordinates, not measurements.
 *
 * "13:30 UTC on 2026-09-11" makes no claim about the size of anything — it says
 * when. Its provenance is the reading's own `retrievedAt`, not a declared figure,
 * so requiring it to be declared would push authors to stuff clock digits into
 * the figure set and blunt the gate for the numbers that do matter.
 *
 * Masked before extraction: ISO-8601 instants, calendar dates, and clock times.
 * Everything else still has to carry a source.
 */
const TIME_COORDINATE =
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?|\d{4}-\d{2}-\d{2}|\b\d{1,2}:\d{2}(?::\d{2})?\b/g;

/**
 * Hex identifiers are names, not magnitudes.
 *
 * An address, a slot, a transaction hash or a code hash makes no claim about the
 * size of anything — it points at a thing. Left unmasked, one address would
 * scatter a dozen digit runs across the gate and force an author to declare
 * "360" and "0400" as if they were measurements, which is how a gate gets
 * switched off. The elided form (0x5fc5…d168) is masked with it.
 */
const HEX_IDENTIFIER = /0x[0-9a-fA-F]+(?:\s*(?:…|\.\.\.)\s*[0-9a-fA-F]+)?/g;

function maskCoordinates(text: string): string {
  return text.replace(HEX_IDENTIFIER, ' ').replace(TIME_COORDINATE, ' ');
}

function normaliseFigure(raw: string): string {
  return raw.replace(/[$€£,\s]/g, '').replace(/%$/, '');
}

/**
 * A number without a source is not published. This is checked before publication,
 * not asserted afterwards.
 */
function screenFigures(input: ScreenInput): PolicyBreach[] {
  const declared = new Set(
    (input.figures ?? []).map((f) => normaliseFigure(f.token)),
  );
  const allowed = new Set(
    (input.allowedLiterals ?? []).map((l) => normaliseFigure(l)),
  );
  const breaches: PolicyBreach[] = [];
  const seen = new Set<string>();
  const scannable = maskCoordinates(input.text);

  for (const match of scannable.matchAll(NUMERIC_RUN)) {
    const raw = match[0];
    const norm = normaliseFigure(raw);
    if (seen.has(norm)) continue;
    seen.add(norm);
    if (declared.has(norm) || allowed.has(norm) || INHERENTLY_ALLOWED.test(norm)) continue;
    breaches.push({
      rule: 'UNSOURCED_FIGURE',
      matched: raw,
      explanation:
        'This number is not in the declared figure set. A figure that cannot carry its source and its time does not go out.',
    });
  }
  return breaches;
}

/**
 * An UNREAD reading must never reach the reader as a number. If a producer hands
 * us an absence and a figure for the same label, the figure is invented.
 */
function screenAbsences(input: ScreenInput): PolicyBreach[] {
  const breaches: PolicyBreach[] = [];
  for (const [label, reading] of Object.entries(input.readings ?? {})) {
    if (isRead(reading)) continue;
    const nearNumber = new RegExp(
      `${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^.\\n]{0,24}?\\d`,
      'i',
    );
    if (nearNumber.test(input.text)) {
      breaches.push({
        rule: 'ABSENT_RENDERED_AS_VALUE',
        matched: label,
        explanation: `"${label}" is UNREAD (${reading.reason}) but the text puts a number beside it. An absence renders as a dash, never as a value.`,
      });
    }
  }
  return breaches;
}

/**
 * The gate. Nothing reaches a public channel without passing through here.
 */
/**
 * The figures inside a piece of text that is about to be printed — a failure
 * detail, mostly: "HTTP 429", "logs matched by query exceeds limit of 10000".
 * Those numbers came from the source named, at the time named, and printing
 * them undeclared blocks the whole filing: the Tally lost a filing to the
 * "429" in a rate-limit reason, and Counsel would have lost one to "11d ago".
 * Declare what the text carries, from where it came, and the gate agrees.
 */
export function figuresIn(text: string, source: string, retrievedAt: string): DeclaredFigure[] {
  const out: DeclaredFigure[] = [];
  const seen = new Set<string>();
  for (const match of maskCoordinates(text).matchAll(NUMERIC_RUN)) {
    const norm = normaliseFigure(match[0]);
    if (seen.has(norm) || INHERENTLY_ALLOWED.test(norm)) continue;
    seen.add(norm);
    // A trailing comma or full stop is punctuation, not a thousands separator.
    out.push({ token: match[0].replace(/[,.]+$/, ''), source, retrievedAt });
  }
  return out;
}

export function screen(input: ScreenInput): PolicyVerdict {
  const breaches: PolicyBreach[] = [];

  for (const spec of ALL_RULES) {
    const found = input.text.match(spec.pattern);
    if (found) {
      breaches.push({ rule: spec.rule, matched: found[0], explanation: spec.explanation });
    }
  }
  breaches.push(...screenAbsences(input));
  breaches.push(...screenFigures(input));

  return breaches.length === 0 ? { decision: 'ALLOW' } : { decision: 'BLOCK', breaches };
}

/** Rule count, published on the method page so the list is not a black box. */
export const RULE_COUNT = ALL_RULES.length;

export const RULE_INDEX: readonly { rule: PolicyRule; explanation: string }[] = ALL_RULES.map(
  (r) => ({ rule: r.rule, explanation: r.explanation }),
);
