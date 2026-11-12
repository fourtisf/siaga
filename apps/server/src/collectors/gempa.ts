import { BBOX_ID, mergeQuakes, parseBmkg, parseUsgs, type Quake } from '@siaga/core';
import { config } from '../config.js';
import { prisma } from '../lib/db.js';
import { getJson } from '../lib/http.js';
import { publish } from '../lib/live.js';
import { getQuakes, putList } from '../services/store.js';
import type { RunResult } from './types.js';

const BMKG_FILES = ['gempaterkini', 'gempadirasakan', 'autogempa'] as const;
const KEEP_MS = 7 * 864e5;

export async function fetchBmkg(): Promise<Quake[]> {
  const res = await Promise.allSettled(
    BMKG_FILES.map((f) => getJson(`https://data.bmkg.go.id/DataMKG/TEWS/${f}.json`, 12_000).then(parseBmkg)),
  );
  const ok = res.filter((r): r is PromiseFulfilledResult<Quake[]> => r.status === 'fulfilled').map((r) => r.value);
  if (!ok.length) {
    throw new Error(`BMKG gagal: ${res.map((r) => (r.status === 'rejected' ? String(r.reason?.message ?? r.reason) : '')).join(' | ')}`);
  }
  return mergeQuakes(...ok);
}

export async function fetchUsgs(): Promise<Quake[]> {
  const start = new Date(Date.now() - KEEP_MS).toISOString().slice(0, 19);
  const b = BBOX_ID;
  const url =
    `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${start}` +
    `&minlatitude=${b.s}&maxlatitude=${b.n}&minlongitude=${b.w}&maxlongitude=${b.e}&minmagnitude=4&orderby=time&limit=300`;
  return parseUsgs(await getJson(url, 15_000));
}

/** BMKG sebagai sumber utama (wajib dicantumkan), USGS sebagai cadangan. */
export async function collectGempa(): Promise<RunResult> {
  const errors: string[] = [];
  let fresh: Quake[] | null = null;
  let source: 'BMKG' | 'USGS' | null = null;
  if (config.sources.bmkg) {
    try {
      fresh = await fetchBmkg();
      source = 'BMKG';
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  if (!fresh && config.sources.usgs) {
    try {
      fresh = await fetchUsgs();
      source = 'USGS';
    } catch (e) {
      errors.push(`USGS gagal: ${(e as Error).message}`);
    }
  }
  if (!fresh || !source) throw new Error(errors.join('; ') || 'semua sumber gempa dimatikan');

  // Gabung dengan data sebelumnya dari sumber yang sama, supaya gempa 24 jam terakhir
  // tidak hilang ketika keluar dari daftar 15 kejadian terbaru BMKG.
  const now = Date.now();
  const prev = (await getQuakes()).filter((q) => q.src === source && now - q.t < KEEP_MS);
  const merged = mergeQuakes(fresh, prev).filter((q) => now - q.t < KEEP_MS);
  await putList('gempa', merged);

  // Gempa baru (belum ada di putaran sebelumnya, terjadi < 6 jam lalu) → kabari browser yang sedang terbuka.
  // Putaran pertama (daftar sebelumnya kosong) tidak dianggap "baru".
  if (prev.length) {
    const known = new Set(prev.map((q) => q.id));
    for (const q of fresh.filter((q) => !known.has(q.id) && now - q.t < 6 * 3600_000).slice(0, 5)) {
      await publish({ type: 'quake', quake: { id: q.id, t: q.t, lat: q.lat, lon: q.lon, m: q.m, depthKm: q.depthKm, place: q.place, tsunami: q.tsunami, src: q.src } });
    }
  }

  for (const q of fresh) {
    const data = {
      source: q.src,
      time: new Date(q.t),
      lat: q.lat,
      lon: q.lon,
      magnitude: q.m,
      depthKm: q.depthKm,
      place: q.place,
      felt: q.felt ?? null,
      potential: q.potential ?? null,
      tsunami: q.tsunami,
    };
    await prisma.earthquake.upsert({ where: { id: q.id }, create: { id: q.id, ...data }, update: data });
  }
  return { source, count: merged.length, note: errors.length ? errors.join('; ') : undefined };
}
