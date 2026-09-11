/**
 * THE ARCHIVIST — corporate actions, read from the chain rather than announced.
 *
 * A stock token tracks the total return of its underlying: reinvested dividends
 * raise a multiplier, so one token comes to represent more than one share and
 * the feed price drifts above the headline share price. The multiplier is
 * readable on chain, and so is the next one, with the moment it takes effect.
 *
 * That makes a corporate action something this system can observe directly
 * instead of waiting for a notice — and it makes the failure case observable
 * too. A split the token did not follow is the whole story.
 *
 * `newUIMultiplier()` with `effectiveAt()` is the only forward-looking pair in
 * this codebase, and it is not a forecast: it is a change the issuer has already
 * published, with the time it applies.
 */

import type { Producer, ProducerResult } from '../runtime.ts';
import type { DeclaredFigure } from '../../doctrine/policy.ts';
import type { ObservationRecord } from '../../store/types.ts';
import { isRead, type Reading } from '../../doctrine/reading.ts';
import { activeNetwork } from '../../chain/networks.ts';
import { formatUnits } from '../../chain/abi.ts';
import {
  formatMultiplier,
  MULTIPLIER_SCALE,
  readPendingMultiplier,
  readUiMultiplier,
} from '../../chain/oracle.ts';
import { readTokenUint } from '../../chain/token-read.ts';
import { STOCK_TOKEN_COVERAGE } from '../../chain/feeds.ts';
import { TOKENS } from '../../chain/tokens.ts';

const INTERVAL = 6 * 3600;

/** Questions a corporate action raises that bytecode cannot answer. */
const NOT_DERIVABLE = [
  'Why a multiplier moved. The chain records that it changed, not whether the cause was a dividend, a split, or a correction. The issuer’s notice is the only place that says.',
  'Whether a corporate action that should have moved a multiplier failed to. Absence of a change is not evidence that nothing happened — it is the case this agent exists to make visible, and it needs the issuer’s calendar to confirm.',
  'The tax or entitlement consequences of any action recorded here.',
] as const;

