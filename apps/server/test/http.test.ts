import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config.js', () => ({ config: { sources: { userAgent: 'SIAGA-test' } } }));
const { getJson, backoffState, FetchError } = await import('../src/lib/http.js');

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

afterEach(() => vi.unstubAllGlobals());

describe('http: coba ulang dan jeda', () => {
  it('mencoba ulang sekali setelah galat jaringan', async () => {
    const f = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(ok({ a: 1 }));
    vi.stubGlobal('fetch', f);
    await expect(getJson('https://contoh-1.test/x')).resolves.toEqual({ a: 1 });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('tidak mencoba ulang 4xx', async () => {
    const f = vi.fn().mockResolvedValue(new Response('no', { status: 404 }));
    vi.stubGlobal('fetch', f);
    await expect(getJson('https://contoh-2.test/x')).rejects.toBeInstanceOf(FetchError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('HTTP 429 → host ditunda, permintaan berikutnya tidak dikirim', async () => {
    const f = vi.fn().mockResolvedValue(new Response('{"reason":"Daily API request limit exceeded"}', { status: 429 }));
    vi.stubGlobal('fetch', f);
    await expect(getJson('https://contoh-3.test/x')).rejects.toThrow(/429/);
    expect(backoffState('contoh-3.test')).not.toBeNull();
    await expect(getJson('https://contoh-3.test/y')).rejects.toThrow(/ditunda/);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
