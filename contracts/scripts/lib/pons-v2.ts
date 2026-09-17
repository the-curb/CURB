/**
 * PONS v2, the venue the product owner chose on 17 September 2026, as far
 * as the operator's tools need it: the factory's interface (from the
 * Sourcify exact-match verification of the deployed contract, solc 0.8.35,
 * read 17 September), the addresses read from the chain that day, and how a
 * launch's graduated pool is named. Nothing here is a term of The Curb's;
 * every tool re-reads the venue's live settings in the block it acts, since
 * the venue's owner may change them between a read and a transaction
 * (docs/mainnet/EXTERNAL-FACTS-2026-09-17-PONS-V2.md).
 */

import { parseAbi, type Address } from 'viem';
import { poolIdOf, type V4PoolKey } from '../../../lib/chain/uniswap-v4.ts';

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

/** The factory's ABI, the parts the tools call — signatures as verified. */
export const factoryAbi = parseAbi([
  'function launchEnabled() view returns (bool)',
  'function canLaunch(address launcher) view returns (bool)',
  'function whitelistedLaunchers(address launcher) view returns (bool)',
  'function launchFee() view returns (uint256)',
  'function launchConfigCount() view returns (uint256)',
  'function getLaunchConfig(uint256 id) view returns ((uint256 supply, uint256 curveFeeBps, uint256 phantomQuote, uint256 graduationThreshold, uint24 poolFee, int24 tickSpacing, bool enabled))',
  'function approvedPairTokens(address pairToken) view returns (bool)',
  'function pairTokenEconomics(address pairToken) view returns (uint256 phantomQuote, uint256 graduationThreshold, uint8 decimals)',
  'function previewLaunchEconomics(uint256 launchConfigId, address pairToken) view returns (bytes32)',
  'function getLaunchedToken(address token) view returns ((address token, address curve, address deployer, address creatorFeeRecipient, address pairToken, uint256 graduationThreshold, uint24 poolFee, int24 tickSpacing, uint16 creatorTaxBps, bool buybackEnabled, uint8 phase, uint256 sweptQuote, uint256 sweptTokens, uint256 sweptAt, bool exists))',
  'function getLaunchFeePolicy(address token) view returns ((address protocolFeeRecipient, uint16 protocolFeeShareBps, uint16 buybackBurnBps, uint16 hookFeeBps, uint16 maxInternalPriceImpactBps))',
  'function memeHook() view returns (address)',
  'function locker() view returns (address)',
  'function poolManager() view returns (address)',
  'function owner() view returns (address)',
  'function maxCreatorTaxBps() view returns (uint16)',
  'function snipeTaxSeconds() view returns (uint256)',
  'function snipeTaxStartBps() view returns (uint256)',
  'function GRADUATION_RESCUE_DELAY() view returns (uint256)',
  'function launchToken((string name, string symbol, string logo, string description, (string twitter, string telegram, string discord, string website, string farcaster) socials, address creatorFeeRecipient, uint16 creatorTaxBps, bool buybackEnabled, bytes32 expectedEconomics, bytes32 salt) params, uint256 launchConfigId, address pairToken) payable returns (address token, address curve)',
  'function createGraduatedPool(address token)',
  'event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)',
  'event LaunchSwept(address indexed token, uint256 quoteOut, uint256 tokenOut)',
  'event PoolGraduated(address indexed token, uint256 positionId, uint256 tokenAmount, uint256 pairTokenAmount)',
  'event GraduationTokensPermanentlyLocked(address indexed token, uint256 amount)',
]);

/** The curve, as the live instances answered on 17 September (the per-launch curves are not verified on Sourcify; a curve that does not answer these is reported, not guessed at). */
export const curveAbi = parseAbi([
  'function readyToGraduate() view returns (bool)',
  'function realQuoteReserve() view returns (uint256)',
  'function sellableTokens() view returns (uint256)',
  'function reservedTokens() view returns (uint256)',
  'function tokenReserve() view returns (uint256)',
  'function getReserves() view returns (uint256, uint256)',
  'function feeBps() view returns (uint256)',
  'function isNativeQuote() view returns (bool)',
]);

export const erc20Abi = parseAbi(['function name() view returns (string)', 'function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function totalSupply() view returns (uint256)']);

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
