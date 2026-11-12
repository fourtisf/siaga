/**
 * Uji semua sumber data dari server tanpa menyimpan apa pun.
 * Jalankan di VPS sebelum go-live dan setiap kali ada keraguan:
 *   pnpm probe
 * Hasilnya juga dipakai untuk docs/SUMBER-DATA.md.
 */
import { CITIES, cellOf } from '@siaga/core';
import { fetchBmkg, fetchUsgs } from './collectors/gempa.js';
import { fetchEonet, fetchMagma } from './collectors/gunung.js';
import { fetchAir, fetchWeather } from './collectors/openmeteo.js';
import { config } from './config.js';
import { getJson, getText, redact } from './lib/http.js';
import { parseFirms, parsePetaBencana } from '@siaga/core';

type Row = { sumber: string; hasil: 'HIDUP' | 'KOSONG' | 'MATI'; ms: number; jumlah: string; catatan: string };

async function probe(name: string, fn: () => Promise<{ n: number; note?: string; empty?: boolean }>): Promise<Row> {
  const t = Date.now();
  try {
    const r = await fn();
    return { sumber: name, hasil: r.empty ? 'KOSONG' : 'HIDUP', ms: Date.now() - t, jumlah: String(r.n), catatan: r.note ?? '' };
  } catch (e) {
    return { sumber: name, hasil: 'MATI', ms: Date.now() - t, jumlah: '-', catatan: (e as Error).message.slice(0, 120) };
  }
}

const jkt = cellOf(-6.2, 106.82);
const rows: Row[] = [];
rows.push(
  await probe('BMKG gempa (terkini+dirasakan+auto)', async () => {
    const q = await fetchBmkg();
    return { n: q.length, note: `terbaru ${new Date(q[0]!.t).toISOString()}` };
  }),
);
rows.push(
  await probe('USGS gempa (cadangan)', async () => {
    const q = await fetchUsgs();
    return { n: q.length, empty: !q.length };
  }),
);
rows.push(
  await probe(`Open-Meteo hujan${config.sources.openMeteoKey ? ' (berbayar)' : ' (gratis)'}`, async () => {
    const w = await fetchWeather([jkt, cellOf(CITIES[0]!.lat, CITIES[0]!.lon)]);
    return { n: w.length, note: `Jakarta 24j lalu ${w[0]!.past24} mm, 24j depan ${w[0]!.next24} mm` };
  }),
);
rows.push(
  await probe('Open-Meteo kualitas udara (CAMS)', async () => {
    const a = await fetchAir([jkt]);
    return { n: a.length, note: `Jakarta AQI ${a[0]!.aqi}` };
  }),
);
for (const [label, url] of [
  ['FIRMS NOAA-20 (berkas terbuka)', 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_SouthEast_Asia_24h.csv'],
  ['FIRMS NOAA-21 (berkas terbuka)', 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-21-viirs-c2/csv/J2_VIIRS_C2_SouthEast_Asia_24h.csv'],
  ['FIRMS Suomi NPP (dipakai prototipe)', 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_SouthEast_Asia_24h.csv'],
  ...(config.sources.firmsKey
    ? [['FIRMS API NOAA-20 (MAP_KEY)', `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${config.sources.firmsKey}/VIIRS_NOAA20_NRT/94,-12,142,7/1`]]
    : []),
] as [string, string][]) {
  rows.push(
    await probe(label, async () => {
      const csv = await getText(url, 45_000);
      const raw = Math.max(0, csv.trim().split(/\r?\n/).length - 1);
      const id = parseFirms(csv);
      return { n: id.length, empty: raw === 0, note: `${raw} baris di berkas, ${id.length} di Indonesia (${redact(url).split('/').pop()})` };
    }),
  );
}
rows.push(
  await probe('NASA EONET gunung api', async () => {
    const e = await fetchEonet();
    const all = (await getJson<any>('https://eonet.gsfc.nasa.gov/api/v3/events?category=volcanoes&status=all&limit=1')).events?.[0];
    return { n: e.length, empty: !e.length, note: all ? `kejadian gunung terbaru di dunia: ${all.geometry?.at(-1)?.date?.slice(0, 10)}` : '' };
  }),
);
rows.push(
  await probe('PetaBencana.id laporan 72 jam', async () => {
    const r = parsePetaBencana(await getJson('https://data.petabencana.id/reports?timeperiod=259200&geoformat=geojson'));
    const types = r.reduce<Record<string, number>>((m, x) => ((m[x.hazard] = (m[x.hazard] ?? 0) + 1), m), {});
    return { n: r.length, empty: !r.length, note: Object.entries(types).map(([k, v]) => `${k} ${v}`).join(', ') };
  }),
);
rows.push(
  await probe('MAGMA status gunung api (HTML)', async () => {
    const v = await fetchMagma();
    const lv = v.reduce<Record<number, number>>((m, x) => ((m[x.alert ?? 0] = (m[x.alert ?? 0] ?? 0) + 1), m), {});
    return { n: v.length, note: `Normal ${lv[1] ?? 0}, Waspada ${lv[2] ?? 0}, Siaga ${lv[3] ?? 0}, Awas ${lv[4] ?? 0}; erupsi/VONA ${v.filter((x) => x.erupting).length}` };
  }),
);

console.log(`\nUji sumber data SIAGA, ${new Date().toISOString()}\n`);
console.table(rows);
process.exit(rows.some((r) => r.hasil === 'MATI' && !r.sumber.includes('Suomi')) ? 1 : 0);
