/**
 * A minimal JSON-RPC client for Robinhood Chain.
 *
 * It is deliberately small and dependency-free: every call this system makes is a
 * read, and a read that fails must produce an UNREAD reading rather than an
 * exception that some caller quietly turns into a zero.
 */

import { activeNetwork, rpcUrl, rpcUrls, type NetworkProfile } from './networks.ts';
import { request } from './transport.ts';
import { read, unread, type Reading } from '../doctrine/reading.ts';

interface RpcSuccess {
  jsonrpc: '2.0';
  id: number;
  result: unknown;
}

interface RpcFailure {
  jsonrpc: '2.0';
  id: number;
  error: { code: number; message: string };
}

const DEFAULT_TIMEOUT_MS = 15_000;

let requestId = 0;

export interface RpcOptions {
  readonly profile?: NetworkProfile;
  readonly timeoutMs?: number;
  /** The producing agent's declared interval, used to age the reading. */
  readonly intervalSeconds: number;
}

/** How long a confirmed chain id is trusted before it is asked for again. */
export const CHAIN_CONFIRM_SECONDS = 10 * 60;
/** How long a failed confirmation is held before the endpoint is asked again. */
const CHAIN_RETRY_SECONDS = 60;

const confirmations = new Map<string, { until: number; fault: Reading<never> | null }>();

/** How long an endpoint that did not answer is passed over for the next one, before it is tried again. */
export const DEMOTION_SECONDS = 60;
const demotions = new Map<string, number>();

/** A provider's own refusal that is about the account, not the query: the next endpoint is asked. Anchored, so a hash or a code that happens to contain the digits is not one. */
const QUOTA = /\bHTTP 429\b|rate.?limit|too many requests|\bquota\b|exceeded .*(?:limit|plan|credits)|compute units/i;

/**
 * Whether a reading is the endpoint failing to answer at all — to be tried
 * elsewhere — as opposed to an answer, right or wrong. A timed-out
 * eth_getLogs is neither: on a node with no cap on results it is how "too
 * much for one page" shows, the reader's signal to halve, and it says
 * nothing about the endpoint; it is returned as it is, and the endpoint
 * keeps its place.
 */
export function isTransportFailure(r: Reading<unknown>, method?: string): boolean {
  if (r.state !== 'UNREAD') return false;
  if (r.reason === 'SOURCE_TIMEOUT') return method !== 'eth_getLogs';
  if (r.reason === 'SOURCE_UNREACHABLE') return true;
  return r.reason === 'SOURCE_MALFORMED' && QUOTA.test(r.detail ?? '') && !/chain \d+; the .* profile expects/.test(r.detail ?? '');
}

/**
 * The endpoint's own chain id, compared with the profile's, before any other
 * call is trusted. Asked once per process per endpoint and again after
 * `CHAIN_CONFIRM_SECONDS`. Multicall3 carries the same bytecode on every chain
 * it is deployed to, so the pinned code hash cannot tell chains apart; only the
 * id can. A mismatch makes every read UNREAD with the endpoint named, rather
 * than a clean-looking record of the wrong chain.
 */
export async function chainFault(opts: RpcOptions, url: string = rpcUrl(opts.profile ?? activeNetwork())): Promise<Reading<never> | null> {
  const profile = opts.profile ?? activeNetwork();
  const held = confirmations.get(url);
  const now = Date.now();
  if (held && held.until > now) return held.fault;

  const id = await readChainIdAt(url, opts);
  let fault: Reading<never> | null = null;
  if (id.state === 'UNREAD') {
    fault = id;
  } else if (id.value !== profile.chainId) {
    fault = unread('SOURCE_MALFORMED', {
      source: id.source,
      detail: `the endpoint reports chain ${id.value}; the ${profile.id} profile expects ${profile.chainId} — nothing from it is read`,
    });
  }
  confirmations.set(url, { until: now + (fault === null ? CHAIN_CONFIRM_SECONDS : CHAIN_RETRY_SECONDS) * 1000, fault });
  return fault;
}

/** Forgets every confirmation and demotion. For tests that stand up a different endpoint. */
export function forgetChainConfirmations(): void {
  confirmations.clear();
  demotions.clear();
}

