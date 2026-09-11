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
 *
 * Two things happen on every run. The stock-token beacon is read: every one of
 * the issuer's stock tokens is a proxy on that single beacon, so its
 * implementation() is one address that describes the code behind all of them,
 * and a change there is a change to all of them in one transaction. Then one
 * token gets the full audit — the settlement assets and the feed-priced stock
 * tokens in rotation, whichever has gone longest unreported.
 */

import type { Producer, ProducerResult } from '../runtime.ts';
import type { DeclaredFigure } from '../../doctrine/policy.ts';
import { isRead, type Reading } from '../../doctrine/reading.ts';
import { readBlockNumber, readCode, rpcCall } from '../../chain/rpc.ts';
import { activeNetwork } from '../../chain/networks.ts';
import {
  readPaused,
  readOwner,
  readProxyState,
  readTokenString,
  readTokenUint,
} from '../../chain/token-read.ts';
import { decodeAddressWord, formatUnits } from '../../chain/abi.ts';
import { keccak256, selector, toHex } from '../../chain/keccak.ts';
import { TOKENS, UNKNOWABLE_FROM_CHAIN } from '../../chain/tokens.ts';
import { STOCK_TOKENS, STOCK_TOKEN_BEACON, STOCK_TOKENS_SOURCE } from '../../chain/stock-tokens.ts';
import { FEED_DIRECTORY_SOURCE } from '../../chain/feed-directory.ts';
import { diffFeeds, diffTokens, fetchListedFeeds, fetchListedTokens } from '../../chain/capture-drift.ts';
import type { SnapshotRecord } from '../../store/types.ts';

const INTERVAL = 24 * 3600;

/** implementation() — derived from the signature, not remembered. */
const IMPLEMENTATION_SELECTOR = selector('implementation()');

