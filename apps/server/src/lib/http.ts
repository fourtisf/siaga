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

async function request(url: string, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': config.sources.userAgent, Accept: '*/*' },
    });
    if (!r.ok) {
      const body = (await r.text().catch(() => '')).slice(0, 200);
      throw new FetchError(redact(url), r.status, `HTTP ${r.status} ${body}`.trim());
    }
    return r;
  } catch (e) {
    if (e instanceof FetchError) throw e;
    const msg = (e as Error).name === 'AbortError' ? `batas waktu ${timeoutMs} ms` : (e as Error).message;
    throw new FetchError(redact(url), null, msg);
  } finally {
    clearTimeout(t);
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