/**
 * One RPC call, returned as a reading. `source` names the endpoint host so the
 * provenance line points at something a reader could check themselves. Every
 * method but `eth_chainId` itself waits on the chain being confirmed first.
 *
 * The profile's endpoints are tried in order (the operator's own, then the
 * public node): one that does not answer — the transport, a timeout, a
 * quota — is passed over for the next and not asked again for
 * DEMOTION_SECONDS; an answer, including a wrong one (a reverted call, a
 * refused query, another chain's id), is the reading, never retried
 * elsewhere. When none answers, the first endpoint's failure is the reading,
 * with the others' noted in its detail.
 */
export async function rpcCall<T>(
  method: string,
  params: readonly unknown[],
  opts: RpcOptions,
): Promise<Reading<T>> {
  const profile = opts.profile ?? activeNetwork();
  const urls = rpcUrls(profile);
  const now = Date.now();
  const live = urls.filter((u) => (demotions.get(u) ?? 0) <= now);
  const order = live.length > 0 ? live : urls;
  let first: Reading<T> | null = null;
  const others: string[] = [];
  for (const url of order) {
    let r: Reading<T>;
    if (method !== 'eth_chainId') {
      const fault = await chainFault(opts, url);
      r = fault !== null ? fault : await rpcCallAt<T>(url, method, params, opts);
    } else {
      r = await rpcCallAt<T>(url, method, params, opts);
    }
    if (!isTransportFailure(r, method)) return r;
    if (order.length > 1) demotions.set(url, Date.now() + DEMOTION_SECONDS * 1000);
    if (first === null) first = r;
    else others.push(`${new URL(url).host}: ${r.state === 'UNREAD' ? (r.detail ?? r.reason) : ''}`);
  }
  const f = first!;
  return others.length === 0 || f.state !== 'UNREAD' ? f : { ...f, detail: `${f.detail ?? f.reason}; the fallback did not answer either (${others.join('; ')})` };
}

/** The chain id as one endpoint reports it. */
async function readChainIdAt(url: string, opts: RpcOptions): Promise<Reading<number>> {
  const hex = await rpcCallAt<string>(url, 'eth_chainId', [], opts);
  if (hex.state === 'UNREAD') return hex;
  const parsed = Number.parseInt(hex.value, 16);
  if (!Number.isInteger(parsed)) return unread('SOURCE_MALFORMED', { source: hex.source, detail: `chainId ${hex.value}` });
  return { ...hex, value: parsed };
}

