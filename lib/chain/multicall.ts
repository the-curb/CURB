/**
 * Batched reads through Multicall3.
 *
 * Thirty-five equity feeds, each asked three questions, is a hundred and five
 * calls. Put to the node one at a time they arrive as a burst, and the public
 * endpoint answers a burst by refusing part of it — which was measured, not
 * assumed: a sweep of the stock tokens at ten parallel calls each lost a third
 * of its answers to SOURCE_UNREACHABLE. Multicall3 turns the hundred and five
 * into one `eth_call`, and every answer in the batch describes the same block.
 *
 * What it is and is not, for the provenance line: Multicall3 is not a source.
 * It is a contract that makes the calls it is handed and returns their bytes
 * untouched, with a flag per call saying whether that call succeeded. A feed's
 * answer read through it is still the feed's answer. A subcall that failed is
 * still that one feed's absence, not the batch's.
 *
 * The contract is deployed at the same address on every chain by CREATE2, so
 * its runtime code is identical everywhere and cannot change in place. The hash
 * of that code, observed on Robinhood Chain, is recorded here as a tripwire and
 * checked by a test that reads the chain, never on the hot path.
 */

import { rpcCall, type RpcOptions } from './rpc.ts';
import { decodeUint, words } from './abi.ts';
import { selector } from './keccak.ts';
import { unread, type Reading } from '../doctrine/reading.ts';

export const MULTICALL3 = {
  address: '0xcA11bde05977b3631167028862bE2a173976CA11',
  /** keccak256 of the runtime code at the address above, observed on chain 4663. */
  observedCodeHash: '0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891',
  observedAt: '2026-09-11T13:12:00Z',
  observedSizeBytes: 3808,
} as const;

/** aggregate3((address,bool,bytes)[]) — derived from the signature, not remembered. */
export const AGGREGATE3_SELECTOR = selector('aggregate3((address,bool,bytes)[])');

export interface Call {
  readonly target: string;
  readonly data: string;
}

export interface CallResult {
  /** False means the subcall reverted; `data` then holds the revert payload. */
  readonly success: boolean;
  readonly data: string;
}

/**
 * How many subcalls go into one `eth_call`. The node evaluated four hundred
 * feed reads in one call in under a second when this was sized; a hundred
 * leaves that margin for a call that forwards through more than one proxy.
 */
export const BATCH_SIZE = 100;

function strip(hex: string): string {
  return hex.startsWith('0x') ? hex.slice(2) : hex;
}

function word(value: bigint | number): string {
  return BigInt(value).toString(16).padStart(64, '0');
}

function addressWord(address: string): string {
  return strip(address).toLowerCase().padStart(64, '0');
}

function padded(hexBody: string): string {
  const remainder = hexBody.length % 64;
  return remainder === 0 ? hexBody : hexBody + '0'.repeat(64 - remainder);
}

/**
 * ABI-encode `aggregate3(Call3[])` with `allowFailure = true` on every call.
 *
 * Layout, from the standard: one head word pointing at the array; the array's
 * length; one offset per element (relative to the start of the element area);
 * then each element as a dynamic tuple — target, allowFailure, an offset to its
 * bytes (always 0x60, the tuple has three slots), the bytes' length, the bytes.
 */
export function encodeAggregate3(calls: readonly Call[]): string {
  const elements = calls.map((call) => {
    const body = strip(call.data);
    if (body.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(body)) {
      throw new Error(`calldata is not even-length hex: ${call.data}`);
    }
    return (
      addressWord(call.target) +
      word(1) +
      word(0x60) +
      word(body.length / 2) +
      (body.length === 0 ? '' : padded(body.toLowerCase()))
    );
  });

  let offset = calls.length * 32;
  const offsets = elements.map((element) => {
    const here = offset;
    offset += element.length / 2;
    return word(here);
  });

  return (
    AGGREGATE3_SELECTOR +
    word(0x20) +
    word(calls.length) +
    offsets.join('') +
    elements.join('')
  );
}

/**
 * Decode the `Result[]` that `aggregate3` returns. Every element is a dynamic
 * tuple `(bool success, bytes returnData)`; `returnData` comes back as `0x`-
 * prefixed hex exactly as the callee produced it, so the same decoders that
 * read a direct call read these.
 */
