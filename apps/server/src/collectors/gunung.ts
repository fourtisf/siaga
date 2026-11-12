import { BBOX_ID, mergeVolcanoes, parseEonet, parseMagma, type EonetVolcano, type Volcano } from '@siaga/core';
import { config } from '../config.js';
import { prisma } from '../lib/db.js';
import { getJson, getText } from '../lib/http.js';
import { publish } from '../lib/live.js';
import { putList } from '../services/store.js';
import type { RunResult } from './types.js';

export async function fetchMagma(): Promise<Volcano[]> {
  return parseMagma(await getText('https://magma.esdm.go.id/', 30_000));
}

export async function fetchEonet(): Promise<EonetVolcano[]> {
  const b = BBOX_ID;
  return parseEonet(
    await getJson(`https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=45&bbox=${b.w},${b.n},${b.e},${b.s}&category=volcanoes`, 20_000),
  );
}

/**
 * Status resmi dari MAGMA (PVMBG) sebagai sumber utama. EONET hanya menambah tanda
 * "aktivitas satelit". Bila MAGMA aktif tapi gagal, pengumpulan dianggap gagal, supaya
 * UI tidak menampilkan "tidak ada gunung aktif" hanya karena EONET kosong.
 */
export async function collectGunung(): Promise<RunResult> {
  const s = config.sources;
  if (!s.magma && !s.eonet) throw new Error('MAGMA dan EONET dimatikan di konfigurasi');
  const [m, e] = await Promise.allSettled([s.magma ? fetchMagma() : Promise.resolve(null), s.eonet ? fetchEonet() : Promise.resolve([])]);
  if (s.magma && m.status === 'rejected') throw new Error(`MAGMA gagal: ${m.reason?.message ?? m.reason}`);
  if (!s.magma && e.status === 'rejected') throw new Error(`EONET gagal: ${e.reason?.message ?? e.reason}`);
  const magma = m.status === 'fulfilled' ? m.value : null;
  const eonet = e.status === 'fulfilled' ? e.value : [];
  const merged = mergeVolcanoes(magma, eonet);
  await putList('gunung', merged);

  const existing = new Map((await prisma.volcano.findMany({ select: { code: true, alert: true } })).map((v) => [v.code, v.alert]));
  for (const v of merged) {
    const prev = existing.get(v.code);
    const changed = existing.has(v.code) && prev !== v.alert && magma !== null;
    const data = {
      name: v.name,
      lat: v.lat,
      lon: v.lon,
      region: v.region ?? null,
      erupting: v.erupting,
      satellite: v.satellite,
      source: v.src,
      ...(magma !== null ? { alert: v.alert } : {}),
      ...(changed ? { alertChangedAt: new Date() } : {}),
    };
    await prisma.volcano.upsert({ where: { code: v.code }, create: { code: v.code, ...data, alert: v.alert }, update: data });
    if (changed) {
      await prisma.volcanoChange.create({ data: { code: v.code, fromAlert: prev ?? null, toAlert: v.alert } });
      await publish({ type: 'volcano', code: v.code, name: v.name, from: prev ?? null, to: v.alert });
    }
  }
  const parts = [magma ? 'MAGMA' : null, s.eonet && e.status === 'fulfilled' ? 'EONET' : null].filter(Boolean);
  return {
    source: parts.join(' + '),
    count: merged.length,
    note: e.status === 'rejected' ? `EONET gagal: ${e.reason?.message ?? e.reason}` : undefined,
  };
}
