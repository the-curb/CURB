import { AGENTS } from '../agents/registry.ts';

export const HEALTH_MAX_AGE_MS = 120_000;
export const HEALTH_CLOCK_SKEW_MS = 30_000;
export const HEALTH_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 1_048_576;
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const isoTime = (v: unknown): number | null => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)) return null;
  const at = Date.parse(v);
  return Number.isFinite(at) && new Date(at).toISOString() === v ? at : null;
};
export interface HealthProbe {
  state: 'HEALTHY' | 'UNHEALTHY';
  checkedAt: string;
  observedAt: string | null;
  reportingLastHour: number | null;
  agents: number | null;
  reasons: string[];
  freshness: { maxAgeSeconds: number; allowedClockSkewSeconds: number };
}

/** Operational evidence only. HEALTHY does not establish mainnet launch readiness. */
export function assessHealth(raw: unknown, now = new Date()): HealthProbe {
  const reasons: string[] = [];
  const data = object(raw) ? raw : {};
  if (!object(raw)) reasons.push('response is not a state object');
  if (data.state !== 'READ') reasons.push('store state is not READ');
  const observed = isoTime(data.observedAt);
  if (observed === null) reasons.push('observedAt is missing or malformed');
  else if (now.getTime() - observed > HEALTH_MAX_AGE_MS) reasons.push('state response is older than 120 seconds');
  else if (observed - now.getTime() > HEALTH_CLOCK_SKEW_MS) reasons.push('state response is more than 30 seconds in the future');
  const reporting = object(data.warden) ? data.warden.reportingLastHour : null;
  const validReporting = typeof reporting === 'number' && Number.isSafeInteger(reporting) && reporting > 0;
  if (!validReporting) reasons.push('reportingLastHour must be a positive finite whole number');
  if (!object(data.storeSchema) || data.storeSchema.state !== 'CURRENT') reasons.push('store schema is not confirmed CURRENT');
  if (!Array.isArray(data.conditions)) reasons.push('conditions must be a readable array');
  else {
    if (data.conditions.some(c => !object(c) || typeof c.id !== 'string' || c.id.length === 0 || !['DARK', 'STALE', 'NOTE'].includes(String(c.severity)) || typeof c.text !== 'string')) reasons.push('conditions contain malformed entries');
    if (data.conditions.some(c => object(c) && c.severity === 'DARK')) reasons.push('one or more DARK conditions stand');
  }
  if (!Array.isArray(data.agents) || data.agents.length === 0) reasons.push('agent roster is missing or empty');
  else {
    const roster = data.agents;
    if (roster.length !== AGENTS.length || roster.some(a => !object(a) || !AGENTS.some(spec => spec.id === a.id))) reasons.push('agent roster does not match the registered agents');
    for (const spec of AGENTS) {
      if (roster.filter(a => object(a) && a.id === spec.id).length !== 1) { reasons.push('agent roster has missing or duplicate entries'); break; }
    }
    if (roster.some(a => !object(a) || !['LIVE', 'STALE', 'ABSENT', 'DEGRADED', 'ON_REQUEST', 'NOT_OBSERVED'].includes(String(a.health)))) reasons.push('agent health is missing or malformed');
    if (roster.some(a => object(a) && a.health === 'ABSENT')) reasons.push('one or more agents are ABSENT');
    if (roster.some(a => object(a) && AGENTS.some(spec => spec.id === a.id && spec.intervalSeconds !== null) && ['NOT_OBSERVED', 'ON_REQUEST'].includes(String(a.health)))) reasons.push('a scheduled agent has no demonstrated run');
    if (validReporting && reporting > roster.length) reasons.push('reportingLastHour exceeds the agent roster');
  }
  return {
    state: reasons.length ? 'UNHEALTHY' : 'HEALTHY', checkedAt: now.toISOString(),
    observedAt: observed === null ? null : new Date(observed).toISOString(),
    reportingLastHour: validReporting ? reporting : null,
    agents: Array.isArray(data.agents) ? data.agents.length : null,
    reasons: [...new Set(reasons)],
    freshness: { maxAgeSeconds: HEALTH_MAX_AGE_MS / 1000, allowedClockSkewSeconds: HEALTH_CLOCK_SKEW_MS / 1000 },
  };
}

/** Accept HTTPS, plus HTTP loopback for local checks; errors never echo a URL. */
export function healthTarget(input: string): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('provide a valid health endpoint URL'); }
  if (url.username || url.password) throw new Error('URL user information is not supported');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('health endpoint must use HTTPS, or HTTP on loopback');
  if (url.pathname === '/' || url.pathname === '/api/tick') url.pathname = '/api/state';
  if (url.pathname !== '/api/state') throw new Error('health endpoint path must be /api/state');
  url.hash = '';
  return url;
}

/** A single GET: redirects refused, bounded body, timeout covers headers and body. */
export async function probeHealth(target: string, options: { timeoutMs?: number; fetcher?: typeof fetch; now?: () => Date } = {}): Promise<HealthProbe> {
  const now = options.now ?? (() => new Date());
  const failure = (reason: string): HealthProbe => ({ ...assessHealth(null, now()), reasons: [reason] });
  let url: URL;
  try { url = healthTarget(target); } catch { return failure('invalid endpoint: use /api/state over HTTPS, or HTTP loopback, without URL user information'); }
  const timeoutMs = options.timeoutMs ?? HEALTH_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) return failure('probe timeout must be between 1 and 60000 milliseconds');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetcher ?? fetch)(url, { method: 'GET', cache: 'no-store', redirect: 'error', headers: { accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) { await response.body?.cancel(); return failure(`health endpoint returned HTTP ${response.status}`); }
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) { await response.body?.cancel(); return failure('health endpoint did not return JSON'); }
    if (!response.body) return failure('health endpoint returned an empty body');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0, body = '';
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_BODY_BYTES) { await reader.cancel(); return failure('health response exceeds the size limit'); }
        body += decoder.decode(chunk.value, { stream: true });
      }
      body += decoder.decode();
    } finally { reader.releaseLock(); }
    let data: unknown;
    try { data = JSON.parse(body); } catch { return failure('health endpoint returned malformed JSON'); }
    return assessHealth(data, now());
  } catch { return failure(controller.signal.aborted ? 'health request timed out' : 'health request failed or attempted a redirect'); }
  finally { clearTimeout(timer); }
}