async function rpcCallAt<T>(url: string, method: string, params: readonly unknown[], opts: RpcOptions): Promise<Reading<T>> {
  const source = `${new URL(url).host} · ${method}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const startedAt = new Date();

  try {
    const response = await request(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
      },
      controller.signal,
    );

    // A provider may carry a JSON-RPC error on a non-2xx status (dRPC answers a
    // refused eth_getLogs with HTTP 500 and the error in the body, measured 13
    // September 2026): the error's own words are the answer, and they are what
    // a reader halves on. A non-2xx with no such body is the transport.
    let body: RpcSuccess | RpcFailure | null = null;
    if (!response.ok) {
      try {
        const parsed = JSON.parse(response.text) as RpcSuccess | RpcFailure;
        if (parsed && typeof parsed === 'object' && 'error' in parsed && parsed.error && typeof parsed.error.message === 'string') body = parsed;
      } catch {
        // not JSON: the transport's answer, below
      }
      if (body === null) {
        return unread('SOURCE_UNREACHABLE', {
          source,
          detail: `HTTP ${response.status}`,
        });
      }
    }

    body ??= JSON.parse(response.text) as RpcSuccess | RpcFailure;
    if ('error' in body) {
      // A revert is not malformed data. The node answered correctly; the
      // contract declined to. Calling a function a contract does not implement
      // reverts, and reporting that as corruption would send a reader looking
      // for a fault in the transport that is not there.
      const reverted = /execution reverted|revert/i.test(body.error.message);
      return unread(reverted ? 'FIELD_ABSENT' : 'SOURCE_MALFORMED', {
        source,
        detail: reverted
          ? `the call reverted (${body.error.message}) — the contract does not answer this. Not a "no".`
          : `rpc error ${body.error.code}: ${body.error.message}`,
      });
    }

    return read<T>({
      value: body.result as T,
      source,
      retrievedAt: startedAt,
      intervalSeconds: opts.intervalSeconds,
    });
  } catch (cause) {
    const aborted = cause instanceof Error && cause.name === 'AbortError';
    return unread(aborted ? 'SOURCE_TIMEOUT' : 'SOURCE_UNREACHABLE', {
      source,
      detail: cause instanceof Error ? cause.message : 'unknown transport failure',
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Confirms the endpoint is the chain we think it is, before anything trusts it. */
export async function readChainId(opts: RpcOptions): Promise<Reading<number>> {
  const hex = await rpcCall<string>('eth_chainId', [], opts);
  if (hex.state === 'UNREAD') return hex;
  const parsed = Number.parseInt(hex.value, 16);
  if (!Number.isInteger(parsed)) {
    return unread('SOURCE_MALFORMED', { source: hex.source, detail: `chainId ${hex.value}` });
  }
  return { ...hex, value: parsed };
}

export async function readBlockNumber(opts: RpcOptions): Promise<Reading<number>> {
  const hex = await rpcCall<string>('eth_blockNumber', [], opts);
  if (hex.state === 'UNREAD') return hex;
  const parsed = Number.parseInt(hex.value, 16);
  if (!Number.isInteger(parsed)) {
    return unread('SOURCE_MALFORMED', { source: hex.source, detail: `block ${hex.value}` });
  }
  return { ...hex, value: parsed };
}

export interface LogEntry {
  readonly address: string;
  readonly topics: readonly string[];
  readonly data: string;
  readonly blockNumber: string;
  readonly transactionHash: string;
  /** Position of the log in its block. With the transaction hash, the identity of the event. */
  readonly logIndex?: string;
  /** The hash of the block the log is in — what tells a reorganised block from the one that was read. */
  readonly blockHash?: string;
}

/**
 * Logs over a block range.
 *
 * Public endpoints cap how wide a range they will scan and reject anything
 * larger. That rejection comes back as an UNREAD reading with the node's own
 * message attached, rather than as an empty array — "no transfers happened" and
 * "we were not allowed to look" must never arrive looking the same.
 */
export async function readLogs(
  address: string | readonly string[],
  topics: readonly (string | null)[],
  fromBlock: number,
  toBlock: number,
  opts: RpcOptions,
): Promise<Reading<LogEntry[]>> {
  return rpcCall<LogEntry[]>(
    'eth_getLogs',
    [
      {
        address,
        topics,
        fromBlock: `0x${fromBlock.toString(16)}`,
        toBlock: `0x${toBlock.toString(16)}`,
      },
    ],
    opts,
  );
}

export interface ChainHead {
  readonly number: number;
  /** Unix seconds, as the block header states it. */
  readonly timestamp: number;
}

/**
 * The head block with its timestamp. Its age against the clock is the one
 * liveness signal this chain offers: the vendor publishes no sequencer uptime
 * feed for it and has stopped adding them, and a sequencer that stops is a
 * head that stops advancing.
 */
export async function readHead(opts: RpcOptions): Promise<Reading<ChainHead>> {
  const raw = await rpcCall<{ number: string; timestamp: string } | null>(
    'eth_getBlockByNumber',
    ['latest', false],
    opts,
  );
  if (raw.state === 'UNREAD') return raw;
  if (raw.value === null) {
    return unread('SOURCE_MALFORMED', { source: raw.source, detail: 'the node returned no latest block' });
  }
  const number = Number(raw.value.number);
  const timestamp = Number(raw.value.timestamp);
  if (!Number.isFinite(number) || !Number.isFinite(timestamp) || timestamp <= 0) {
    return unread('SOURCE_MALFORMED', { source: raw.source, detail: 'latest block header undecodable' });
  }
  return { ...raw, value: { number, timestamp } };
}

/** The hash of the block at a height, for telling a reorganised block from the one that was indexed. */
export async function readBlockHash(number: number, opts: RpcOptions): Promise<Reading<string>> {
  const raw = await rpcCall<{ hash: string } | null>('eth_getBlockByNumber', [`0x${number.toString(16)}`, false], opts);
  if (raw.state === 'UNREAD') return raw;
  if (raw.value === null || typeof raw.value.hash !== 'string') {
    return unread('SOURCE_MALFORMED', { source: raw.source, detail: `the node returned no block at height ${number}` });
  }
  return { ...raw, value: raw.value.hash.toLowerCase() };
}

/** Non-empty code is the difference between "a contract" and "an address someone typed". */
export async function readCode(
  address: string,
  opts: RpcOptions,
): Promise<Reading<{ address: string; hasCode: boolean; sizeBytes: number }>> {
  const code = await rpcCall<string>('eth_getCode', [address, 'latest'], opts);
  if (code.state === 'UNREAD') return code;
  const body = code.value.startsWith('0x') ? code.value.slice(2) : code.value;
  return {
    ...code,
    value: { address, hasCode: body.length > 0, sizeBytes: Math.floor(body.length / 2) },
  };
}
