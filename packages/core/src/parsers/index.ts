/**
 * Parser sumber data: masukan mentah (teks/JSON) → bentuk normal SIAGA.
 * Semua parser melempar ParseError bila bentuk data tidak dikenali, supaya
 * worker mencatat kegagalan alih-alih menyimpan data kosong seolah "tidak ada kejadian".
 */
import { BBOX_ID, inBBox, km, where } from '../geo.js';
import type { Air, CommunityHazard, CommunityReport, Hotspot, Quake, Volcano, VolcanoAlert, Weather } from '../types.js';
import { VOLCANOES } from '../volcanoes.js';

export class ParseError extends Error {
  constructor(source: string, msg: string) {
    super(`${source}: ${msg}`);
    this.name = 'ParseError';
  }
}

const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null;

/* ---------------- BMKG ---------------- */

/** gempaterkini.json / gempadirasakan.json (array) atau autogempa.json (objek tunggal) */
export function parseBmkg(json: unknown): Quake[] {
  if (!isObj(json) || !isObj(json.Infogempa)) throw new ParseError('BMKG', 'tidak ada Infogempa');
  const raw = json.Infogempa.gempa;
  const list: any[] = Array.isArray(raw) ? raw : isObj(raw) ? [raw] : [];
  if (!list.length) throw new ParseError('BMKG', 'daftar gempa kosong');
  const out: Quake[] = [];
  for (const g of list) {
    const t = Date.parse(g.DateTime);
    const [lat, lon] = String(g.Coordinates ?? '')
      .split(',')
      .map((s) => Number(s.trim()));
    const m = Number(g.Magnitude);
    if (!Number.isFinite(t) || !Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(m)) continue;
    const potential = typeof g.Potensi === 'string' ? g.Potensi.trim() : undefined;
    out.push({
      id: `bmkg:${new Date(t).toISOString()}`,
      t,
      lat: lat!,
      lon: lon!,
      m,
      depthKm: parseFloat(g.Kedalaman) || 0,
      place: String(g.Wilayah ?? '').trim() || where(lat!, lon!),
      felt: typeof g.Dirasakan === 'string' && g.Dirasakan.trim() ? g.Dirasakan.trim() : undefined,
      potential: potential || undefined,
      tsunami: isTsunamiPotential(potential),
      src: 'BMKG',
    });
  }
  if (!out.length) throw new ParseError('BMKG', 'tidak ada gempa yang bisa dibaca');
  return out;
}

/** "Tidak berpotensi tsunami" → false; "Berpotensi TSUNAMI ..." → true. */
export function isTsunamiPotential(s: string | undefined): boolean {
  if (!s) return false;
  const t = s.toLowerCase();
  return t.includes('tsunami') && !t.includes('tidak berpotensi') && !t.includes('tidak ber-potensi');
}

/** Gabungkan beberapa daftar BMKG; kejadian yang sama (DateTime sama) digabung isinya. */
export function mergeQuakes(...lists: Quake[][]): Quake[] {
  const byId = new Map<string, Quake>();
  for (const list of lists)
    for (const q of list) {
      const prev = byId.get(q.id);
      if (!prev) byId.set(q.id, { ...q });
      else {
        prev.felt ??= q.felt;
        prev.potential ??= q.potential;
        prev.tsunami = prev.tsunami || q.tsunami;
      }
    }
  return [...byId.values()].sort((a, b) => b.t - a.t);
}

/* ---------------- USGS ---------------- */

export function parseUsgs(json: unknown): Quake[] {
  if (!isObj(json) || !Array.isArray(json.features)) throw new ParseError('USGS', 'bukan FeatureCollection');
  return json.features
    .filter((f: any) => f?.geometry?.type === 'Point' && Number.isFinite(f?.properties?.mag))
    .map((f: any): Quake => {
      const [lon, lat, depth] = f.geometry.coordinates;
      return {
        id: `usgs:${f.id}`,
        t: f.properties.time,
        lat,
        lon,
        m: f.properties.mag,
        depthKm: depth ?? 0,
        place: where(lat, lon),
        // Catatan: properti "tsunami" USGS BUKAN peringatan tsunami (lihat dokumentasi USGS),
        // jadi tidak dipakai. Status tsunami hanya dari BMKG.
        tsunami: false,
        src: 'USGS',
      };
    })
    .sort((a: Quake, b: Quake) => b.t - a.t);
}

/* ---------------- Open-Meteo ---------------- */

const sum = (a: (number | null)[]) => a.reduce<number>((s, v) => s + (v ?? 0), 0);

/**
 * Respons forecast multi-lokasi (array) atau satu lokasi (objek).
 * `points` adalah titik yang diminta, dalam urutan yang sama.
 */
