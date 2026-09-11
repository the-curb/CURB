/**
 * THE REGISTRAR — token provenance and authority on Robinhood Chain.
 *
 * The output is three blocks and the third is never empty for convenience:
 *
 *   CHECKED               what the chain answered, deterministically
 *   COULD NOT BE CHECKED  what was asked and did not answer
 *   STAYS UNKNOWN         what reading the chain cannot establish at all
 *
 * Most reports flatter the reader with a conclusion. This one refuses, because
 * the conclusion is the part that cannot be verified — and a green badge on an
 * upgradeable proxy describes code that can be replaced the next block.
 */

import type { Producer, ProducerResult } from '../runtime.ts';
import type { DeclaredFigure } from '../../doctrine/policy.ts';
import { isRead, type Reading } from '../../doctrine/reading.ts';
import { readBlockNumber, readCode } from '../../chain/rpc.ts';
import { activeNetwork } from '../../chain/networks.ts';
import {
  readPaused,
  readOwner,
  readProxyState,
  readTokenString,
  readTokenUint,
} from '../../chain/token-read.ts';
import { formatUnits } from '../../chain/abi.ts';
import { TOKENS, UNKNOWABLE_FROM_CHAIN, type TokenRecord } from '../../chain/tokens.ts';

const INTERVAL = 24 * 3600;

