import { describe, expect, it } from 'vitest';
import { assess, nearby, type AssessInput, type FeedKey, type FeedStatus, type Quake, type Volcano } from '../src/index.js';

const NOW = Date.parse('2026-11-12T08:00:00Z');
const JKT = { lat: -6.2, lon: 106.82, name: 'Jakarta' };

const feed = (key: FeedKey, ok = true, ageMin = 1): FeedStatus => ({
  key,
  available: ok,
  lastSuccessAt: NOW - ageMin * 60_000,
  lastAttemptAt: NOW,
  source: 'tes',
});
const allFeeds = () =>
  Object.fromEntries((['gempa', 'banjir', 'cuaca', 'udara', 'api', 'gunung'] as FeedKey[]).map((k) => [k, feed(k)])) as Record<FeedKey, FeedStatus>;

const base = (over: Partial<AssessInput> = {}): AssessInput => ({
  now: NOW,
  feeds: allFeeds(),
  quakes: [],
  weather: { lat: JKT.lat, lon: JKT.lon, now: 0, temp: 30, wind: 10, past24: 0, next24: 0, at: NOW, fetchedAt: NOW - 60_000 },
  air: { lat: JKT.lat, lon: JKT.lon, aqi: 40, pm25: 8, pm10: 12, at: NOW, fetchedAt: NOW - 60_000 },
  hotspots: [],
  volcanoes: [],
  ...over,
});

const quake = (o: Partial<Quake>): Quake => ({
  id: 'q', t: NOW - 3600_000, lat: JKT.lat, lon: JKT.lon, m: 4, depthKm: 10, place: 'x', tsunami: false, src: 'BMKG', ...o,
});
// ~1° lintang ≈ 111 km
const latAt = (kmNorth: number) => JKT.lat + kmNorth / 111.2;

describe('assess: tingkat keseluruhan', () => {
  it('semua aman', () => {
    const a = assess(JKT, base());
    expect(a.level).toBe(0);
    expect(a.label).toBe('Aman');
    expect(a.sentence).toBe('Tidak ada ancaman di sekitar Jakarta saat ini.');
    expect(a.conditions.map((c) => c.kind)).toEqual(['gempa', 'hujan', 'udara', 'api']);
  });

  it('tanpa data sama sekali → "Belum ada data", bukan "Aman"', () => {
    const a = assess(JKT, base({ feeds: {}, weather: null, air: null }));
    expect(a.level).toBeNull();
    expect(a.label).toBe('Belum ada data');
    expect(a.conditions.every((c) => !c.available)).toBe(true);
  });

  it('sumber kedaluwarsa tampil "belum tersedia" dengan waktu terakhir', () => {
    const feeds = allFeeds();
    feeds.gempa = feed('gempa', true, 30); // > 10 menit
    const a = assess(JKT, base({ feeds }));
    const g = a.conditions.find((c) => c.kind === 'gempa')!;
    expect(g.available).toBe(false);
    expect(g.head).toBe('Data gempa belum tersedia');
    expect(g.act).toMatch(/Pembaruan terakhir 30 menit lalu/);
    expect(a.missing).toEqual(['gempa']);
    expect(a.sentence).toMatch(/dari data yang tersedia/);
    // yang tidak tersedia diletakkan di akhir
    expect(a.conditions.at(-1)!.kind).toBe('gempa');
  });

  it('kondisi terburuk di atas, dan kalimat menyebut jumlah peringatan lain', () => {
    const a = assess(JKT, base({
      weather: { ...base().weather!, next24: 120 },
      air: { ...base().air!, aqi: 160 },
    }));
    expect(a.level).toBe(2);
    expect(a.conditions[0]!.kind).toBe('hujan');
    expect(a.sentence).toBe('Hujan sangat lebat dan 1 peringatan lain.');
    expect(a.action).toMatch(/Waspada banjir/);
  });
});

describe('ambang hujan (BMKG harian)', () => {
  const lv = (past24: number, next24: number) =>
    assess(JKT, base({ weather: { ...base().weather!, past24, next24 } })).conditions.find((c) => c.kind === 'hujan')!.level;
  it.each([
    [0, 49.9, 0],
    [0, 50, 1],
    [99.9, 0, 1],
    [0, 100, 2],
    [150, 10, 2],
  ])('past %d next %d → %d', (p, n, l) => expect(lv(p, n)).toBe(l));
  it('angka hanya di rincian, catatan bukan tinggi air', () => {
    const c = assess(JKT, base({ weather: { ...base().weather!, next24: 60 } })).conditions.find((c) => c.kind === 'hujan')!;
    expect(c.head).toBe('Hujan lebat');
    expect(c.head).not.toMatch(/\d/);
    expect(c.act).not.toMatch(/\d/);
    expect(c.note).toMatch(/bukan ukuran tinggi air/);
  });
});

describe('ambang udara (AQI)', () => {
  const lv = (aqi: number) => assess(JKT, base({ air: { ...base().air!, aqi } })).conditions.find((c) => c.kind === 'udara')!.level;
  it.each([[100, 0], [101, 1], [200, 1], [201, 2]])('AQI %d → %d', (a, l) => expect(lv(a)).toBe(l));
});

