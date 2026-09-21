/**
 * Chain identity is locked here and nowhere else.
 *
 * The profiles are separate on purpose: there is no address fallback and no
 * RPC fallback between networks. A testnet address that silently answers a
 * mainnet question is the kind of bug that only shows up in production.
 *
 * Two networks are in use at once and never share data: the desk reads
 * Robinhood Chain; the position product's candidate components live on
 * Ethereum. Every record either side writes carries its chain id, and each
 * profile takes its own RPC override, so one environment variable cannot
 * point both at the same node.
 */

export interface NetworkProfile {
  readonly id: 'robinhood-mainnet' | 'robinhood-testnet' | 'ethereum-mainnet' | 'ethereum-sepolia' | 'hardhat-local';
  readonly label: string;
  readonly chainId: number;
  readonly chainIdHex: string;
  readonly defaultRpcUrl: string;
  /** The environment variable that overrides the RPC URL for this profile only. */
  readonly rpcEnv: string;
  readonly explorerUrl: string | null;
}

export const NETWORKS: Readonly<Record<NetworkProfile['id'], NetworkProfile>> = {
  'robinhood-mainnet': {
    id: 'robinhood-mainnet',
    label: 'Robinhood Chain',
    chainId: 4663,
    chainIdHex: '0x1237',
    defaultRpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
    rpcEnv: 'CURB_RPC_URL',
    explorerUrl: 'https://robinhoodchain.blockscout.com',
  },
  'robinhood-testnet': {
    id: 'robinhood-testnet',
    label: 'Robinhood Chain (testnet)',
    chainId: 46630,
    chainIdHex: '0xb626',
    defaultRpcUrl: 'https://rpc.testnet.chain.robinhood.com',
    rpcEnv: 'CURB_RPC_URL_TESTNET',
    explorerUrl: null,
  },
  'ethereum-mainnet': {
    id: 'ethereum-mainnet',
    label: 'Ethereum',
    chainId: 1,
    chainIdHex: '0x1',
    defaultRpcUrl: 'https://ethereum-rpc.publicnode.com',
    rpcEnv: 'CURB_RPC_URL_ETHEREUM',
    explorerUrl: 'https://etherscan.io',
  },
  /** A Hardhat node on this machine, for rehearsing the position product's index and reconciliation end to end. */
  'hardhat-local': {
    id: 'hardhat-local',
    label: 'Hardhat (local)',
    chainId: 31337,
    chainIdHex: '0x7a69',
    defaultRpcUrl: 'http://127.0.0.1:8545',
    rpcEnv: 'CURB_RPC_URL_LOCAL',
    explorerUrl: null,
  },
  'ethereum-sepolia': {
    id: 'ethereum-sepolia',
    label: 'Ethereum Sepolia (testnet)',
    chainId: 11155111,
    chainIdHex: '0xaa36a7',
    defaultRpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    rpcEnv: 'CURB_RPC_URL_SEPOLIA',
    explorerUrl: 'https://sepolia.etherscan.io',
  },
};

export function profileNamed(raw: string, setting: string): NetworkProfile {
  const profile = NETWORKS[raw as NetworkProfile['id']];
  if (!profile) {
    throw new Error(`${setting}="${raw}" is not a known profile. Use one of: ${Object.keys(NETWORKS).join(', ')}`);
  }
  return profile;
}

/** The desk's network. */
export function activeNetwork(): NetworkProfile {
  return profileNamed(process.env.CURB_NETWORK ?? 'robinhood-mainnet', 'CURB_NETWORK');
}

/** The network the position product's components are looked for on. */
export function positionsNetwork(): NetworkProfile {
  return profileNamed(process.env.CURB_POSITIONS_NETWORK ?? 'ethereum-mainnet', 'CURB_POSITIONS_NETWORK');
}

export function rpcUrl(profile: NetworkProfile = activeNetwork()): string {
  return process.env[profile.rpcEnv] ?? profile.defaultRpcUrl;
}

/**
 * Which reads go to the operator's own endpoint first. The operator's endpoint
 * is paid for by the call; the public node is not, and answers everything at
 * the head of the chain. What only a paid endpoint serves well is history:
 * wide `eth_getLogs` (the public node refuses a query matching more than ten
 * thousand logs) and state at a past block (it keeps about ten minutes of
 * state). So by default those go to the operator's endpoint first and
 * everything read at `latest` goes to the public node first, each with the
 * other as its fallback — a balance lasts, and running it out costs the desk
 * its history reads, not its prices.
 *
 * `CURB_RPC_ROUTE=all` sends every read to the operator's endpoint first, as
 * before 21 September 2026.
 */
export const RPC_ROUTE_ENV = 'CURB_RPC_ROUTE';

export function prefersOwnEndpoint(method: string, params: readonly unknown[] = []): boolean {
  if (process.env[RPC_ROUTE_ENV] === 'all') return true;
  if (method === 'eth_getLogs') return true;
  // A call pinned to a block number reads the past: eth_call, eth_getCode,
  // eth_getStorageAt and eth_getBalance take the block as their last argument.
  const tag = params[params.length - 1];
  return typeof tag === 'string' && /^0x[0-9a-f]+$/i.test(tag) && ['eth_call', 'eth_getCode', 'eth_getStorageAt', 'eth_getBalance'].includes(method);
}

/**
 * The endpoints for a profile, in the order they are tried. With an operator
 * endpoint set (the environment override), both are tried, in the order
 * `prefersOwnEndpoint` gives for the read; without one, the public node alone.
 * A read that the first cannot make — the transport, a timeout, a quota, a
 * spent balance — is made on the second; an answer, right or wrong, is never
 * second-guessed on another node.
 */
export function rpcUrls(profile: NetworkProfile = activeNetwork(), preferOwn = true): readonly string[] {
  const own = process.env[profile.rpcEnv];
  if (!own || own === profile.defaultRpcUrl) return [profile.defaultRpcUrl];
  return preferOwn ? [own, profile.defaultRpcUrl] : [profile.defaultRpcUrl, own];
}

/** An explorer link for an address, or null where the network publishes no explorer. */
export function explorerAddress(profile: NetworkProfile, address: string): string | null {
  return profile.explorerUrl === null ? null : `${profile.explorerUrl}/address/${address}`;
}
