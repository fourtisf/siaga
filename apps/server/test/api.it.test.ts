/**
 * Uji integrasi HTTP. Butuh PostgreSQL+PostGIS dan Redis sungguhan (DATABASE_URL, REDIS_URL).
 * Jalankan dengan: SIAGA_IT=1 pnpm --filter @siaga/server test
 * Tidak memanggil sumber luar: data sumber diisi langsung ke Redis.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const run = process.env.SIAGA_IT === '1';

describe.skipIf(!run)('API (integrasi)', () => {
  let app: FastifyInstance;
  let token: string;
  let prisma: any, redis: any;
  const created: string[] = [];

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.SOURCE_OPEN_METEO = '0'; // jangan ambil cuaca sungguhan
    // Redis DB terpisah supaya tidak bercampur dengan worker pengembangan
    process.env.REDIS_URL = process.env.REDIS_URL_TEST ?? 'redis://127.0.0.1:6379/15';
    ({ prisma } = await import('../src/lib/db.js'));
    ({ redis } = await import('../src/lib/redis.js'));
    await redis.flushdb();
    const { buildApp } = await import('../src/app.js');
    // Kondisi sumber: gempa segar, sisanya tidak ada
    await redis.set('siaga:feed:gempa', JSON.stringify({ lastSuccessAt: Date.now(), lastAttemptAt: Date.now(), source: 'BMKG', error: null }));
    await redis.set(
      'siaga:data:gempa',
      JSON.stringify([{ id: 'bmkg:it', t: Date.now() - 600_000, lat: -6.3, lon: 106.9, m: 5.8, depthKm: 10, place: 'Uji', tsunami: false, src: 'BMKG' }]),
    );
    app = await buildApp();
  });

  afterAll(async () => {
    if (created.length) await prisma.device.deleteMany({ where: { id: { in: created } } });
    await app?.close();
    await prisma?.$disconnect();
    redis?.disconnect();
  });

  it('GET /status: gempa M5,8 dekat → Bahaya; sumber lain "belum tersedia"', async () => {
    const r = await app.inject({ url: '/status?lat=-6.2&lon=106.82&name=Jakarta' });
    expect(r.statusCode).toBe(200);
    const s = r.json();
    expect(s.level).toBe(2);
    expect(s.conditions[0].kind).toBe('gempa');
    expect(s.conditions.find((c: any) => c.kind === 'hujan').available).toBe(false);
    expect(s.missing).toContain('cuaca');
  });

  it('GET /status tanpa koordinat → 400', async () => {
    expect((await app.inject({ url: '/status' })).statusCode).toBe(400);
  });

  it('perangkat → lokasi → laporan → duplikat', async () => {
    const d = (await app.inject({ method: 'POST', url: '/devices' })).json();
    token = d.token;
    created.push(d.deviceId);
    const auth = { authorization: `Bearer ${token}` };
    const p = await app.inject({ method: 'POST', url: '/places', headers: auth, payload: { name: 'Rumah', lat: -6.26, lon: 106.81 } });
    expect(p.statusCode).toBe(201);

    const form = (text: string) => {
      const b = '----siaga';
      const f = (k: string, v: string) => `--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
      return {
        payload: f('kind', 'Pohon tumbang') + f('text', text) + f('lat', '-6.2601') + f('lon', '106.8101') + `--${b}--\r\n`,
        headers: { ...auth, 'content-type': `multipart/form-data; boundary=${b}` },
      };
    };
    const a = await app.inject({ method: 'POST', url: '/reports', ...form('pertama') });
    expect(a.statusCode).toBe(201);
    expect(a.json().status).toBe('pending');
    const b = await app.inject({ method: 'POST', url: '/reports', ...form('kedua') });
    expect(b.json()).toMatchObject({ status: 'duplicate', duplicateOf: a.json().id });

    // belum dimoderasi → tidak tampil publik
    const pub = await app.inject({ url: '/reports?near=-6.26,106.81' });
    expect(pub.json().find((x: any) => x.id === a.json().id)).toBeUndefined();
  });

  it('tanpa token → 401', async () => {
    expect((await app.inject({ url: '/places' })).statusCode).toBe(401);
  });
});