export const archivistProducer: Producer = async ({ store }): Promise<ProducerResult> => {
  const network = activeNetwork();
  const opts = { intervalSeconds: INTERVAL };

  const figures: DeclaredFigure[] = [];
  /** Keyed by the label the narration uses, so a printed absence is catchable. */
  const multiplierReadings: Record<string, Reading<bigint>> = {};
  const observations: ObservationRecord[] = [];
  const observed: string[] = [];
  const notExposed: string[] = [];
  let sourcesReached = 0;
  let oldestInputAt: Date | null = null;

  for (const token of TOKENS) {
    const [multiplier, pending, supply, decimals] = await Promise.all([
      readUiMultiplier(token.address, opts),
      readPendingMultiplier(token.address, opts),
      readTokenUint(token.address, 'totalSupply', opts),
      readTokenUint(token.address, 'decimals', opts),
    ]);

    // ── supply, which every token exposes ───────────────────────────────────
    if (isRead(supply) && isRead(decimals)) {
      sourcesReached += 1;
      const at = new Date(supply.retrievedAt);
      if (oldestInputAt === null || at < oldestInputAt) oldestInputAt = at;

      const scale = Number(decimals.value);
      const formatted = formatUnits(supply.value, scale);
      const current = Number(supply.value) / 10 ** scale;

      // Null means the earlier reading could not be read — which is not the
      // same as there being no earlier reading, and produces a different line.
      const previousRead = await store.observations(`${token.key}:supply`, 2);
      const previous = previousRead.state === 'UNREAD' ? null : previousRead.value;
      const last = previous ? previous[previous.length - 1] : undefined;
      observations.push({
        key: `${token.key}:supply`,
        observedAt: supply.retrievedAt,
        value: current,
        source: `${network.label} · ${token.observedSymbol} totalSupply()`,
      });

      figures.push({
        token: formatted,
        source: `${network.label} · ${token.observedSymbol} totalSupply()`,
        retrievedAt: supply.retrievedAt,
      });

      if (previous === null) {
        observed.push(
          `— ${token.observedSymbol}: supply ${formatted}. The earlier readings could not be read back, so no comparison is made — this is not a statement that the supply is unchanged.`,
        );
      } else if (last === undefined) {
        observed.push(
          `— ${token.observedSymbol}: supply ${formatted}. This is the first reading kept for this token, so there is nothing yet to compare it against.`,
        );
      } else if (last.value === current) {
        observed.push(
          `— ${token.observedSymbol}: supply ${formatted}, unchanged since the previous reading.`,
        );
      } else {
        const direction = current > last.value ? 'issued' : 'redeemed or burned';
        observed.push(
          `— ${token.observedSymbol}: supply ${formatted}. It moved since the previous reading, so units were ${direction} in between. The chain records the movement; it does not record who asked for it or why.`,
        );
      }
    } else {
      notExposed.push(
        `— ${token.observedSymbol}: total supply could not be read (${isRead(supply) ? 'decimals unreadable' : supply.reason}), so no supply figure is given.`,
      );
    }

    // ── the multiplier, which only a stock token exposes ─────────────────────
    multiplierReadings[`${token.observedSymbol} shares per token`] = multiplier;

    if (isRead(multiplier)) {
      sourcesReached += 1;
      const shown = formatMultiplier(multiplier.value);
      const current = Number(multiplier.value) / Number(MULTIPLIER_SCALE);
      const previousRead = await store.observations(`${token.key}:multiplier`, 2);
      const previous = previousRead.state === 'UNREAD' ? null : previousRead.value;
      const last = previous ? previous[previous.length - 1] : undefined;

      observations.push({
        key: `${token.key}:multiplier`,
        observedAt: multiplier.retrievedAt,
        value: current,
        source: `${network.label} · ${token.observedSymbol} uiMultiplier()`,
      });
      figures.push({
        token: shown,
        source: `${network.label} · ${token.observedSymbol} uiMultiplier()`,
        retrievedAt: multiplier.retrievedAt,
      });

      observed.push(
        previous === null
          ? `— ${token.observedSymbol}: shares per token ${shown}. The earlier readings could not be read back, so no comparison is made — this is not a statement that the multiplier held steady.`
          : last === undefined || last.value === current
            ? `— ${token.observedSymbol}: shares per token ${shown}${last === undefined ? ', first reading kept' : ', unchanged since the previous reading'}.`
            : `— ${token.observedSymbol}: shares per token ${shown}. The multiplier MOVED since the previous reading: one token now represents a different number of shares, and any figure derived from the older value is wrong by that ratio.`,
      );

      if (isRead(pending.next) && pending.next.value !== multiplier.value) {
        const nextShown = formatMultiplier(pending.next.value);
        figures.push({
          token: nextShown,
          source: `${network.label} · ${token.observedSymbol} newUIMultiplier()`,
          retrievedAt: pending.next.retrievedAt,
        });
        const when =
          isRead(pending.effectiveAt) && pending.effectiveAt.value > 0n
            ? new Date(Number(pending.effectiveAt.value) * 1000).toISOString()
            : null;
        observed.push(
          when === null
            ? `— ${token.observedSymbol}: a multiplier change to ${nextShown} is published but its effective time could not be read, so when it applies is reported as absent.`
            : `— ${token.observedSymbol}: a multiplier change to ${nextShown} is already published and applies at ${when}. This is a scheduled change the issuer has recorded, not a projection.`,
        );
      }
    } else {
      notExposed.push(
        `— ${token.observedSymbol}: no shares-per-token multiplier is exposed (${multiplier.reason}). This contract is not a stock token, so there is no corporate-action multiplier to follow.`,
      );
    }
  }

  if (sourcesReached === 0) {
    return {
      publication: null,
      sourcesReached,
      oldestInputAt,
      observations,
      note: notExposed.join(' ').slice(0, 400) || 'no token in the registry answered',
    };
  }

  figures.push(
    { token: String(STOCK_TOKEN_COVERAGE.tokensInRegistry), source: STOCK_TOKEN_COVERAGE.registry, retrievedAt: STOCK_TOKEN_COVERAGE.observedAt },
    { token: String(TOKENS.length), source: TOKENS[0]?.source ?? 'the settlement-asset registry', retrievedAt: TOKENS[0]?.observedAt ?? STOCK_TOKEN_COVERAGE.observedAt },
  );

  const body = [
    'OBSERVED',
    ...(observed.length > 0 ? observed : ['— Nothing in the registry answered with a figure.']),
    '',
    'NOT EXPOSED BY THESE CONTRACTS',
    ...(notExposed.length > 0
      ? notExposed
      : ['— Every field this agent reads was exposed by every token in the registry.']),
    `— Stock tokens: the issuer registry lists ${STOCK_TOKEN_COVERAGE.tokensInRegistry} on this chain and none was read on this run. The multiplier checks above ran against the ${TOKENS.length} contracts in the settlement-asset registry only.`,
    '',
    'NOT DERIVABLE FROM THE CHAIN',
    ...NOT_DERIVABLE.map((line) => `— ${line}`),
  ].join('\n');

  return {
    publication: {
      headline: `ACTIONS · ${TOKENS.length} contracts read`,
      body,
      figures,
      // The real readings, so the gate can catch an absence printed as a value.
      readings: multiplierReadings,
    },
    sourcesReached,
    oldestInputAt,
    observations,
  };
};
