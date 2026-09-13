import { writeFileSync } from 'node:fs';

/** Persist intent before send, then the hash before receipt polling. Existing intent forbids a blind retry. */
export async function journaledDeployment(file, intent, send, wait) {
  const initial = { ...intent, pending: { ...intent.pending, transactionHash: null, state: 'SENDING', note: 'intent recorded before broadcast; if interrupted, reconcile this deployer nonce and expected address before any retry' } };
  writeFileSync(file, `${JSON.stringify(initial, null, 2)}\n`, { flag: 'wx', flush: true });
  const hash = await send();
  writeFileSync(file, `${JSON.stringify({ ...initial, pending: { ...initial.pending, transactionHash: hash, state: 'SENT', note: 'hash recorded; receipt not yet confirmed' } }, null, 2)}\n`, { flush: true });
  const receipt = await wait(hash);
  return { hash, receipt };
}
