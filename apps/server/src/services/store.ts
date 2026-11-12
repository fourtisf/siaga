/**
 * Data terakhir tiap sumber di Redis, dengan cache memori singkat di proses API.
 * Worker menulis; API membaca.
 */
import {
  cellOf,
  CITIES,
  FEED_KEYS,
  FEEDS,
  isFresh,
  type Air,
  type CommunityReport,
  type FeedKey,
  type FeedStatus,
  type Hotspot,
  type Quake,
  type Volcano,
  type Weather,
} from '@siaga/core';
import { config } from '../config.js';
import { prisma } from '../lib/db.js';
import { publish } from '../lib/live.js';
import { getJSON, K, redis, setJSON } from '../lib/redis.js';

interface FeedMeta {
  lastSuccessAt: number | null;
  lastAttemptAt: number | null;
  source: string | null;
  error: string | null;
  count?: number;
}

export function feedEnabled(key: FeedKey): boolean {
  const s = config.sources;
  switch (key) {
    case 'gempa':
      return s.bmkg || s.usgs;
    case 'cuaca':
    case 'udara':
      return s.openMeteo;
    case 'api':
      return s.firms;
    case 'gunung':
      return s.magma || s.eonet;
    case 'banjir':
      return s.petabencana;
  }
}

export async function recordRun(
  key: FeedKey,
  r: { ok: boolean; source?: string | null; count?: number; error?: string },
  startedAt: number,
): Promise<void> {
  const end = Date.now();
  const meta: FeedMeta = (await getJSON<FeedMeta>(K.feed(key))) ?? { lastSuccessAt: null, lastAttemptAt: null, source: null, error: null };
  meta.lastAttemptAt = end;
  if (r.ok) {
    meta.lastSuccessAt = end;
    meta.source = r.source ?? null;
    meta.count = r.count;
    meta.error = null;
  } else {
    meta.error = (r.error ?? 'gagal').slice(0, 500);
  }
  await setJSON(K.feed(key), meta);
  await prisma.feedRun
    .create({
      data: {
        feed: key,
        source: r.source ?? null,
        startedAt: new Date(startedAt),
        durationMs: end - startedAt,
        ok: r.ok,
        count: r.count ?? null,
        error: r.ok ? null : meta.error,
      },
    })
    .catch(() => undefined);
  mem.delete('feeds');
  await publish({ type: 'feed', key, ok: r.ok, source: r.source ?? null, count: r.count });
}

export async function lastAttempt(key: FeedKey): Promise<number | null> {
  return (await getJSON<FeedMeta>(K.feed(key)))?.lastAttemptAt ?? null;
}

/* ---------- cache memori ---------- */

const mem = new Map<string, { at: number; v: unknown }>();
async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = mem.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.v as T;
  const v = await load();
  mem.set(key, { at: Date.now(), v });
  return v;
}

export async function getFeeds(now = Date.now()): Promise<Record<FeedKey, FeedStatus>> {
  return cached('feeds', 5_000, async () => {
    const metas = await redis.mget(FEED_KEYS.map((k) => K.feed(k)));
    const out = {} as Record<FeedKey, FeedStatus>;
    FEED_KEYS.forEach((key, i) => {
      let m: FeedMeta | null = null;
      try {
        m = metas[i] ? (JSON.parse(metas[i]!) as FeedMeta) : null;
      } catch {
        m = null;
      }
      const enabled = feedEnabled(key);
      out[key] = {
        key,
        available: enabled && isFresh(key, m?.lastSuccessAt, now),
        lastSuccessAt: m?.lastSuccessAt ?? null,
        lastAttemptAt: m?.lastAttemptAt ?? null,
        source: m?.source ?? null,
        error: enabled ? (m?.error ?? null) : 'sumber dimatikan di konfigurasi',
        count: m?.count,
      };
    });
    return out;
  });
}

/* ---------- daftar data per sumber ---------- */

export async function putList(key: FeedKey, list: unknown[]): Promise<void> {
  await setJSON(K.data(key), list);
  await redis.incr(K.ver(key));
}

async function list<T>(key: FeedKey): Promise<T[]> {
  return cached(`list:${key}`, 10_000, async () => (await getJSON<T[]>(K.data(key))) ?? []);
}

export const getQuakes = () => list<Quake>('gempa');
export const getHotspots = () => list<Hotspot>('api');
export const getVolcanoes = () => list<Volcano>('gunung');
export const getCommunity = () => list<CommunityReport>('banjir');

/* ---------- cuaca & udara per sel ---------- */

const CELL_TTL_SEC = 6 * 3600;

export async function putWeather(cell: string, w: Weather): Promise<void> {
  await setJSON(K.wx(cell), w, CELL_TTL_SEC);
}
export async function putAir(cell: string, a: Air): Promise<void> {
  await setJSON(K.aq(cell), a, CELL_TTL_SEC);
}
export const getWeather = (cell: string) => getJSON<Weather>(K.wx(cell));
export const getAir = (cell: string) => getJSON<Air>(K.aq(cell));

export async function getWeatherMany(cells: string[]): Promise<(Weather | null)[]> {
  if (!cells.length) return [];
  const v = await redis.mget(cells.map(K.wx));
  return v.map((s) => (s ? (JSON.parse(s) as Weather) : null));
}
export async function getAirMany(cells: string[]): Promise<(Air | null)[]> {
  if (!cells.length) return [];
  const v = await redis.mget(cells.map(K.aq));
  return v.map((s) => (s ? (JSON.parse(s) as Air) : null));
}

/** Tandai sel yang baru diminta supaya worker ikut memperbaruinya. */
export async function touchCell(cellKey: string): Promise<void> {
  await redis.zadd(K.activeCells, Date.now(), cellKey);
}

/**
 * Sel yang dipantau worker: 45 kota + semua lokasi pantauan + sel yang diminta dalam 24 jam terakhir.
 */
export async function activeCells(): Promise<{ key: string; lat: number; lon: number }[]> {
  const since = Date.now() - 24 * 3600_000;
  await redis.zremrangebyscore(K.activeCells, 0, since);
  const recent = await redis.zrangebyscore(K.activeCells, since, '+inf');
  const places = await prisma.place.findMany({ select: { lat: true, lon: true } });
  const map = new Map<string, { key: string; lat: number; lon: number }>();
  for (const c of CITIES) {
    const cell = cellOf(c.lat, c.lon);
    map.set(cell.key, cell);
  }
  for (const p of places) {
    const cell = cellOf(p.lat, p.lon);
    map.set(cell.key, cell);
  }
  for (const k of recent) {
    const [lat, lon] = k.split(',').map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lon)) map.set(k, { key: k, lat: lat!, lon: lon! });
  }
  return [...map.values()];
}

export const FEED_DEFS = FEEDS;
