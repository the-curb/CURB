/**
 * A key made where it is used: thirty-two random bytes, base64url, behind
 * `curb_` — the same shape keys.ts makes on the server — and its SHA-256 hash.
 * Web Crypto only, so it runs in a browser and in Node alike, and nothing is
 * sent anywhere to make it.
 */

export function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `0x${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export async function newBrowserKey(): Promise<{ readonly key: string; readonly hash: string }> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const key = `curb_${base64url(bytes)}`;
  return { key, hash: await sha256Hex(key) };
}