export function parseOpenMeteoForecast(json: unknown, points: { lat: number; lon: number }[], fetchedAt: number): Weather[] {
  const arr: any[] = Array.isArray(json) ? json : [json];
  if (arr.length !== points.length) throw new ParseError('Open-Meteo', `jumlah lokasi ${arr.length} ≠ ${points.length}`);
  return arr.map((r, i) => {
    if (!isObj(r) || !isObj(r.hourly) || !Array.isArray(r.hourly.precipitation) || !isObj(r.current))
      throw new ParseError('Open-Meteo', 'bentuk respons tidak dikenal');
    const times: string[] = r.hourly.time;
    const pr: (number | null)[] = r.hourly.precipitation;
    const cur = String(r.current.time).slice(0, 13); // "2026-11-12T15"
    let split = times.findIndex((t) => t.slice(0, 13) >= cur);
    if (split < 0) split = Math.min(24, pr.length);
    const offset = Number(r.utc_offset_seconds) || 0;
    const at = Date.parse(`${r.current.time}:00Z`) - offset * 1000;
    return {
      lat: points[i]!.lat,
      lon: points[i]!.lon,
      now: r.current.precipitation ?? 0,
      temp: r.current.temperature_2m ?? NaN,
      wind: r.current.wind_speed_10m ?? NaN,
      past24: +sum(pr.slice(Math.max(0, split - 24), split)).toFixed(1),
      next24: +sum(pr.slice(split, split + 24)).toFixed(1),
      at: Number.isFinite(at) ? at : fetchedAt,
      fetchedAt,
    };
  });
}

export function parseOpenMeteoAir(json: unknown, points: { lat: number; lon: number }[], fetchedAt: number): Air[] {
  const arr: any[] = Array.isArray(json) ? json : [json];
  if (arr.length !== points.length) throw new ParseError('Open-Meteo AQ', `jumlah lokasi ${arr.length} ≠ ${points.length}`);
  return arr.map((r, i) => {
    if (!isObj(r) || !isObj(r.current)) throw new ParseError('Open-Meteo AQ', 'bentuk respons tidak dikenal');
    const offset = Number(r.utc_offset_seconds) || 0;
    const at = Date.parse(`${r.current.time}:00Z`) - offset * 1000;
    const aqi = Number(r.current.us_aqi);
    return {
      lat: points[i]!.lat,
      lon: points[i]!.lon,
      aqi: Number.isFinite(aqi) ? Math.round(aqi) : NaN,
      pm25: Number.isFinite(r.current.pm2_5) ? r.current.pm2_5 : null,
      pm10: Number.isFinite(r.current.pm10) ? r.current.pm10 : null,
      at: Number.isFinite(at) ? at : fetchedAt,
      fetchedAt,
    };
  });
}

/* ---------------- NASA FIRMS ---------------- */

/**
 * CSV FIRMS (VIIRS atau MODIS). Header wajib ada; CSV yang hanya berisi header
 * dikembalikan sebagai [] — pemanggil yang memutuskan apakah itu wajar.
 */
export function parseFirms(csv: string, bb = BBOX_ID): Hotspot[] {
  const rows = csv.trim().split(/\r?\n/);
  const header = rows.shift()?.split(',') ?? [];
  const ix = (n: string) => header.indexOf(n);
  const a = ix('latitude'), b = ix('longitude'), f = ix('frp'), c = ix('confidence'), d = ix('acq_date'), t = ix('acq_time'), s = ix('satellite');
  if (a < 0 || b < 0 || d < 0 || t < 0) throw new ParseError('FIRMS', 'header CSV tidak dikenal');
  const out: Hotspot[] = [];
  for (const r of rows) {
    const v = r.split(',');
    const lat = Number(v[a]), lon = Number(v[b]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inBBox(lat, lon, bb)) continue;
    const hhmm = String(v[t]).padStart(4, '0');
    const time = Date.parse(`${v[d]}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`);
    if (!Number.isFinite(time)) continue;
    out.push({ lat, lon, frp: Number(v[f]) || 0, conf: normConf(v[c]), t: time, sat: satName(v[s]) });
  }
  return out;
}

function normConf(v: string | undefined): Hotspot['conf'] {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'l' || s === 'low') return 'l';
  if (s === 'h' || s === 'high') return 'h';
  if (s === 'n' || s === 'nominal') return 'n';
  const n = Number(s); // MODIS 0-100
  if (Number.isFinite(n)) return n < 30 ? 'l' : n >= 80 ? 'h' : 'n';
  return 'n';
}

function satName(v: string | undefined): string {
  const s = String(v ?? '').trim();
  return ({ N: 'Suomi NPP', N20: 'NOAA-20', N21: 'NOAA-21', '1': 'NOAA-20', T: 'Terra', A: 'Aqua' } as Record<string, string>)[s] ?? (s || 'VIIRS');
}