/** 0x5fc5360D…716F1d168 → 0x5fc5…d168, so a headline stays readable. */
function elide(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * One thing to audit, whichever registry it came from. The tripwire differs by
 * proxy shape: a settlement asset records the implementation its slot pointed
 * at; a stock token records the beacon it delegates to and the hash of the
 * proxy code in front of it.
 */
export interface AuditSubject {
  readonly key: string;
  readonly address: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly source: string;
  readonly tripwire:
    | { readonly kind: 'implementation'; readonly implementation: string }
    | { readonly kind: 'beacon'; readonly beacon: string; readonly codeHash: string };
}

/** The settlement assets, then every stock token that has a price feed. */
export const AUDIT_ROTATION: readonly AuditSubject[] = [
  ...TOKENS.map((t) => ({
    key: t.key,
    address: t.address,
    symbol: t.observedSymbol,
    decimals: t.observedDecimals,
    source: t.source,
    tripwire: { kind: 'implementation' as const, implementation: t.recordedImplementation },
  })),
  ...STOCK_TOKENS.filter((t) => t.feedKey !== null && t.beacon !== null && t.codeHash !== null).map((t) => ({
    key: t.key,
    address: t.address,
    symbol: t.ticker,
    decimals: t.decimals,
    source: 'https://api.robinhood.com/rhj/assets',
    tripwire: { kind: 'beacon' as const, beacon: t.beacon!, codeHash: t.codeHash! },
  })),
];

/** Audit one subject per run, choosing whichever has gone longest unreported. */
async function nextSubject(store: Parameters<Producer>[0]['store']): Promise<AuditSubject> {
  // Its own filings — one a day — rather than the newest N of everyone's,
  // which at the Pillar's cadence covers a day and would keep returning the
  // first two subjects forever. Enough history to see every subject once.
  const recent = await store.publicationsByAgent('registrar', AUDIT_ROTATION.length * 2);
  // An unreadable history means we cannot tell which subject is least recently
  // reported. Rotation degrades to the first entry rather than failing the run:
  // auditing the same token twice is a smaller fault than auditing none.
  const reported = recent.state === 'UNREAD' ? [] : recent.value.map((p) => p.headline);
  const mentions = (s: AuditSubject) => reported.findIndex((h) => h.includes(` ${s.symbol} `));

  for (const subject of AUDIT_ROTATION) {
    if (mentions(subject) === -1) return subject;
  }
  // Everything has been reported at least once: take the least recent.
  return [...AUDIT_ROTATION].sort((a, b) => mentions(b) - mentions(a))[0] ?? AUDIT_ROTATION[0]!;
}

/** "could not be checked" needs the reason, not just the absence. */
function whyUnread(reading: Reading<unknown>, label: string): string {
  if (isRead(reading)) return '';
  const detail = reading.detail ? ` ${reading.detail}` : '';
  return `— ${label}: ${reading.reason}.${detail}`;
}

export const registrarProducer: Producer = async ({ now, store }): Promise<ProducerResult> => {
  const subject = await nextSubject(store);
  const network = activeNetwork();
  const opts = { intervalSeconds: INTERVAL };

  const [block, code, name, symbol, decimals, supply, proxy, paused, owner, beaconImpl] = await Promise.all([
    readBlockNumber(opts),
    readCode(subject.address, opts),
    readTokenString(subject.address, 'name', opts),
    readTokenString(subject.address, 'symbol', opts),
    readTokenUint(subject.address, 'decimals', opts),
    readTokenUint(subject.address, 'totalSupply', opts),
    readProxyState(subject.address, opts),
    readPaused(subject.address, opts),
    readOwner(subject.address, opts),
    rpcCall<string>('eth_call', [{ to: STOCK_TOKEN_BEACON.address, data: IMPLEMENTATION_SELECTOR }, 'latest'], opts),
  ]);
  // The two live sources the captures came from, for the drift check below.
  const [listedTokens, listedFeeds] = await Promise.all([fetchListedTokens(INTERVAL), fetchListedFeeds(INTERVAL)]);
  // The implementation's code, hashed, so a beacon that still names the same
  // address but has different bytes behind it is caught as well.
  const beaconImplAddress = isRead(beaconImpl) ? decodeAddressWord(beaconImpl.value) : null;
  const implCode = beaconImplAddress === null ? null : await rpcCall<string>('eth_getCode', [beaconImplAddress, 'latest'], opts);
  const proxyCode = await rpcCall<string>('eth_getCode', [subject.address, 'latest'], opts);

  const figures: DeclaredFigure[] = [];
  const checked: string[] = [];
  const couldNotCheck: string[] = [];

  // Seven source groups, matching the Registrar's declared sourcesExpected: the
  // beacon, code, metadata, supply and proxy shape of the contract under
  // audit, then the two live sources the captures are checked against.
  let sourcesReached = 0;
  let oldestInputAt: Date | null = null;
  const note = (reading: Reading<unknown>) => {
    if (!isRead(reading)) return;
    const at = new Date(reading.retrievedAt);
    if (oldestInputAt === null || at < oldestInputAt) oldestInputAt = at;
  };
  [block, code, name, symbol, decimals, supply, proxy, paused, owner, beaconImpl].forEach(note);

  // ── group 1: the beacon behind every stock token ───────────────────────────
  const stockCount = String(STOCK_TOKENS.length);
  figures.push({ token: stockCount, source: 'https://api.robinhood.com/rhj/assets', retrievedAt: STOCK_TOKEN_BEACON.observedAt });
  if (beaconImplAddress !== null) {
    sourcesReached += 1;
    const same = beaconImplAddress.toLowerCase() === STOCK_TOKEN_BEACON.observedImplementation.toLowerCase();
    const codeHash = implCode !== null && isRead(implCode) ? toHex(keccak256(Buffer.from(implCode.value.slice(2), 'hex'))) : null;
    const sameCode = codeHash !== null && codeHash === STOCK_TOKEN_BEACON.observedImplementationCodeHash;
    checked.push(
      same
        ? `— The stock-token beacon at ${STOCK_TOKEN_BEACON.address} points at implementation ${beaconImplAddress}, the same one recorded when the registry was captured. Every one of the ${stockCount} stock tokens in the issuer's registry delegates to this beacon, so this one read describes the code behind all of them.`
        : `— The stock-token beacon at ${STOCK_TOKEN_BEACON.address} has CHANGED its implementation: it now points at ${beaconImplAddress}, recorded at capture as ${STOCK_TOKEN_BEACON.observedImplementation}. Every one of the ${stockCount} stock tokens changed code in that same transaction, and every finding recorded against the previous implementation describes code that is no longer running.`,
    );
    if (codeHash === null) {
      couldNotCheck.push(`— implementation code: could not be read, so whether the bytes behind that address match the recorded hash is not established.`);
    } else if (same && !sameCode) {
      checked.push('— The implementation address is unchanged but the code hash behind it DIFFERS from the one recorded at capture. Code at a fixed address changing is not what an upgrade normally looks like; treat every stock token as running unreviewed code.');
    } else if (same) {
      checked.push('— The implementation code hashes to the value recorded at capture.');
    }
  } else {
    couldNotCheck.push(whyUnread(beaconImpl, 'stock-token beacon implementation()'));
  }

  // ── group 2: is there a contract here at all ───────────────────────────────
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

  // ── group 3: metadata ──────────────────────────────────────────────────────
  if (isRead(name) && isRead(symbol) && isRead(decimals)) {
    sourcesReached += 1;
    const dec = decimals.value.toString();
    figures.push({ token: dec, source: `${network.label} · decimals()`, retrievedAt: decimals.retrievedAt });
    checked.push(
      `— The contract answers its own metadata calls: name "${name.value}", symbol "${symbol.value}", decimals ${dec}.`,
    );
    if (Number(decimals.value) !== subject.decimals) {
      checked.push('— Decimals differ from the value recorded for this address. Every amount derived from the older figure is wrong.');
    }
    if (symbol.value !== subject.symbol) {
      checked.push(`— The symbol differs from the one recorded for this address ("${subject.symbol}"). A token that has renamed itself is a token whose identity needs re-establishing before anything else here is relied on.`);
    }
  } else {
    for (const [reading, label] of [[name, 'name()'], [symbol, 'symbol()'], [decimals, 'decimals()']] as const) {
      const line = whyUnread(reading, label);
      if (line) couldNotCheck.push(line);
    }
  }

  // ── group 4: supply ────────────────────────────────────────────────────────
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

  // ── group 5: proxy shape and upgrade authority ─────────────────────────────
  if (isRead(proxy)) {
    sourcesReached += 1;
    const state = proxy.value;
    switch (state.pattern) {
      case 'not-eip1967':
        checked.push('— The standard implementation and beacon slots are both empty: this address is not an upgradeable proxy of either shape.');
        break;
      case 'transparent':
      case 'uups':
        checked.push(
          state.pattern === 'transparent'
            ? `— Upgradeable proxy. The implementation slot points at ${state.implementation}, and the admin slot is set, which is the transparent pattern.`
            : `— Upgradeable proxy. The implementation slot points at ${state.implementation}, and the admin slot is empty, which is the pattern where the upgrade function lives in the implementation itself.`,
        );
        if (subject.tripwire.kind === 'implementation') {
          const changed = state.implementation!.toLowerCase() !== subject.tripwire.implementation.toLowerCase();
          checked.push(
            changed
              ? `— The implementation has CHANGED since this address was last recorded by hand, when it pointed at ${subject.tripwire.implementation}. Findings recorded against the previous implementation describe code that is no longer running.`
              : '— The implementation is the same one recorded when this address was last checked by hand.',
          );
        } else {
          checked.push('— This address was recorded as a beacon proxy and now carries an implementation slot of its own. Its shape has changed; the recorded tripwire no longer applies.');
        }
        break;
      case 'beacon': {
        checked.push(`— Beacon proxy. The implementation slot is empty and the beacon slot points at ${state.beacon}: the code that runs here is whatever that beacon names, and it names the same code for every proxy that shares it.`);
        if (subject.tripwire.kind === 'beacon') {
          const sameBeacon = state.beacon!.toLowerCase() === subject.tripwire.beacon.toLowerCase();
          checked.push(
            sameBeacon
              ? '— The beacon is the one recorded at capture, the same beacon every stock token in the registry was recorded against.'
              : `— The beacon has CHANGED since capture, when it was ${subject.tripwire.beacon}. This token no longer runs the code the rest of the registry runs.`,
          );
          if (isRead(proxyCode)) {
            const hash = toHex(keccak256(Buffer.from(proxyCode.value.slice(2), 'hex')));
            checked.push(
              hash === subject.tripwire.codeHash
                ? '— The proxy code in front of the beacon hashes to the value recorded at capture.'
                : '— The proxy code in front of the beacon DIFFERS from the code recorded at capture. The delegation itself has been rewritten.',
            );
          } else {
            couldNotCheck.push(whyUnread(proxyCode, 'proxy code'));
          }
        } else {
          checked.push('— This address was recorded with an implementation slot of its own and now reads as a beacon proxy. Its shape has changed; the recorded tripwire no longer applies.');
        }
        break;
      }
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

  // ── groups 6 and 7: has the world moved on from the capture? ──────────────
  const capture: string[] = [];
  const snapshots: SnapshotRecord[] = [];
  const literals = new Set<string>(['1967']);
  const literal = (n: number) => {
    literals.add(String(n));
    return String(n);
  };
  const driftPayload: Record<string, unknown> = { checkedAt: now.toISOString() };
  if (isRead(listedTokens)) {
    sourcesReached += 1;
    note(listedTokens);
    const drift = diffTokens(listedTokens.value);
    figures.push({ token: String(drift.listed), source: STOCK_TOKENS_SOURCE.url, retrievedAt: listedTokens.retrievedAt });
    Object.assign(driftPayload, { tokensListed: drift.listed, tokensAdded: drift.added.map((t) => t.ticker), tokensRemoved: drift.removed.map((t) => t.ticker), tokensMoved: drift.moved.map((t) => t.ticker) });
    const clean = drift.added.length === 0 && drift.removed.length === 0 && drift.moved.length === 0;
    capture.push(
      clean
        ? `— The issuer's registry lists ${drift.listed} stock tokens on this chain today and this system's capture holds ${literal(drift.captured)}: the same set, nothing added, nothing removed, no contract moved.`
        : `— The issuer's registry lists ${drift.listed} stock tokens on this chain today; this system's capture holds ${literal(drift.captured)}.${drift.added.length > 0 ? ` Listed and NOT captured (${literal(drift.added.length)}): ${drift.added.map((t) => t.ticker).join(', ')} — no agent reads them until the registry is re-captured.` : ''}${drift.removed.length > 0 ? ` Captured and no longer listed (${literal(drift.removed.length)}): ${drift.removed.map((t) => t.ticker).join(', ')} — still read, and every filing about them describes a token the issuer has delisted.` : ''}${drift.moved.length > 0 ? ` Same registry entry, different contract (${literal(drift.moved.length)}): ${drift.moved.map((t) => t.ticker).join(', ')} — the capture points at the wrong contract for these.` : ''} The remedy is scripts/capture-stock-tokens.ts, not a hand edit.`,
    );
  } else {
    couldNotCheck.push(whyUnread(listedTokens, "the issuer's live asset registry") + ' Whether tokens were added or removed since capture is not known.');
  }
  if (isRead(listedFeeds)) {
    sourcesReached += 1;
    note(listedFeeds);
    const drift = diffFeeds(listedFeeds.value);
    figures.push({ token: String(drift.listed), source: FEED_DIRECTORY_SOURCE.url, retrievedAt: listedFeeds.retrievedAt });
    Object.assign(driftPayload, { feedsListed: drift.listed, feedsAdded: drift.added.map((f) => f.name), feedsRemoved: drift.removed.map((f) => f.name) });
    const clean = drift.added.length === 0 && drift.removed.length === 0;
    capture.push(
      clean
        ? `— The vendor's feed directory lists ${drift.listed} feeds for this network today and the capture holds ${literal(drift.captured)}: the same set.`
        : `— The vendor's feed directory lists ${drift.listed} feeds for this network today; the capture holds ${literal(drift.captured)}.${drift.added.length > 0 ? ` Listed and NOT captured (${literal(drift.added.length)}): ${drift.added.map((f) => f.name).join(', ')} — not priced here until re-captured.` : ''}${drift.removed.length > 0 ? ` Captured and no longer listed (${literal(drift.removed.length)}): ${drift.removed.map((f) => f.name).join(', ')} — still read; the vendor no longer lists them.` : ''} The remedy is scripts/capture-feeds.ts.`,
    );
  } else {
    couldNotCheck.push(whyUnread(listedFeeds, "the vendor's live feed directory") + ' Whether feeds were added or removed since capture is not known.');
  }
  snapshots.push({ key: 'capture:drift', observedAt: now.toISOString(), payload: driftPayload });

  const rotationCount = String(AUDIT_ROTATION.length);
  literals.add(rotationCount);
  literals.add(String(AUDIT_ROTATION.length - 1));
  const body = [
    'CHECKED',
    ...checked,
    '',
    'THE CAPTURE, AGAINST THE WORLD',
    ...capture,
    '',
    'COULD NOT BE CHECKED',
    ...(couldNotCheck.length > 0
      ? couldNotCheck
      : ['— Every question put to the chain on this run was answered.']),
    `— The other ${String(AUDIT_ROTATION.length - 1)} contracts in the audit rotation were not read on this run; each is read in turn, one per run.`,
    '',
    'STAYS UNKNOWN',
    ...UNKNOWABLE_FROM_CHAIN.map((line) => `— ${line}`),
  ].join('\n');

  return {
    publication: {
      headline: `REGISTRY · ${subject.symbol} · ${elide(subject.address)}`,
      body,
      figures,
      readings: {
        'pause flag': paused,
        owner,
        'Total supply': supply,
        'beacon implementation': beaconImpl,
      },
      // Standard numbers and counts of our own things, not measurements.
      allowedLiterals: [...literals],
    },
    sourcesReached,
    oldestInputAt,
    snapshots,
  };
};
