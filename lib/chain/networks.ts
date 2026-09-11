/**
 * Chain identity is locked here and nowhere else.
 *
 * The two profiles are separate on purpose: there is no address fallback and no
 * RPC fallback between networks. A testnet address that silently answers a
 * mainnet question is the kind of bug that only shows up in production.
 */

export interface NetworkProfile {
  readonly id: 'robinhood-mainnet' | 'robinhood-testnet';
  readonly label: string;
  readonly chainId: number;
  readonly chainIdHex: string;
  readonly defaultRpcUrl: string;
  readonly explorerUrl: string | null;
}

export const NETWORKS: Readonly<Record<NetworkProfile['id'], NetworkProfile>> = {
  'robinhood-mainnet': {
    id: 'robinhood-mainnet',
    label: 'Robinhood Chain',
    chainId: 4663,
    chainIdHex: '0x1237',
    defaultRpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
    explorerUrl: null,
  },
  'robinhood-testnet': {
    id: 'robinhood-testnet',
    label: 'Robinhood Chain (testnet)',
    chainId: 46630,
    chainIdHex: '0xb626',
    defaultRpcUrl: 'https://rpc.testnet.chain.robinhood.com',
    explorerUrl: null,
  },
};

export function activeNetwork(): NetworkProfile {
  const raw = process.env.CURB_NETWORK ?? 'robinhood-mainnet';
  const profile = NETWORKS[raw as NetworkProfile['id']];
  if (!profile) {
    throw new Error(
      `CURB_NETWORK="${raw}" is not a known profile. Use one of: ${Object.keys(NETWORKS).join(', ')}`,
    );
  }
  return profile;
}

export function rpcUrl(profile: NetworkProfile = activeNetwork()): string {
  return process.env.CURB_RPC_URL ?? profile.defaultRpcUrl;
}