/** Gabungkan deteksi dari beberapa satelit; titik yang sama persis (lat, lon, waktu) dibuang. */
export function mergeHotspots(...lists: Hotspot[][]): Hotspot[] {
  const seen = new Set<string>();
  const out: Hotspot[] = [];
  for (const l of lists)
    for (const h of l) {
      const k = `${h.lat.toFixed(4)},${h.lon.toFixed(4)},${h.t}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(h);
    }
  return out.sort((x, y) => y.frp - x.frp);
}

/* ---------------- NASA EONET ---------------- */

export interface EonetVolcano {
  id: string;
  title: string;
  t: number;
  lat: number;
  lon: number;
}

export function parseEonet(json: unknown): EonetVolcano[] {
  if (!isObj(json) || !Array.isArray(json.events)) throw new ParseError('EONET', 'tidak ada events');
  const out: EonetVolcano[] = [];
  for (const e of json.events) {
    const g = Array.isArray(e.geometry) ? e.geometry[e.geometry.length - 1] : null;
    if (!g || g.type !== 'Point') continue;
    out.push({ id: e.id, title: e.title, t: Date.parse(g.date), lat: g.coordinates[1], lon: g.coordinates[0] });
  }
  return out;
}

/* ---------------- PetaBencana.id ---------------- */

const PB_HAZARD: Record<string, CommunityHazard> = {
  flood: 'banjir',
  fire: 'kebakaran',
  earthquake: 'gempa',
  wind: 'angin',
  volcano: 'gunung',
  haze: 'asap',
};

export function parsePetaBencana(json: unknown): CommunityReport[] {
  const fc = isObj(json) && isObj(json.result) ? json.result : json;
  if (!isObj(fc) || !Array.isArray(fc.features)) throw new ParseError('PetaBencana', 'bukan FeatureCollection');
  const out: CommunityReport[] = [];
  for (const f of fc.features) {
    if (f?.geometry?.type !== 'Point') continue;
    const p = f.properties ?? {};
    const [lon, lat] = f.geometry.coordinates;
    const t = Date.parse(p.created_at);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(t)) continue;
    const depth = Number(p.report_data?.flood_depth);
    out.push({
      id: `pb:${p.pkey}`,
      hazard: PB_HAZARD[p.disaster_type] ?? 'lainnya',
      t,
      lat,
      lon,
      text: String(p.text ?? p.title ?? '').trim().slice(0, 280),
      depthCm: Number.isFinite(depth) && depth > 0 ? depth : undefined,
      imageUrl: typeof p.image_url === 'string' && p.image_url.startsWith('https://') ? p.image_url : undefined,
      city: typeof p.tags?.city === 'string' ? titleCase(p.tags.city) : undefined,
      src: 'PetaBencana.id',
    });
  }
  return out.sort((a, b) => b.t - a.t);
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());

/* ---------------- MAGMA Indonesia ---------------- */

/**
 * Halaman depan magma.esdm.go.id menanam `var markersGunungApi = [...]` berisi
 * status resmi tiap gunung. MAGMA tidak punya API publik; ini membaca HTML,
 * jadi rapuh terhadap perubahan situs. Lihat docs/SUMBER-DATA.md.
 */
export function parseMagma(html: string): Volcano[] {
  const at = html.indexOf('markersGunungApi');
  if (at < 0) throw new ParseError('MAGMA', 'markersGunungApi tidak ditemukan');
  const start = html.indexOf('[', at);
  const end = matchBracket(html, start);
  if (start < 0 || end < 0) throw new ParseError('MAGMA', 'array tidak lengkap');
  let arr: any[];
  try {
    arr = JSON.parse(html.slice(start, end + 1));
  } catch {
    throw new ParseError('MAGMA', 'JSON tidak valid');
  }
  const out: Volcano[] = [];
  for (const g of arr) {
    const lat = Number(g.ga_lat_gapi), lon = Number(g.ga_lon_gapi), st = Number(g.ga_status);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !g.ga_code) continue;
    out.push({
      code: String(g.ga_code),
      name: String(g.ga_nama_gapi),
      lat,
      lon,
      alert: st >= 1 && st <= 4 ? (st as VolcanoAlert) : null,
      erupting: !!g.erupt_icon || !!g.has_vona,
      satellite: false,
      region: g.ga_prov_gapi ? String(g.ga_prov_gapi) : undefined,
      src: 'MAGMA',
    });
  }
  if (out.length < 20) throw new ParseError('MAGMA', `hanya ${out.length} gunung terbaca`);
  return out;
}

function matchBracket(s: string, start: number): number {
  if (start < 0 || s[start] !== '[') return -1;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Gabungkan status MAGMA dengan aktivitas satelit EONET. Bila MAGMA tidak tersedia,
 * gunung dari daftar rujukan ditandai aktif bila ada kejadian EONET dalam 25 km.
 */
export function mergeVolcanoes(magma: Volcano[] | null, eonet: EonetVolcano[]): Volcano[] {
  const base: Volcano[] =
    magma ??
    VOLCANOES.map((v) => ({ ...v, alert: null, erupting: false, satellite: false, src: 'EONET' as const }));
  return base.map((v) => ({
    ...v,
    satellite: eonet.some((e) => km(v.lat, v.lon, e.lat, e.lon) < 25),
  }));
}
