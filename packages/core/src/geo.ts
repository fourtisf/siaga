import type { LatLon } from './types.js';

/** Kotak batas Indonesia (w, s, e, n) yang dipakai prototipe. */
export const BBOX_ID = { w: 94, s: -12, e: 142, n: 7 } as const;
export type BBox = { w: number; s: number; e: number; n: number };

const rad = (d: number) => (d * Math.PI) / 180;

/** Jarak haversine dalam km. */
export function km(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const x =
    Math.sin(rad(bLat - aLat) / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLon - aLon) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
}

export const kmBetween = (a: LatLon, b: LatLon) => km(a.lat, a.lon, b.lat, b.lon);

export function inBBox(lat: number, lon: number, bb: BBox = BBOX_ID): boolean {
  return lat >= bb.s && lat <= bb.n && lon >= bb.w && lon <= bb.e;
}

export function parseBBox(s: string | undefined | null): BBox | null {
  if (!s) return null;
  const v = s.split(',').map(Number);
  if (v.length !== 4 || v.some((n) => !Number.isFinite(n))) return null;
  const [w, south, e, n] = v as [number, number, number, number];
  if (south > n || south < -90 || n > 90 || w < -180 || e > 180) return null;
  return { w, s: south, e, n };
}

export function isValidLatLon(lat: unknown, lon: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

/**
 * Sel grid untuk cache cuaca/udara. Model cuaca global punya resolusi ~10-25 km,
 * jadi titik dalam satu sel 0,1° (~11 km) memakai data yang sama.
 */
export function cellOf(lat: number, lon: number, step = 0.1): { key: string; lat: number; lon: number } {
  const r = (v: number) => Math.round(v / step) * step;
  const clat = +r(lat).toFixed(4);
  const clon = +r(lon).toFixed(4);
  return { key: `${clat.toFixed(2)},${clon.toFixed(2)}`, lat: clat, lon: clon };
}

export interface City extends LatLon {
  name: string;
}

/** 45 kota dari prototipe. Dipakai untuk penanda hujan/udara di peta dan nama wilayah kasar. */
export const CITIES: City[] = (
  [
    ['Banda Aceh', 5.55, 95.32], ['Medan', 3.59, 98.67], ['Padang', -0.95, 100.35], ['Pekanbaru', 0.51, 101.45],
    ['Jambi', -1.61, 103.61], ['Palembang', -2.98, 104.76], ['Bengkulu', -3.8, 102.27], ['Bandar Lampung', -5.43, 105.26],
    ['Pangkal Pinang', -2.13, 106.11], ['Batam', 1.13, 104.05], ['Serang', -6.12, 106.15], ['Tangerang', -6.18, 106.63],
    ['Jakarta', -6.2, 106.82], ['Depok', -6.4, 106.82], ['Bekasi', -6.24, 107.0], ['Bogor', -6.6, 106.8],
    ['Bandung', -6.92, 107.61], ['Cirebon', -6.73, 108.55], ['Semarang', -6.99, 110.42], ['Solo', -7.57, 110.82],
    ['Yogyakarta', -7.8, 110.37], ['Surabaya', -7.26, 112.75], ['Malang', -7.98, 112.63], ['Denpasar', -8.65, 115.22],
    ['Mataram', -8.58, 116.12], ['Kupang', -10.18, 123.61], ['Pontianak', -0.03, 109.34], ['Palangka Raya', -2.21, 113.92],
    ['Banjarmasin', -3.32, 114.59], ['Samarinda', -0.5, 117.15], ['Balikpapan', -1.27, 116.83], ['Nusantara', -0.97, 116.71],
    ['Tanjung Selor', 2.84, 117.37], ['Manado', 1.47, 124.84], ['Gorontalo', 0.54, 123.06], ['Palu', -0.9, 119.87],
    ['Mamuju', -2.68, 118.89], ['Makassar', -5.15, 119.43], ['Kendari', -3.99, 122.51], ['Ambon', -3.7, 128.18],
    ['Ternate', 0.79, 127.38], ['Sorong', -0.88, 131.26], ['Manokwari', -0.86, 134.06], ['Jayapura', -2.53, 140.72],
    ['Merauke', -8.5, 140.4],
  ] as const
).map(([name, lat, lon]) => ({ name, lat, lon }));

export function nearestCity(lat: number, lon: number): { name: string; km: number } {
  let best = CITIES[0]!;
  let bd = Infinity;
  for (const c of CITIES) {
    const d = km(lat, lon, c.lat, c.lon);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return { name: best.name, km: bd };
}

/** "Bekasi" bila dekat kota, selain itu "23 km dari Bekasi". */
export function where(lat: number, lon: number): string {
  const n = nearestCity(lat, lon);
  return n.km < 15 ? n.name : `${Math.round(n.km)} km dari ${n.name}`;
}
