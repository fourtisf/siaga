import { config } from '../config.js';

export class FetchError extends Error {
  constructor(
    public url: string,
    public status: number | null,
    msg: string,
  ) {
    super(msg);
    this.name = 'FetchError';
  }
}

/** Sembunyikan kunci API saat URL dicatat di log atau database. */
export function redact(url: string): string {
  return url
    .replace(/(apikey=)[^&]+/gi, '$1***')
    .replace(/(\/api\/area\/csv\/)[^/]+/, '$1***');
}

/**
 * Jeda per host setelah HTTP 429 (kuota/batas permintaan), supaya worker tidak terus
 * menghantam sumber yang sudah membatasi. Disimpan di memori proses.
 */
const backoff = new Map<string, { until: number; reason: string }>();
const BACKOFF_MS = 30 * 60_000;

export function backoffState(host: string) {
  const b = backoff.get(host);
  return b && b.until > Date.now() ? b : null;
}

async function once(url: string, timeoutMs: number): Promise<Response> {
  const host = new URL(url).host;
  const b = backoffState(host);
  if (b) throw new FetchError(redact(url), 429, `ditunda sampai ${new Date(b.until).toISOString().slice(11, 16)} UTC: ${b.reason}`);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': config.sources.userAgent, Accept: '*/*' },
    });
    if (!r.ok) {
      const body = (await r.text().catch(() => '')).slice(0, 200);
      if (r.status === 429) {
        const ra = Number(r.headers.get('retry-after'));
        backoff.set(host, { until: Date.now() + (Number.isFinite(ra) && ra > 0 ? ra * 1000 : BACKOFF_MS), reason: `HTTP 429 ${body}`.slice(0, 160) });
      }
      throw new FetchError(redact(url), r.status, `HTTP ${r.status} ${body}`.trim());
    }
    return r;
  } catch (e) {
    if (e instanceof FetchError) throw e;
    const err = e as Error & { cause?: { code?: string } };
    const msg = err.name === 'AbortError' ? `batas waktu ${timeoutMs} ms` : `${err.message}${err.cause?.code ? ` (${err.cause.code})` : ''}`;
    throw new FetchError(redact(url), null, msg);
  } finally {
    clearTimeout(t);
  }
}

/** Coba ulang sekali untuk galat jaringan, batas waktu, atau 5xx. 4xx tidak dicoba ulang. */
async function request(url: string, timeoutMs: number, retries = 1): Promise<Response> {
  for (let i = 0; ; i++) {
    try {
      return await once(url, timeoutMs);
    } catch (e) {
      const fe = e as FetchError;
      const retryable = fe.status === null || (fe.status >= 500 && fe.status < 600);
      if (!retryable || i >= retries) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
}

export async function getJson<T = unknown>(url: string, timeoutMs = 15_000): Promise<T> {
  const r = await request(url, timeoutMs);
  const text = await r.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new FetchError(redact(url), r.status, `bukan JSON: ${text.slice(0, 80)}`);
  }
}

export async function getText(url: string, timeoutMs = 30_000): Promise<string> {
  const r = await request(url, timeoutMs);
  return r.text();
}
