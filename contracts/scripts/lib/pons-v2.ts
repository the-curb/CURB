/**
 * PONS v2, the venue the product owner chose on 17 September 2026, as far
 * as the operator's tools need it: the factory's interface (from the
 * Sourcify exact-match verification of the deployed contract, solc 0.8.35,
 * read 17 September), the addresses read from the chain that day, and how a
 * launch's graduated pool is named (pons-v2-facts.ts, dependency-free, so the
 * site's tests can hold the tools to it). Nothing here is a term of The Curb's;
 * every tool re-reads the venue's live settings in the block it acts, since
 * the venue's owner may change them between a read and a transaction
 * (docs/mainnet/EXTERNAL-FACTS-2026-09-17-PONS-V2.md).
 */

import { parseAbi } from 'viem';

export { NATIVE, PHASES, PONS_V2, graduatedPoolKey, poolIdOf } from './pons-v2-facts.ts';

/** The factory's ABI, the parts the tools call — signatures as verified — and every error it declares, so a refusal is named, not a bare selector. */
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
  'function maxCreatorTaxBps() view returns (uint256)',
  'function snipeTaxSeconds() view returns (uint256)',
  'function snipeTaxStartBps() view returns (uint256)',
  'function GRADUATION_RESCUE_DELAY() view returns (uint256)',
  'function launchToken((string name, string symbol, string logo, string description, (string twitter, string telegram, string discord, string website, string farcaster) socials, address creatorFeeRecipient, uint16 creatorTaxBps, bool buybackEnabled, bytes32 expectedEconomics, bytes32 salt) params, uint256 launchConfigId, address pairToken) payable returns (address token, address curve)',
  'function createGraduatedPool(address token)',
  'event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)',
  'event LaunchSwept(address indexed token, uint256 quoteOut, uint256 tokenOut)',
  'event PoolGraduated(address indexed token, uint256 positionId, uint256 tokenAmount, uint256 pairTokenAmount)',
  'event GraduationTokensPermanentlyLocked(address indexed token, uint256 amount)',
  'error AlreadySet()',
  'error CombinedFeeTooHigh()',
  'error CoreLpFeeMustBeZero()',
  'error CreatorTaxTooHigh()',
  'error CurveFeeTooHigh()',
  'error CurveNotQuotable()',
  'error ExemptionListTooLong()',
  'error FeeTransferFailed()',
  'error GraduationExecutorNotSet()',
  'error GraduationRescueTooEarly(uint256 availableAt)',
  'error GraduationSeedNotViable()',
  'error GraduationStillViable()',
  'error InexactTransfer(address token, uint256 expected, uint256 received)',
  'error InvalidBasisPoints()',
  'error InvalidGraduationThreshold()',
  'error InvalidLaunchConfigId()',
  'error InvalidPhantomQuote()',
  'error InvalidSnipeTaxWindow()',
  'error InvalidTickSpacing()',
  'error InvalidTokenParams()',
  'error LaunchConfigDisabled()',
  'error LaunchDependenciesNotWired()',
  'error LaunchDeployerNotSet()',
  'error LaunchEconomicsMismatch(bytes32 expected, bytes32 actual)',
  'error LaunchFeeNotPaid()',
  'error NoPendingChange()',
  'error NotBuybackController()',
  'error NotCreatorFeeRecipient()',
  'error NotLaunchForwarder()',
  'error NotReadyToGraduate()',
  'error NotWhitelisted()',
  'error NothingToGraduate()',
  'error OwnableInvalidOwner(address owner)',
  'error OwnableUnauthorizedAccount(address account)',
  'error OwnershipCannotBeRenounced()',
  'error PairTokenDecimalsMismatch(uint8 expected, uint8 actual)',
  'error PairTokenDecimalsUnavailable()',
  'error PairTokenEconomicsInvalid()',
  'error PairTokenNotApproved()',
  'error PairTokenValidationFailed()',
  'error ReentrancyGuardReentrantCall()',
  'error SafeERC20FailedOperation(address token)',
  'error SqrtPriceOutOfBounds()',
  'error SupplyTooHigh()',
  'error SupplyTooLow()',
  'error TimelockExpired(uint256 expiresAt)',
  'error TimelockNotElapsed(uint256 effectiveAt)',
  'error TokenNotFound()',
  'error UnsupportedPrice()',
  'error WrongGraduationPhase()',
  'error ZeroAddress()',
  'error ZeroAmount()',
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
