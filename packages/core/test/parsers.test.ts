import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isTsunamiPotential,
  mergeHotspots,
  mergeQuakes,
  mergeVolcanoes,
  ParseError,
  parseBmkg,
  parseEonet,
  parseFirms,
  parseMagma,
  parseOpenMeteoAir,
  parseOpenMeteoForecast,
  parsePetaBencana,
  parseUsgs,
} from '../src/index.js';

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const json = (n: string) => JSON.parse(fx(n));

describe('BMKG (respons asli 12 Nov 2026)', () => {
  it('membaca gempaterkini', () => {
    const q = parseBmkg(json('bmkg-gempaterkini.json'));
    expect(q.length).toBe(15);
    expect(q[0]).toMatchObject({ src: 'BMKG', lat: -0.93, lon: 128.6, m: 5.1, depthKm: 10, tsunami: false });
    expect(q[0]!.t).toBe(Date.parse('2026-11-10T15:51:37+00:00'));
  });
  it('membaca autogempa (objek tunggal) dan Dirasakan', () => {
    const q = parseBmkg(json('bmkg-autogempa.json'));
    expect(q).toHaveLength(1);
    expect(q[0]!.felt).toMatch(/Gayo Lues/);
  });
  it('menggabungkan kejadian yang sama dari beberapa berkas', () => {
    const a = parseBmkg(json('bmkg-gempadirasakan.json'));
    const b = parseBmkg(json('bmkg-autogempa.json'));
    const m = mergeQuakes(a, b);
    expect(m.length).toBe(a.length);
    expect(m[0]!.t).toBeGreaterThanOrEqual(m[1]!.t);
  });
  it('menolak bentuk yang tidak dikenal', () => {
    expect(() => parseBmkg({})).toThrow(ParseError);
    expect(() => parseBmkg({ Infogempa: { gempa: [] } })).toThrow(ParseError);
  });
  it('mengenali potensi tsunami', () => {
    expect(isTsunamiPotential('Tidak berpotensi tsunami')).toBe(false);
    expect(isTsunamiPotential('Berpotensi TSUNAMI untuk diteruskan pada masyarakat')).toBe(true);
    expect(isTsunamiPotential('Gempa ini dirasakan untuk diteruskan pada masyarakat')).toBe(false);
    expect(isTsunamiPotential(undefined)).toBe(false);
  });
});

describe('USGS', () => {
  it('membaca GeoJSON dan tidak menganggap flag tsunami sebagai peringatan', () => {
    const q = parseUsgs(json('usgs.geojson'));
    expect(q.length).toBeGreaterThan(0);
    expect(q.every((x) => x.src === 'USGS' && x.tsunami === false)).toBe(true);
    expect(q[0]!.place).toMatch(/km dari|[A-Z]/);
  });
});

describe('Open-Meteo', () => {
  const pts = [
    { lat: -6.2, lon: 106.82 },
    { lat: -7.26, lon: 112.75 },
  ];
  it('menjumlah hujan 24 jam lalu dan 24 jam ke depan berdasarkan jam saat ini', () => {
    const w = parseOpenMeteoForecast(json('openmeteo-forecast.json'), pts, 1);
    expect(w).toHaveLength(2);
    // Jakarta, 12 Nov 2026 15:00 WIB: lihat fixture
    expect(w[0]!.past24).toBeCloseTo(1.0, 1); // 0,1+0,1+0,1+0,5+0,2
    expect(w[0]!.next24).toBeCloseTo(4.9, 1); // 0,8+2,8+0,7+0,1+0,1+0,3+0,1
    expect(w[0]!.lat).toBe(-6.2);
    expect(w[0]!.at).toBe(Date.parse('2026-11-12T08:00:00Z'));
  });
  it('kualitas udara', () => {
    const a = parseOpenMeteoAir(json('openmeteo-aq.json'), pts, 1);
    expect(a[0]).toMatchObject({ aqi: 151, pm25: 21.5 });
  });
  it('menolak jumlah lokasi yang tidak cocok', () => {
    expect(() => parseOpenMeteoAir(json('openmeteo-aq.json'), pts.slice(0, 1), 1)).toThrow(ParseError);
  });
});

describe('NASA FIRMS', () => {
  it('membaca VIIRS NOAA-20 dan menyaring ke wilayah Indonesia', () => {
    const h = parseFirms(fx('firms-j1-sea.csv'));
    expect(h.length).toBeGreaterThan(0);
    expect(h.every((x) => x.lon >= 94 && x.lon <= 142 && x.lat >= -12 && x.lat <= 7)).toBe(true);
    expect(h[0]!.sat).toBe('NOAA-20');
  });
  it('membaca MODIS dengan confidence angka', () => {
    const h = parseFirms(fx('firms-modis-sea.csv'));
    expect(h.length).toBeGreaterThan(0);
    expect(['l', 'n', 'h']).toContain(h[0]!.conf);
  });
  it('CSV Suomi NPP yang hanya header → [] (bukan error)', () => {
    expect(parseFirms(fx('firms-snpp-empty.csv'))).toEqual([]);
  });
  it('menolak teks yang bukan CSV FIRMS', () => {
    expect(() => parseFirms('Invalid MAP_KEY.')).toThrow(ParseError);
  });
  it('membuang duplikat', () => {
    const h = parseFirms(fx('firms-j1-sea.csv'));
    expect(mergeHotspots(h, h)).toHaveLength(h.length);
  });
});

describe('EONET', () => {
  it('daftar kosong tetap valid', () => {
    expect(parseEonet(json('eonet-empty.json'))).toEqual([]);
  });
});

describe('PetaBencana.id', () => {
  it('membedakan jenis bencana (prototipe menganggap semua banjir)', () => {
    const r = parsePetaBencana(json('petabencana.json'));
    expect(r).toHaveLength(16);
    const byType = r.reduce<Record<string, number>>((m, x) => ((m[x.hazard] = (m[x.hazard] ?? 0) + 1), m), {});
    expect(byType).toEqual({ kebakaran: 8, banjir: 4, angin: 3, gunung: 1 });
    const flood = r.find((x) => x.hazard === 'banjir')!;
    expect(flood.depthCm).toBeGreaterThan(0);
  });
});

describe('MAGMA', () => {
  it('membaca status resmi gunung api dari HTML', () => {
    const v = parseMagma(fx('magma-home.html'));
    expect(v.length).toBe(69);
    const merapi = v.find((x) => x.code === 'MER')!;
    expect(merapi).toMatchObject({ name: 'Merapi', alert: 3 });
    const semeru = v.find((x) => x.code === 'SMR')!;
    expect(semeru.erupting).toBe(true);
  });
  it('gagal jelas bila struktur halaman berubah', () => {
    expect(() => parseMagma('<html></html>')).toThrow(ParseError);
  });
  it('EONET menandai gunung dalam 25 km', () => {
    const v = mergeVolcanoes(parseMagma(fx('magma-home.html')), [{ id: 'x', title: 'Semeru', t: 0, lat: -8.11, lon: 112.92 }]);
    expect(v.find((x) => x.code === 'SMR')!.satellite).toBe(true);
    expect(v.find((x) => x.code === 'MER')!.satellite).toBe(false);
  });
});
