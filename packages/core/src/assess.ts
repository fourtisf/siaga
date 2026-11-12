/**
 * Penilaian satu lokasi → tingkat, kalimat, dan tindakan.
 * Dipindahkan dari assess() di prototype/siaga-app.html, dengan perubahan:
 *  - Sumber yang gagal/kedaluwarsa menghasilkan baris "data belum tersedia", bukan "aman".
 *  - Gempa: dipilih yang tingkatnya paling tinggi (prototipe memilih yang terdekat saja).
 *  - Gempa berpotensi tsunami (menurut BMKG) dalam 300 km → Bahaya.
 *  - Gunung api memakai status resmi MAGMA bila ada.
 */
import { ago, airCopy, FIRE, lastUpdate, num, QUAKE, rainCopy, UNAVAILABLE, VOLCANO_ACT, wib } from './copy.js';
import { FEEDS, isFresh } from './feeds.js';
import { km } from './geo.js';
import { ALERT_NAMES, fireLevel, quakeLevel, rainLevel, T, volcanoLevel } from './thresholds.js';
import type {
  Air,
  Assessment,
  CitizenReport,
  CommunityReport,
  Condition,
  FeedKey,
  FeedStatus,
  Hotspot,
  LatLon,
  Level,
  NearbyEvent,
  Quake,
  Volcano,
  Weather,
} from './types.js';
import { VOLCANOES } from './volcanoes.js';

export interface AssessInput {
  now?: number;
  /** Keadaan tiap sumber. Sumber yang tidak tercantum dianggap tidak tersedia. */
  feeds: Partial<Record<FeedKey, FeedStatus>>;
  quakes: Quake[];
  /** Cuaca untuk sel lokasi ini, null bila belum ada */
  weather: Weather | null;
  air: Air | null;
  /** Titik api di sekitar (boleh belum disaring radius) */
  hotspots: Hotspot[];
  volcanoes: Volcano[];
}

const feedOk = (input: AssessInput, k: FeedKey, now: number) => {
  const f = input.feeds[k];
  return !!f && f.available && isFresh(k, f.lastSuccessAt, now);
};
const feedAt = (input: AssessInput, k: FeedKey) => input.feeds[k]?.lastSuccessAt ?? null;
const feedSrc = (input: AssessInput, k: FeedKey) => input.feeds[k]?.source ?? null;

function unavailable(kind: Condition['kind'], updatedAt: number | null, now: number): Condition {
  return {
    kind,
    level: null,
    head: UNAVAILABLE[kind],
    act: lastUpdate(updatedAt, now),
    rows: [],
    available: false,
    updatedAt,
    source: null,
  };
}

export function assessQuake(p: LatLon, input: AssessInput, now: number): Condition {
  if (!feedOk(input, 'gempa', now)) return unavailable('gempa', feedAt(input, 'gempa'), now);
  const candidates = input.quakes
    .filter((q) => now - q.t < T.quake.windowMs && q.t <= now + 5 * 60_000)
    .map((q) => {
      const d = km(p.lat, p.lon, q.lat, q.lon);
      return { q, d, l: quakeLevel(q.m, d, q.tsunami) };
    })
    .filter((x): x is { q: Quake; d: number; l: Level } => x.l !== null)
    .sort((a, b) => b.l - a.l || a.d - b.d);
  const base = { kind: 'gempa' as const, available: true, updatedAt: feedAt(input, 'gempa'), source: feedSrc(input, 'gempa') };
  const top = candidates[0];
  if (!top) return { ...base, level: 0, head: QUAKE.none[0], act: QUAKE.none[1], rows: [] };
  const { q, d, l } = top;
  const tsunami = q.tsunami && d < T.quake.tsunamiWithinKm;
  const [head, act] = tsunami ? QUAKE.tsunami : l === 2 ? QUAKE.strong : QUAKE.felt;
  const rows: [string, string][] = [
    ['Kekuatan', `M ${num(q.m, 1)}`],
    ['Jarak', `${Math.round(d)} km`],
    ['Waktu', `${ago(q.t, now)}, ${wib(q.t)}`],
    ['Kedalaman', `${Math.round(q.depthKm)} km`],
    ['Pusat gempa', q.place],
  ];
  if (q.felt) rows.push(['Dirasakan', q.felt]);
  if (q.potential) rows.push(['Potensi', q.potential]);
  rows.push(['Sumber', q.src]);
  return { ...base, level: l, head, act, rows, focus: { lat: q.lat, lon: q.lon, zoom: 8 } };
}

