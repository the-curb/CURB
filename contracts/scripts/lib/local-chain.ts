/** A rehearsal can only use a loopback RPC and must verify chain id before sending. */
export function assertLoopbackRpc(value: string): void {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) {
    throw new Error('rehearsal refused: RPC must be an uncredentialed loopback URL');
  }
}