describe('ambang gempa', () => {
  const lv = (q: Partial<Quake>) => assess(JKT, base({ quakes: [quake(q)] })).conditions.find((c) => c.kind === 'gempa')!.level;
  it('gempa kecil dalam 100 km → Waspada', () => expect(lv({ m: 3.2, lat: latAt(80) })).toBe(1));
  it('gempa kecil di 120 km → tidak relevan', () => expect(lv({ m: 4.9, lat: latAt(120) })).toBe(0));
  it('M5 dalam 300 km → Waspada', () => expect(lv({ m: 5.0, lat: latAt(280) })).toBe(1));
  it('M5,5 dalam 150 km → Bahaya', () => expect(lv({ m: 5.5, lat: latAt(140) })).toBe(2));
  it('M5,5 di 160 km → Waspada', () => expect(lv({ m: 5.5, lat: latAt(160) })).toBe(1));
  it('lebih dari 24 jam → diabaikan', () => expect(lv({ m: 6, t: NOW - 25 * 3600_000 })).toBe(0));
  it('berpotensi tsunami dalam 300 km → Bahaya', () => expect(lv({ m: 5.0, lat: latAt(250), tsunami: true })).toBe(2));
  it('memilih gempa paling berbahaya, bukan yang terdekat', () => {
    const c = assess(JKT, base({ quakes: [quake({ id: 'a', m: 3, lat: latAt(20) }), quake({ id: 'b', m: 6, lat: latAt(140) })] }))
      .conditions.find((c) => c.kind === 'gempa')!;
    expect(c.level).toBe(2);
    expect(c.rows.find((r) => r[0] === 'Kekuatan')![1]).toBe('M 6,0');
  });
});

describe('ambang titik api (radius 50 km)', () => {
  const fires = (n: number, kmAway = 10, conf: 'l' | 'n' | 'h' = 'n') =>
    Array.from({ length: n }, (_, i) => ({ lat: latAt(kmAway), lon: JKT.lon + i * 0.001, frp: 5, conf, t: NOW - 3600_000, sat: 'NOAA-20' }));
  const lv = (h: ReturnType<typeof fires>) => assess(JKT, base({ hotspots: h })).conditions.find((c) => c.kind === 'api')!.level;
  it.each([[0, 0], [1, 1], [10, 1], [11, 2]])('%d titik → %d', (n, l) => expect(lv(fires(n))).toBe(l));
  it('di luar 50 km diabaikan', () => expect(lv(fires(20, 60))).toBe(0));
  it('confidence rendah diabaikan', () => expect(lv(fires(20, 10, 'l'))).toBe(0));
});

describe('gunung api', () => {
  const v = (o: Partial<Volcano>): Volcano => ({
    code: 'MER', name: 'Merapi', lat: -7.542, lon: 110.442, alert: 1, erupting: false, satellite: false, src: 'MAGMA', ...o,
  });
  const at = (kmNorth: number) => ({ lat: -7.542 + kmNorth / 111.2, lon: 110.442, name: 'Titik' });
  const cond = (p: { lat: number; lon: number }, vs: Volcano[]) => assess(p, base({ volcanoes: vs })).conditions.find((c) => c.kind === 'gunung');
  it('Normal tidak memunculkan baris', () => expect(cond(at(5), [v({})])).toBeUndefined());
  it('Siaga dalam 10 km → Bahaya', () => {
    const c = cond(at(8), [v({ alert: 3 })])!;
    expect(c.level).toBe(2);
    expect(c.head).toBe('Gunung Merapi berstatus Siaga');
  });
  it('Siaga di 25 km → Waspada', () => expect(cond(at(25), [v({ alert: 3 })])!.level).toBe(1));
  it('Waspada di 20 km → tidak muncul', () => expect(cond(at(20), [v({ alert: 2 })])).toBeUndefined());
  it('erupsi dalam 40 km → Waspada (abu)', () => expect(cond(at(35), [v({ alert: 2, erupting: true })])!.level).toBe(1));
  it('data gunung hilang dan ada gunung dekat → baris "belum tersedia"', () => {
    const feeds = allFeeds();
    feeds.gunung = feed('gunung', false);
    const c = assess(at(5), base({ feeds })).conditions.find((c) => c.kind === 'gunung')!;
    expect(c.available).toBe(false);
  });
  it('data gunung hilang tapi tidak ada gunung dekat → tidak ada baris', () => {
    const feeds = allFeeds();
    feeds.gunung = feed('gunung', false);
    expect(assess({ lat: -2.98, lon: 104.76 }, base({ feeds })).conditions.find((c) => c.kind === 'gunung')).toBeUndefined();
  });
});

describe('nearby', () => {
  it('urut jarak, maks 4', () => {
    const ev = nearby(JKT, {
      now: NOW,
      citizen: [{ id: 'r1', kind: 'Banjir', text: 'Jl. A', lat: latAt(5), lon: JKT.lon, t: NOW }],
      community: [{ id: 'p1', hazard: 'banjir', text: '', lat: latAt(2), lon: JKT.lon, t: NOW, src: 'PetaBencana.id' }],
      quakes: [quake({ id: 'q1', lat: latAt(300) }), quake({ id: 'q2', lat: latAt(500) })],
    });
    expect(ev.map((e) => e.ref)).toEqual(['p1', 'r1', 'q1']);
    expect(ev[0]!.title).toBe('Banjir dilaporkan');
  });
});