export function assessRain(p: LatLon, input: AssessInput, now: number): Condition {
  const w = input.weather;
  const fresh = w && now - w.fetchedAt <= FEEDS.cuaca.staleAfterMs;
  if (!w || !fresh) return unavailable('hujan', w?.fetchedAt ?? null, now);
  const l = rainLevel(w.past24, w.next24);
  const [head, act] = rainCopy(l, w.next24);
  return {
    kind: 'hujan',
    level: l,
    head,
    act,
    rows: [
      ['Hujan 24 jam ke depan', `${num(w.next24)} mm`],
      ['Hujan 24 jam terakhir', `${num(w.past24)} mm`],
      ['Saat ini', `${num(w.now, 1)} mm/jam`],
      ['Suhu', `${num(w.temp)} °C`],
      ['Angin', `${num(w.wind)} km/jam`],
      ['Sumber', 'Open-Meteo'],
    ],
    note: 'Perkiraan dari curah hujan, bukan ukuran tinggi air.',
    available: true,
    updatedAt: w.fetchedAt,
    source: 'Open-Meteo',
    focus: { lat: p.lat, lon: p.lon, zoom: 9 },
  };
}

export function assessAir(_p: LatLon, input: AssessInput, now: number): Condition {
  const a = input.air;
  const fresh = a && now - a.fetchedAt <= FEEDS.udara.staleAfterMs && Number.isFinite(a.aqi);
  if (!a || !fresh) return unavailable('udara', a?.fetchedAt ?? null, now);
  const [head, act, level] = airCopy(a.aqi);
  const rows: [string, string][] = [['Indeks kualitas udara (AQI)', String(Math.round(a.aqi))]];
  if (a.pm25 != null) rows.push(['PM2.5', `${num(a.pm25, 1)} µg/m³`]);
  rows.push(['Sumber', 'Open-Meteo (CAMS)']);
  return {
    kind: 'udara',
    level,
    head,
    act,
    rows,
    note: 'Hasil model atmosfer, bukan sensor di lokasi.',
    available: true,
    updatedAt: a.fetchedAt,
    source: 'Open-Meteo (CAMS)',
  };
}

export function assessFire(p: LatLon, input: AssessInput, now: number): Condition {
  if (!feedOk(input, 'api', now)) return unavailable('api', feedAt(input, 'api'), now);
  const near = input.hotspots
    .filter((f) => f.conf !== 'l' && now - f.t < T.fire.windowMs && Math.abs(f.lat - p.lat) < 0.6)
    .map((f) => ({ f, d: km(p.lat, p.lon, f.lat, f.lon) }))
    .filter((x) => x.d < T.fire.radiusKm)
    .sort((a, b) => a.d - b.d);
  const l = fireLevel(near.length);
  const base = { kind: 'api' as const, available: true, updatedAt: feedAt(input, 'api'), source: feedSrc(input, 'api') };
  if (l === 0) return { ...base, level: 0, head: FIRE.none[0], act: FIRE.none[1], rows: [] };
  const [head, act] = l === 2 ? FIRE.many : FIRE.some;
  const nearest = near[0]!;
  return {
    ...base,
    level: l,
    head,
    act,
    rows: [
      [`Jumlah dalam radius ${T.fire.radiusKm} km`, String(near.length)],
      ['Terdekat', `${Math.round(nearest.d)} km`],
      ['Terdeteksi', `${ago(nearest.f.t, now)}, ${wib(nearest.f.t)}`],
      ['Sumber', 'NASA FIRMS'],
    ],
    note: 'Terdeteksi satelit dengan jeda sekitar 3 jam. Bisa berupa kebakaran lahan atau pembakaran terbuka.',
    focus: { lat: nearest.f.lat, lon: nearest.f.lon, zoom: 10 },
  };
}

/** Baris gunung api hanya muncul bila relevan (ada gunung berstatus dekat, atau data hilang padahal ada gunung dekat). */
export function assessVolcano(p: LatLon, input: AssessInput, now: number): Condition | null {
  if (!feedOk(input, 'gunung', now)) {
    const close = VOLCANOES.some((v) => km(p.lat, p.lon, v.lat, v.lon) <= T.volcano.eruptingWithinKm);
    return close ? unavailable('gunung', feedAt(input, 'gunung'), now) : null;
  }
  const top = input.volcanoes
    .map((v) => {
      const d = km(p.lat, p.lon, v.lat, v.lon);
      return { v, d, l: volcanoLevel(v.alert, d, v.erupting || v.satellite) };
    })
    .filter((x) => x.l > 0)
    .sort((a, b) => b.l - a.l || a.d - b.d)[0];
  if (!top) return null;
  const { v, d, l } = top;
  const rows: [string, string][] = [];
  if (v.alert) rows.push(['Status resmi', ALERT_NAMES[v.alert]]);
  if (v.erupting) rows.push(['Keterangan', 'Erupsi atau abu vulkanik dilaporkan baru-baru ini']);
  else if (v.satellite) rows.push(['Keterangan', 'Aktivitas terpantau satelit']);
  rows.push(['Jarak ke puncak', `${Math.round(d)} km`]);
  rows.push(['Sumber', v.src === 'MAGMA' ? 'MAGMA Indonesia (PVMBG)' : 'NASA EONET']);
  const head =
    v.alert && v.alert >= 3
      ? `Gunung ${v.name} berstatus ${v.alert === 4 ? 'Awas' : 'Siaga'}`
      : v.erupting
        ? `Gunung ${v.name} sedang erupsi`
        : `Gunung ${v.name} sedang aktif`;
  return {
    kind: 'gunung',
    level: l,
    head,
    act: VOLCANO_ACT[l],
    rows,
    note: 'Radius bahaya resmi berbeda untuk tiap gunung. Ikuti rekomendasi PVMBG di magma.esdm.go.id.',
    available: true,
    updatedAt: feedAt(input, 'gunung'),
    source: v.src,
    focus: { lat: v.lat, lon: v.lon, zoom: 10 },
  };
}

