import { describe, expect, it, vi } from 'vitest';

// decide() tidak menyentuh database/Redis; cukup stub modul konfigurasi & koneksi.
vi.mock('../src/config.js', () => ({
  config: { push: {}, telegram: {}, whatsapp: {}, publicAppUrl: 'https://siaga.test' },
}));
vi.mock('../src/lib/db.js', () => ({ prisma: {} }));
vi.mock('../src/lib/redis.js', () => ({ redis: {}, K: {} }));
vi.mock('../src/services/status.js', () => ({ statusFor: vi.fn() }));

const { decide, buildMessage } = await import('../src/services/alerts.js');

const t0 = new Date('2026-11-12T08:00:00Z');
const min = (m: number) => new Date(t0.getTime() + m * 60_000);

describe('decide: kirim hanya saat tingkat naik', () => {
  it('Aman → Waspada: kirim', () => expect(decide(1, 0, null, t0)).toMatchObject({ send: true, notifiedLevel: 1 }));
  it('belum pernah dinilai (null) dianggap Aman', () => expect(decide(2, null, null, t0)).toMatchObject({ send: true, notifiedLevel: 2 }));
  it('Waspada → Waspada: tidak kirim', () => expect(decide(1, 1, null, t0).send).toBe(false));
  it('Waspada → Bahaya: kirim', () => expect(decide(2, 1, null, t0)).toMatchObject({ send: true, notifiedLevel: 2 }));
  it('data tidak tersedia: tidak kirim, tidak mengubah apa pun', () => expect(decide(null, 1, null, t0)).toEqual({ send: false, notifiedLevel: 1, downSince: null }));

  it('turun lalu naik lagi dalam 60 menit: tidak kirim ulang', () => {
    const a = decide(0, 2, null, t0);
    expect(a).toMatchObject({ send: false, notifiedLevel: 2 });
    expect(a.downSince).toEqual(t0);
    const b = decide(0, a.notifiedLevel, a.downSince, min(30));
    expect(b.notifiedLevel).toBe(2);
    const c = decide(2, b.notifiedLevel, b.downSince, min(40));
    expect(c.send).toBe(false);
  });

  it('turun bertahan 60 menit lalu naik: kirim lagi', () => {
    const a = decide(0, 2, null, t0);
    const b = decide(0, a.notifiedLevel, a.downSince, min(61));
    expect(b).toMatchObject({ notifiedLevel: 0, downSince: null });
    expect(decide(1, b.notifiedLevel, b.downSince, min(70)).send).toBe(true);
  });
});

describe('buildMessage', () => {
  it('satu kalimat keadaan + satu tindakan, dengan tautan', () => {
    const m = buildMessage('Rumah', 2, 'Hujan sangat lebat', 'Waspada banjir. Pindahkan kendaraan ke tempat tinggi.');
    expect(m.title).toBe('Bahaya di Rumah');
    expect(m.body).toBe('Hujan sangat lebat. Waspada banjir. Pindahkan kendaraan ke tempat tinggi.');
    expect(m.url).toBe('https://siaga.test/');
  });
});
