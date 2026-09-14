import { writeFileSync } from 'node:fs';

/** Persist intent before send, then the hash before receipt polling. Existing intent forbids a blind retry. */
export async function journaledDeployment(file, intent, send, wait) {
  const initial = { ...intent, pending: { ...intent.pending, transactionHash: null, state: 'SENDING', note: 'intent recorded before broadcast; if interrupted, reconcile this deployer nonce and expected address before any retry' } };
  writeFileSync(file, `${JSON.stringify(initial, null, 2)}\n`, { flag: 'wx', flush: true });
  const hash = await send();
  writeFileSync(file, `${JSON.stringify({ ...initial, pending: { ...initial.pending, transactionHash: hash, state: 'SENT', note: 'hash recorded; receipt not yet confirmed' } }, null, 2)}\n`, { flush: true });
  const receipt = await wait(hash);
  // A wallet library can return a replacement's receipt. The same CREATE nonce
  // predicts the same address even when the replacement deployed different code.
  // Keep SENT and require manual reconciliation instead of finalizing old terms.
  if (typeof receipt?.transactionHash !== 'string' || receipt.transactionHash.toLowerCase() !== hash.toLowerCase()) {
    throw new Error('deployment receipt does not identify the sent transaction; retain the journal and reconcile any replacement before finalizing');
  }
  return { hash, receipt };
}