/** 0x5fc5360D…716F1d168 → 0x5fc5…d168, so a headline stays readable. */
function elide(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Audit one token per run, choosing whichever has gone longest unreported. */
async function nextToken(
  store: Parameters<Producer>[0]['store'],
): Promise<TokenRecord> {
  const recent = await store.recentPublications(50);
  const reported = recent
    .filter((p) => p.agentId === 'registrar')
    .map((p) => p.headline);

  for (const token of TOKENS) {
    if (!reported.some((headline) => headline.includes(token.observedSymbol))) return token;
  }
  // Everything has been reported at least once: take the least recent.
  const oldestFirst = [...TOKENS].sort((a, b) => {
    const ai = reported.findIndex((h) => h.includes(a.observedSymbol));
    const bi = reported.findIndex((h) => h.includes(b.observedSymbol));
    return bi - ai;
  });
  return oldestFirst[0] ?? TOKENS[0]!;
}

/** "could not be checked" needs the reason, not just the absence. */
function whyUnread(reading: Reading<unknown>, label: string): string {
  if (isRead(reading)) return '';
  const detail = reading.detail ? ` ${reading.detail}` : '';
  return `— ${label}: ${reading.reason}.${detail}`;
}

export const registrarProducer: Producer = async ({ now, store }): Promise<ProducerResult> => {
  const token = await nextToken(store);
  const network = activeNetwork();
  const opts = { intervalSeconds: INTERVAL };

  const [block, code, name, symbol, decimals, supply, proxy, paused, owner] = await Promise.all([
    readBlockNumber(opts),
    readCode(token.address, opts),
    readTokenString(token.address, 'name', opts),
    readTokenString(token.address, 'symbol', opts),
    readTokenUint(token.address, 'decimals', opts),
    readTokenUint(token.address, 'totalSupply', opts),
    readProxyState(token.address, opts),
    readPaused(token.address, opts),
    readOwner(token.address, opts),
  ]);

  const figures: DeclaredFigure[] = [];
  const checked: string[] = [];
  const couldNotCheck: string[] = [];

  // Four source groups, matching the Registrar's declared sourcesExpected.
  let sourcesReached = 0;
  let oldestInputAt: Date | null = null;
  const note = (reading: Reading<unknown>) => {
    if (!isRead(reading)) return;
    const at = new Date(reading.retrievedAt);
    if (oldestInputAt === null || at < oldestInputAt) oldestInputAt = at;
  };
  [block, code, name, symbol, decimals, supply, proxy, paused, owner].forEach(note);

  // ── group 1: is there a contract here at all ───────────────────────────────
  if (isRead(code)) {
    sourcesReached += 1;
    if (code.value.hasCode) {
      const size = code.value.sizeBytes.toLocaleString('en-US');
      figures.push({ token: size, source: `${network.label} · eth_getCode`, retrievedAt: code.retrievedAt });
      checked.push(`— Contract code is present at the address: ${size} bytes.`);
    } else {
      checked.push('— No contract code at this address. Nothing below would describe a token.');
    }
  } else {
    couldNotCheck.push(whyUnread(code, 'contract code'));
  }

  // ── group 2: metadata ──────────────────────────────────────────────────────
  if (isRead(name) && isRead(symbol) && isRead(decimals)) {
    sourcesReached += 1;
    const dec = decimals.value.toString();
    figures.push({ token: dec, source: `${network.label} · decimals()`, retrievedAt: decimals.retrievedAt });
    checked.push(
      `— The contract answers its own metadata calls: name "${name.value}", symbol "${symbol.value}", decimals ${dec}.`,
    );
    if (Number(decimals.value) !== token.observedDecimals) {
      checked.push('— Decimals differ from the value recorded for this address. Every amount derived from the older figure is wrong.');
    }
  } else {
    for (const [reading, label] of [[name, 'name()'], [symbol, 'symbol()'], [decimals, 'decimals()']] as const) {
      const line = whyUnread(reading, label);
      if (line) couldNotCheck.push(line);
    }
  }

  // ── group 3: supply ────────────────────────────────────────────────────────
  if (isRead(supply) && isRead(decimals)) {
    sourcesReached += 1;
    const formatted = formatUnits(supply.value, Number(decimals.value));
    figures.push({ token: formatted, source: `${network.label} · totalSupply()`, retrievedAt: supply.retrievedAt });
    const atBlock = isRead(block) ? ` at block ${block.value.toLocaleString('en-US')}` : '';
    if (isRead(block)) {
      figures.push({
        token: block.value.toLocaleString('en-US'),
        source: `${network.label} · eth_blockNumber`,
        retrievedAt: block.retrievedAt,
      });
    }
    checked.push(`— Total supply reported by the contract${atBlock}: ${formatted}.`);
  } else {
    const line = whyUnread(supply, 'totalSupply()');
    if (line) couldNotCheck.push(line);
  }

  // ── group 4: proxy and upgrade authority ───────────────────────────────────
  if (isRead(proxy)) {
    sourcesReached += 1;
    const state = proxy.value;
    if (state.implementation === null) {
      checked.push('— The standard implementation slot is empty: this address is not an upgradeable proxy of that shape.');
    } else {
      checked.push(
        state.pattern === 'transparent'
          ? `— Upgradeable proxy. The implementation slot points at ${state.implementation}, and the admin slot is set, which is the transparent pattern.`
          : `— Upgradeable proxy. The implementation slot points at ${state.implementation}, and the admin slot is empty, which is the pattern where the upgrade function lives in the implementation itself.`,
      );
      const changed =
        state.implementation.toLowerCase() !== token.recordedImplementation.toLowerCase();
      checked.push(
        changed
          ? `— The implementation has CHANGED since this address was last recorded by hand, when it pointed at ${token.recordedImplementation}. Findings recorded against the previous implementation describe code that is no longer running.`
          : '— The implementation is the same one recorded when this address was last checked by hand.',
      );
    }
  } else {
    couldNotCheck.push(whyUnread(proxy, 'proxy slots'));
  }

  // Tri-state, and the third state is the point.
  if (isRead(paused)) {
    checked.push(`— The contract exposes a pause flag, and it reads ${paused.value ? 'paused' : 'not paused'} at this block.`);
  } else {
    couldNotCheck.push(
      '— pause flag: the contract returned no data for it. That is not a statement that the token is unpaused; it means the question was not answered.',
    );
  }
  if (isRead(owner)) {
    checked.push(`— An owner address is exposed: ${owner.value}.`);
  } else {
    couldNotCheck.push('— owner: the contract returned no data for it. The absence of this function does not mean the contract is ownerless.');
  }

  if (sourcesReached === 0) {
    return { publication: null, sourcesReached, oldestInputAt };
  }

  const body = [
    'CHECKED',
    ...checked,
    '',
    'COULD NOT BE CHECKED',
    ...(couldNotCheck.length > 0
      ? couldNotCheck
      : ['— Every question put to the chain on this run was answered.']),
    '',
    'STAYS UNKNOWN',
    ...UNKNOWABLE_FROM_CHAIN.map((line) => `— ${line}`),
  ].join('\n');

  return {
    publication: {
      headline: `REGISTRY · ${token.observedSymbol} · ${elide(token.address)}`,
      body,
      figures,
      readings: {
        'pause flag': paused,
        owner,
        'Total supply': supply,
      },
      // Standard numbers, not measurements: EIP-1967 names a specification.
      allowedLiterals: ['1967'],
    },
    sourcesReached,
    oldestInputAt,
  };
};
