import { BBOX_ID, mergeHotspots, parseFirms, type Hotspot } from '@siaga/core';
import { config } from '../config.js';
import { prisma } from '../lib/db.js';
import { getText } from '../lib/http.js';
import { putList } from '../services/store.js';
import type { RunResult } from './types.js';

/**
 * Suomi NPP berhenti mengirim data FIRMS sejak 2 Nov 2026 (NASA Earthdata).
 * Pengganti: VIIRS NOAA-20 dan NOAA-21.
 */
const AREA_SOURCES = ['VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT'] as const;
const OPEN_FILES = [
  'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_SouthEast_Asia_24h.csv',
  'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-21-viirs-c2/csv/J2_VIIRS_C2_SouthEast_Asia_24h.csv',
];
const MAX_KEEP = 6000;

function urls(): string[] {
  const k = config.sources.firmsKey;
  if (!k) return OPEN_FILES;
  const b = BBOX_ID;
  return AREA_SOURCES.map((s) => `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(k)}/${s}/${b.w},${b.s},${b.e},${b.n}/1`);
}

const dataRows = (csv: string) => Math.max(0, csv.trim().split(/\r?\n/).length - 1);

export async function collectApi(): Promise<RunResult> {
  if (!config.sources.firms) throw new Error('FIRMS dimatikan di konfigurasi');
  const list = urls();
  const res = await Promise.allSettled(list.map((u) => getText(u, 45_000)));
  const lists: Hotspot[][] = [];
  let raw = 0;
  const errors: string[] = [];
  res.forEach((r, i) => {
    if (r.status === 'rejected') return void errors.push(String(r.reason?.message ?? r.reason));
    try {
      lists.push(parseFirms(r.value));
      raw += dataRows(r.value);
    } catch (e) {
      errors.push(`${list[i]!.includes('NOAA21') || list[i]!.includes('J2_') ? 'NOAA-21' : 'NOAA-20'}: ${(e as Error).message}`);
    }
  });
  if (!lists.length) throw new Error(errors.join('; '));
  // Tidak ada satu baris pun dari semua satelit = hampir pasti gangguan data, bukan "tidak ada api".
  if (raw === 0) throw new Error('semua berkas FIRMS kosong (kemungkinan gangguan satelit)');

  const now = Date.now();
  const fires = mergeHotspots(...lists)
    .filter((h) => now - h.t < 24 * 3600_000)
    .slice(0, MAX_KEEP);
  await putList('api', fires);
  await prisma.hotspot.createMany({
    data: fires.map((h) => ({ satellite: h.sat, time: new Date(h.t), lat: h.lat, lon: h.lon, frp: h.frp, confidence: h.conf })),
    skipDuplicates: true,
  });
  return {
    source: config.sources.firmsKey ? 'NASA FIRMS (API)' : 'NASA FIRMS (berkas terbuka)',
    count: fires.length,
    note: errors.length ? errors.join('; ') : undefined,
  };
}