const MISSING_KIND: Record<Condition['kind'], FeedKey> = {
  gempa: 'gempa',
  hujan: 'cuaca',
  udara: 'udara',
  api: 'api',
  gunung: 'gunung',
};

export function assess(p: LatLon & { name?: string }, input: AssessInput): Assessment {
  const now = input.now ?? Date.now();
  const list: Condition[] = [
    assessQuake(p, input, now),
    assessRain(p, input, now),
    assessAir(p, input, now),
    assessFire(p, input, now),
  ];
  const v = assessVolcano(p, input, now);
  if (v) list.push(v);

  // Urutan: paling berbahaya dulu, yang tidak tersedia di akhir. Urutan asli dipertahankan bila sama.
  const conditions = list
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (b.c.level ?? -1) - (a.c.level ?? -1) || a.i - b.i)
    .map((x) => x.c);

  const avail = conditions.filter((c) => c.available);
  const missing = conditions.filter((c) => !c.available).map((c) => MISSING_KIND[c.kind]);
  if (!avail.length) {
    return {
      level: null,
      label: 'Belum ada data',
      sentence: 'Data untuk lokasi ini belum tersedia. Coba lagi beberapa menit lagi.',
      action: '',
      conditions,
      missing,
    };
  }
  const level = Math.max(...avail.map((c) => c.level ?? 0)) as Level;
  const warn = avail.filter((c) => (c.level ?? 0) > 0);
  const place = p.name ?? 'lokasi ini';
  let sentence: string;
  if (level > 0) {
    sentence = `${warn[0]!.head}${warn.length > 1 ? ` dan ${warn.length - 1} peringatan lain` : ''}.`;
  } else if (missing.length) {
    sentence = `Tidak ada ancaman di sekitar ${place} dari data yang tersedia.`;
  } else {
    sentence = `Tidak ada ancaman di sekitar ${place} saat ini.`;
  }
  return {
    level,
    label: (['Aman', 'Waspada', 'Bahaya'] as const)[level],
    sentence,
    action: warn[0]?.act ?? '',
    conditions,
    missing,
  };
}

export interface NearbyInput {
  now?: number;
  citizen: CitizenReport[];
  community: CommunityReport[];
  quakes: Quake[];
}

const HAZARD_TITLE: Record<CommunityReport['hazard'], string> = {
  banjir: 'Banjir dilaporkan',
  kebakaran: 'Kebakaran dilaporkan',
  gempa: 'Gempa dilaporkan warga',
  angin: 'Angin kencang dilaporkan',
  gunung: 'Aktivitas gunung dilaporkan',
  asap: 'Kabut asap dilaporkan',
  lainnya: 'Kejadian dilaporkan',
};

/** Kejadian terdekat: laporan warga & komunitas dalam 40 km, gempa 48 jam dalam 400 km. Maks 4. */
export function nearby(p: LatLon, input: NearbyInput, limit = 4): NearbyEvent[] {
  const now = input.now ?? Date.now();
  const ev: NearbyEvent[] = [];
  for (const r of input.citizen) {
    const d = km(p.lat, p.lon, r.lat, r.lon);
    if (d < 40) ev.push({ type: 'warga', title: r.kind + (r.text ? `: ${r.text}` : ''), km: d, t: r.t, lat: r.lat, lon: r.lon, zoom: 13, ref: r.id });
  }
  for (const r of input.community) {
    const d = km(p.lat, p.lon, r.lat, r.lon);
    if (d < 40 && now - r.t < 3 * 864e5)
      ev.push({ type: 'komunitas', title: HAZARD_TITLE[r.hazard] + (r.text ? `: ${r.text}` : ''), km: d, t: r.t, lat: r.lat, lon: r.lon, zoom: 13, ref: r.id });
  }
  for (const q of input.quakes) {
    const d = km(p.lat, p.lon, q.lat, q.lon);
    if (d < 400 && now - q.t < 2 * 864e5)
      ev.push({ type: 'gempa', title: `Gempa M ${num(q.m, 1)}`, km: d, t: q.t, lat: q.lat, lon: q.lon, zoom: 8, ref: q.id });
  }
  return ev.sort((a, b) => a.km - b.km).slice(0, limit);
}
