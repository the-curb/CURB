import type { Store } from '../store/types.ts';
import { currentDeskCode, currentRate, LAUNCH_READ_MAX_AGE_MS } from '../launch/evidence.ts';
import { latestDeskCode } from './code.ts';
import type { CreditsStatus } from './config.ts';
import { latestRate } from './maintenance.ts';

/** One set of evidence for quotes and every payment invitation. It does not gate spending existing credits. */
export async function topUpReadiness(store: Store, status: CreditsStatus, now = new Date()) {
  const [code, rateRead] = await Promise.all([
    status.state === 'CONFIGURED' ? latestDeskCode(store, status.config) : null,
    status.state === 'CONFIGURED' ? latestRate(store, status.config) : null,
  ]);
  const codeCurrent = status.state === 'CONFIGURED' && code?.storeFault === null && currentDeskCode(code.code, status.config, now);
  const rateCurrent = status.state === 'CONFIGURED' && rateRead?.storeFault === null && currentRate(rateRead.rate, status.config, now);
  const held = status.state !== 'CONFIGURED' ? status.detail
    : code?.storeFault ? `the desk verification could not be read (${code.storeFault}); check /api/credits before sending a top-up`
    : !codeCurrent ? `the desk is not verified as the build for the current chain, address, token and treasury within the last ${LAUNCH_READ_MAX_AGE_MS / 60_000} minutes; check /api/credits before sending a top-up`
    : rateRead?.storeFault ? `the rate could not be read (${rateRead.storeFault}); check /api/credits before sending a top-up`
    : !rateCurrent ? `there is no current rate for the configured token, pool and quote source within the last ${LAUNCH_READ_MAX_AGE_MS / 60_000} minutes; check /api/credits before sending a top-up`
    : null;
  const validUntil = codeCurrent && rateCurrent && code?.code && rateRead?.rate?.state === 'READ'
    ? new Date(Math.min(Date.parse(code.code.readAt), Date.parse(rateRead.rate.at), Date.parse(rateRead.rate.rate.readAt)) + LAUNCH_READ_MAX_AGE_MS).toISOString()
    : null;
  return {
    code, rateRead,
    quoteReadiness: { codeCurrent, rateCurrent, maxReadAgeSeconds: LAUNCH_READ_MAX_AGE_MS / 1000 },
    topUp: status.state === 'CONFIGURED' && codeCurrent && rateCurrent ? {
      desk: status.config.desk, network: status.config.network.id, chainId: status.config.network.chainId,
      token: status.config.token, treasury: status.config.treasury,
      tokenDecimals: rateRead?.rate?.state === 'READ' ? rateRead.rate.rate.token.decimals : null,
      call: 'topUp(bytes32 keyHash, uint256 amount)', quote: '/api/credits?usd=20',
      checkedAt: now.toISOString(),
      validUntil,
    } : null,
    topUpHeld: held,
  };
}