export function decodeAggregate3(returnHex: string, expected: number): CallResult[] | null {
  const hex = strip(returnHex).toLowerCase();
  if (hex.length % 64 !== 0) return null;
  const w = words(`0x${hex}`);
  const at = (index: number): bigint | null => (index < w.length ? decodeUint(w[index]!) : null);

  const arrayOffset = at(0);
  if (arrayOffset === null) return null;
  const arrayStart = Number(arrayOffset) / 32;
  const length = at(arrayStart);
  if (length === null || Number(length) !== expected) return null;

  const elementsBase = arrayStart + 1;
  const results: CallResult[] = [];
  for (let i = 0; i < expected; i += 1) {
    const relative = at(elementsBase + i);
    if (relative === null) return null;
    const tupleStart = elementsBase + Number(relative) / 32;
    const success = at(tupleStart);
    const bytesOffset = at(tupleStart + 1);
    if (success === null || bytesOffset === null) return null;
    const bytesStart = tupleStart + Number(bytesOffset) / 32;
    const byteLength = at(bytesStart);
    if (byteLength === null) return null;
    const dataStart = (bytesStart + 1) * 64;
    const dataEnd = dataStart + Number(byteLength) * 2;
    if (dataEnd > hex.length) return null;
    results.push({ success: success !== 0n, data: `0x${hex.slice(dataStart, dataEnd)}` });
  }
  return results;
}

/**
 * Run one batch. The reading wraps the whole batch: if the `eth_call` itself
 * failed, nothing in it was read and the reason is the transport's. If it
 * succeeded, each element carries its own success flag.
 */
export async function aggregate3(
  calls: readonly Call[],
  opts: RpcOptions,
): Promise<Reading<CallResult[]>> {
  if (calls.length === 0) {
    return unread('FIELD_ABSENT', { source: 'multicall', detail: 'no calls to make' });
  }
  const raw = await rpcCall<string>(
    'eth_call',
    [{ to: MULTICALL3.address, data: encodeAggregate3(calls) }, 'latest'],
    opts,
  );
  if (raw.state === 'UNREAD') return raw;
  if (raw.value === '0x' || raw.value === '') {
    return unread('FIELD_ABSENT', {
      source: raw.source,
      detail: 'Multicall3 returned no data — no contract at its address on this chain, or the call reverted',
    });
  }
  const decoded = decodeAggregate3(raw.value, calls.length);
  if (decoded === null) {
    return unread('SOURCE_MALFORMED', {
      source: raw.source,
      detail: `aggregate3 return data could not be decoded as ${calls.length} results`,
    });
  }
  return { ...raw, value: decoded };
}

/**
 * Every call, as its own reading — the shape the rest of the codebase speaks.
 *
 * Calls are chunked so no single `eth_call` grows past what a node will
 * evaluate; a chunk that fails as a whole makes every call in it UNREAD with the
 * chunk's reason, and the other chunks stand. A subcall that reverted inside a
 * successful chunk is FIELD_ABSENT: the contract declined that question.
 */
export async function readMany(
  calls: readonly Call[],
  opts: RpcOptions,
  batchSize: number = BATCH_SIZE,
  run: typeof aggregate3 = aggregate3,
): Promise<Reading<string>[]> {
  const out: Reading<string>[] = [];
  for (let start = 0; start < calls.length; start += batchSize) {
    const chunk = calls.slice(start, start + batchSize);
    const batch = await run(chunk, opts);
    if (batch.state === 'UNREAD') {
      for (let i = 0; i < chunk.length; i += 1) out.push(batch);
      continue;
    }
    for (const result of batch.value) {
      if (!result.success) {
        out.push(
          unread('FIELD_ABSENT', {
            source: batch.source,
            detail: 'the call reverted inside the batch — the contract does not answer this. Not a "no".',
          }),
        );
      } else if (result.data === '0x') {
        out.push(
          unread('FIELD_ABSENT', {
            source: batch.source,
            detail: 'returned no data — reverted or not implemented. Not a "no".',
          }),
        );
      } else {
        out.push({ ...batch, value: result.data });
      }
    }
  }
  return out;
}
