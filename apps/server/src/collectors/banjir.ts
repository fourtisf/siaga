import { parsePetaBencana } from '@siaga/core';
import { config } from '../config.js';
import { prisma } from '../lib/db.js';
import { getJson } from '../lib/http.js';
import { putList } from '../services/store.js';
import type { RunResult } from './types.js';

/** Laporan PetaBencana.id 72 jam terakhir (semua jenis bencana, bukan hanya banjir). */
export async function collectBanjir(): Promise<RunResult> {
  if (!config.sources.petabencana) throw new Error('PetaBencana.id dimatikan di konfigurasi');
  const reports = parsePetaBencana(await getJson('https://data.petabencana.id/reports?timeperiod=259200&geoformat=geojson', 20_000));
  await putList('banjir', reports);
  for (const r of reports) {
    const data = {
      source: r.src,
      hazard: r.hazard,
      time: new Date(r.t),
      lat: r.lat,
      lon: r.lon,
      text: r.text,
      depthCm: r.depthCm ? Math.round(r.depthCm) : null,
      imageUrl: r.imageUrl ?? null,
      city: r.city ?? null,
    };
    await prisma.communityReport.upsert({ where: { id: r.id }, create: { id: r.id, ...data }, update: data });
  }
  return { source: 'PetaBencana.id', count: reports.length };
}
