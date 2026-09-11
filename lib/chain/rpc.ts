/**
 * A minimal JSON-RPC client for Robinhood Chain.
 *
 * It is deliberately small and dependency-free: every call this system makes is a
 * read, and a read that fails must produce an UNREAD reading rather than an
 * exception that some caller quietly turns into a zero.
 */

import { activeNetwork, rpcUrl, type NetworkProfile } from './networks.ts';
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

/**
 * One RPC call, returned as a reading. `source` names the endpoint host so the
 * provenance line points at something a reader could check themselves.
 */
export async function rpcCall<T>(
  method: string,
  params: readonly unknown[],
  opts: RpcOptions,
): Promise<Reading<T>> {
  const profile = opts.profile ?? activeNetwork();
  const url = rpcUrl(profile);
  const source = `${new URL(url).host} · ${method}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const startedAt = new Date();

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!response.ok) {
      return unread('SOURCE_UNREACHABLE', {
        source,
        detail: `HTTP ${response.status}`,
      });
    }

    const body = (await response.json()) as RpcSuccess | RpcFailure;
    if ('error' in body) {
      return unread('SOURCE_MALFORMED', {
        source,
        detail: `rpc error ${body.error.code}: ${body.error.message}`,
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
