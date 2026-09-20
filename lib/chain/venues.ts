/**
 * The venues that hold a market in these tokens, as the deployer published them.
 *
 * Every address here comes from Uniswap's own deployment record for chain 4663
 * (`Uniswap/contracts`, `deployments/json/4663.json`), not from an aggregator's
 * label and not from a block explorer's search box. An aggregator names a pool
 * "NVDA / USDG 0.05%" without saying which factory made it; the factory itself
 * answers that question and nothing else does.
 *
 * Two shapes of venue live here and they are read differently:
 *
 *   v2 / v3   a pool is a contract with an address. The factory is asked for it
 *             (`getPair`, `getPool`), and the pool answers `getReserves` or
 *             `slot0` / `liquidity` about itself.
 *   v4        a pool has no address at all. Every pool lives inside the one
 *             PoolManager and is named by the hash of its key. The id is
 *             recomputed from the key we carry (`lib/chain/uniswap-v4.ts`) and
 *             the StateView lens is asked about that id.
 *
 * A pool that is not discoverable from one of these factories is not read here.
 * That is a stated boundary, not an oversight: a venue this desk cannot name
 * cannot be described, and a price from a venue nobody can point at is worth
 * less than no price.
 */

/** Read from `Uniswap/contracts` deployments/json/4663.json on 20 September 2026. */
export const VENUE_SOURCE = {
  url: 'https://raw.githubusercontent.com/Uniswap/contracts/main/deployments/json/4663.json',
  retrievedAt: '2026-09-20T13:45:00Z',
  network: 'Robinhood Chain',
  chainId: 4663,
} as const;

export const VENUES = {
  /** Constant-product pairs. Reserves are the whole book, so its depth is exact. */
  v2Factory: '0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f',
  /** Concentrated liquidity. `slot0` and `liquidity` describe the current tick only. */
  v3Factory: '0x1f7d7550b1b028f7571e69a784071f0205fd2efa',
  /** The v4 singleton. Every v4 pool's state and every v4 event belongs to it. */
  poolManager: '0x8366a39cc670b4001a1121b8f6a443a643e40951',
  /** The read-only lens over the PoolManager's storage. `poolManager()` must answer the address above. */
  stateView: '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b',
  /** Simulates a swap exactly. Not used by the desk: see `THE BOUND IS NOT A QUOTE` below. */
  v4Quoter: '0x8dc178efb8111bb0973dd9d722ebeff267c98f94',
  quoterV2: '0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7',
} as const;

export type VenueKind = 'v2' | 'v3' | 'v4';

/**
 * The fee tiers the v3 factory was asked for. A tier absent from this list was
 * never asked about, which is not the same as a tier with no pool — and the
 * capture records which it is.
 */
export const V3_FEE_TIERS = [100, 500, 3000, 10000] as const;

/**
 * Fee and tick spacing travel together in a v4 key, so the pairs are declared
 * together. `[0, 200]` is the shape a PONS v2 graduation creates: the pool fee
 * is zero because the hook takes its cut instead.
 */
export const V4_TIERS: readonly (readonly [fee: number, tickSpacing: number])[] = [
  [100, 1],
  [500, 10],
  [3000, 60],
  [10000, 200],
  [0, 200],
];

/**
 * The hooks asked about. A pool whose key names a hook outside this list exists
 * and is not found by this capture — the same stated boundary as a fee tier
 * nobody asked for.
 */
export const V4_HOOKS = [
  '0x0000000000000000000000000000000000000000',
  /** The PONS v2 meme hook: every graduated curve pool carries it. */
  '0xe5e702641ea86f4ae6cc3cdaed2b886f976be044',
] as const;

/**
 * THE BOUND IS NOT A QUOTE.
 *
 * Uniswap ships a Quoter on this chain that simulates a swap exactly, and the
 * desk does not use it. The reason is stated here so it is a decision rather
 * than a gap: a quoter answers "what would this trade fill at, at this block,
 * routed this way" — which is an execution question, and answering execution
 * questions is what this desk refuses to do. What is published instead is an
 * arithmetic bound over state the pool has already published: the size that
 * moves the mid one percent against the liquidity in force right now. It is a
 * property of the book, not an offer, and the page says so on every row.
 */
export const QUOTER_NOT_USED =
  'A quoter simulates a fill. This desk publishes a bound computed from published state, because a fill is an execution question and this desk does not answer those.';
