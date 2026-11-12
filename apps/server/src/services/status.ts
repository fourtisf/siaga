import {
  aqiCategory,
  assess,
  BBOX_ID,
  cellOf,
  CITIES,
  inBBox,
  km,
  nearby,
  rainLevel,
  T,
  type Assessment,
  type BBox,
  type CitizenReport,
  type FeedKey,
  type FeedStatus,
  type LatLon,
  type NearbyEvent,
} from '@siaga/core';
import { weatherOnDemand } from '../collectors/openmeteo.js';
import { getAirMany, getCommunity, getFeeds, getHotspots, getQuakes, getVolcanoes, getWeatherMany } from './store.js';
import { approvedReportsIn, approvedReportsNear } from './reports.js';

export interface StatusResponse extends Assessment {
  place: LatLon & { name: string | null };
  nearby: NearbyEvent[];
  feeds: Record<FeedKey, FeedStatus>;
  generatedAt: number;
}

export async function statusFor(lat: number, lon: number, name: string | null, opts: { withNearby?: boolean } = {}): Promise<StatusResponse> {
  const now = Date.now();
  const cell = cellOf(lat, lon);
  const [feeds, quakes, hotspots, volcanoes, cellData] = await Promise.all([
    getFeeds(now),
    getQuakes(),
    getHotspots(),
    getVolcanoes(),
    weatherOnDemand(cell),
  ]);
  const a = assess(
    { lat, lon, name: name ?? undefined },
    { now, feeds, quakes, weather: cellData.weather, air: cellData.air, hotspots, volcanoes },
  );
  let nb: NearbyEvent[] = [];
  if (opts.withNearby !== false) {
    const [citizen, community] = await Promise.all([approvedReportsNear(lat, lon, 40, 72), getCommunity()]);
    nb = nearby({ lat, lon }, { now, citizen, community: feeds.banjir.available ? community : [], quakes: feeds.gempa.available ? quakes : [] });
  }
  return { place: { lat, lon, name }, ...a, nearby: nb, feeds, generatedAt: now };
}

/* ---------------- peta ---------------- */

export type MapMode = 'danger' | 'all';

export interface MapResponse {
  mode: MapMode;
  generatedAt: number;
  feeds: Record<FeedKey, FeedStatus>;
  quakes: { id: string; lat: number; lon: number; m: number; depthKm: number; t: number; place: string; felt?: string; potential?: string; tsunami: boolean; src: string }[];
  rain: { name: string; lat: number; lon: number; level: number; past24: number; next24: number; now: number; fetchedAt: number }[];
  air: { name: string; lat: number; lon: number; aqi: number; pm25: number | null; color: string; label: string; fetchedAt: number }[];
  fires: { lat: number; lon: number; frp: number; t: number; sat: string }[];
  volcanoes: { code: string; name: string; lat: number; lon: number; alert: number | null; erupting: boolean; satellite: boolean; src: string }[];
  community: { id: string; hazard: string; lat: number; lon: number; t: number; text: string; depthCm?: number; imageUrl?: string; city?: string }[];
  reports: CitizenReport[];
}

const inside = (bb: BBox, p: LatLon) => inBBox(p.lat, p.lon, bb);

/**
 * Penanda peta. Mode "danger" (default) hanya menampilkan yang perlu perhatian,
 * sama dengan mode "Yang berbahaya" di prototipe.
 * `focus` = lokasi pantauan aktif (gempa ≤ 300 km dari sini ikut tampil di mode danger).
 */
export async function mapFor(bb: BBox = BBOX_ID, mode: MapMode = 'danger', focus: LatLon | null = null): Promise<MapResponse> {
  const now = Date.now();
  const all = mode === 'all';
  const feeds = await getFeeds(now);
  const [quakes, hotspots, volcanoes, community, reports] = await Promise.all([
    feeds.gempa.available ? getQuakes() : [],
    feeds.api.available ? getHotspots() : [],
    feeds.gunung.available ? getVolcanoes() : [],
    feeds.banjir.available ? getCommunity() : [],
    approvedReportsIn(bb, 72),
  ]);

  const qOut = quakes
    .filter((q) => inside(bb, q))
    .filter((q) => {
      if (all) return now - q.t < 7 * 864e5;
      const d24 = now - q.t < T.quake.windowMs;
      const nearFocus = focus ? km(focus.lat, focus.lon, q.lat, q.lon) < T.quake.m5WithinKm : false;
      return d24 && (q.m >= T.quake.strongM || nearFocus || q.tsunami);
    })
    .map((q) => ({ id: q.id, lat: q.lat, lon: q.lon, m: q.m, depthKm: q.depthKm, t: q.t, place: q.place, felt: q.felt, potential: q.potential, tsunami: q.tsunami, src: q.src }));

  const cities = CITIES.filter((c) => inside(bb, c));
  const cells = cities.map((c) => cellOf(c.lat, c.lon).key);
  const [wx, aq] = await Promise.all([getWeatherMany(cells), getAirMany(cells)]);
  const rain: MapResponse['rain'] = [];
  const air: MapResponse['air'] = [];
  cities.forEach((c, i) => {
    const w = wx[i];
    if (w && now - w.fetchedAt <= 3600_000) {
      const level = rainLevel(w.past24, w.next24);
      const mm = Math.max(w.past24, w.next24);
      if (all ? mm >= 3 : level >= 1) rain.push({ name: c.name, lat: c.lat, lon: c.lon, level, past24: w.past24, next24: w.next24, now: w.now, fetchedAt: w.fetchedAt });
    }
    const a = aq[i];
    if (a && Number.isFinite(a.aqi) && now - a.fetchedAt <= 90 * 60_000) {
      if (all || a.aqi > T.aqi.waspada) {
        const cat = aqiCategory(a.aqi);
        air.push({ name: c.name, lat: c.lat, lon: c.lon, aqi: a.aqi, pm25: a.pm25, color: cat.color, label: cat.label, fetchedAt: a.fetchedAt });
      }
    }
  });

  const fires = hotspots
    .filter((h) => inside(bb, h) && (all || h.conf !== 'l'))
    .slice(0, 3000)
    .map((h) => ({ lat: h.lat, lon: h.lon, frp: h.frp, t: h.t, sat: h.sat }));

  const vOut = volcanoes
    .filter((v) => inside(bb, v) && (all || (v.alert ?? 0) >= 2 || v.erupting || v.satellite))
    .map((v) => ({ code: v.code, name: v.name, lat: v.lat, lon: v.lon, alert: v.alert, erupting: v.erupting, satellite: v.satellite, src: v.src }));

  const cOut = community
    .filter((r) => inside(bb, r) && now - r.t < 3 * 864e5)
    .map((r) => ({ id: r.id, hazard: r.hazard, lat: r.lat, lon: r.lon, t: r.t, text: r.text, depthCm: r.depthCm, imageUrl: r.imageUrl, city: r.city }));

  return { mode, generatedAt: now, feeds, quakes: qOut, rain, air, fires, volcanoes: vOut, community: cOut, reports };
}

