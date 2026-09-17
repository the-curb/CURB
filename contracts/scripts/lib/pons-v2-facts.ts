/**
 * PONS v2 as read from Robinhood Chain on 17 September 2026 — the addresses,
 * the launch phases, and how a launch's graduated pool is named — without a
 * dependency, so the site's tests can hold the tools to it. The venue's ABI
 * (viem's parseAbi) lives beside it in pons-v2.ts, which re-exports this.
 * Nothing here is a term of The Curb's; every tool re-reads the venue's live
 * settings in the block it acts (docs/mainnet/EXTERNAL-FACTS-2026-09-17-PONS-V2.md).
 */

import { poolIdOf, type V4PoolKey } from '../../../lib/chain/uniswap-v4.ts';

type Address = `0x${string}`;

/** The deployed contracts on Robinhood Chain (4663), as read on 17 September 2026. Compared against the chain by every tool, never trusted alone. */
export const PONS_V2 = {
  chainId: 4663,
  factory: '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e' as Address,
  hook: '0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044' as Address,
  /** Uniswap's PoolManager on 4663, from the official deployments page, which the factory's poolManager() must equal. */
  poolManager: '0x8366a39cc670b4001a1121b8f6a443a643e40951' as Address,
  stateView: '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b' as Address,
  /** Chainlink ETH / USD on 4663 (the chain profile's feed directory), the quote's feed when the pair is native ETH. */
  ethUsdFeed: '0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9' as Address,
  /** USDG on 4663, an approved pair token with six decimals, taken as dollars when it is the quote. */
  usdg: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168' as Address,
} as const;

export const NATIVE = '0x0000000000000000000000000000000000000000' as Address;

export const PHASES = ['NotGraduated', 'Swept', 'PoolCreated', 'Rescued'] as const;

/**
 * The key of a launch's graduated pool: the pair token (native ETH is the
 * zero address) and the launched token sorted numerically, the launch's
 * pool fee and tick spacing, and the venue's hook. The factory sorts the
 * same way (`_sortCurrencies`, verified source), so this names the pool the
 * factory created — and the tool that records it checks the Initialize
 * event says the same before anything is written.
 */
export function graduatedPoolKey(token: Address, pairToken: Address, poolFee: number, tickSpacing: number, hook: Address): V4PoolKey {
  const a = token.toLowerCase();
  const b = pairToken.toLowerCase();
  const [currency0, currency1] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  return { currency0: currency0!, currency1: currency1!, fee: poolFee, tickSpacing, hooks: hook.toLowerCase() };
}

export { poolIdOf };
