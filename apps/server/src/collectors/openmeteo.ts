import { aqiLevel, parseOpenMeteoAir, parseOpenMeteoForecast, rainLevel, type Air, type Weather } from '@siaga/core';
import { config } from '../config.js';
import { prisma } from '../lib/db.js';
import { getJson } from '../lib/http.js';
import { acquireLock, rateLimit } from '../lib/redis.js';
import { activeCells, getAir, getWeather, putAir, putWeather, touchCell } from '../services/store.js';
import type { RunResult } from './types.js';

type Cell = { key: string; lat: number; lon: number };

/**
 * API gratis Open-Meteo hanya untuk non-komersial. Dengan OPEN_METEO_API_KEY,
 * permintaan dialihkan ke host pelanggan (customer-*.open-meteo.com).
 */
function host(kind: 'forecast' | 'air'): { base: string; key: string } {
  const k = config.sources.openMeteoKey;
  if (kind === 'forecast')
    return { base: k ? 'https://customer-api.open-meteo.com/v1/forecast' : 'https://api.open-meteo.com/v1/forecast', key: k ? `&apikey=${encodeURIComponent(k)}` : '' };
  return {
    base: k ? 'https://customer-air-quality-api.open-meteo.com/v1/air-quality' : 'https://air-quality-api.open-meteo.com/v1/air-quality',
    key: k ? `&apikey=${encodeURIComponent(k)}` : '',
  };
}

const coords = (cells: Cell[]) =>
  `latitude=${cells.map((c) => c.lat.toFixed(2)).join(',')}&longitude=${cells.map((c) => c.lon.toFixed(2)).join(',')}`;

export async function fetchWeather(cells: Cell[]): Promise<Weather[]> {
  const h = host('forecast');
  const url = `${h.base}?${coords(cells)}&current=temperature_2m,precipitation,wind_speed_10m&hourly=precipitation&past_hours=24&forecast_hours=24&timezone=Asia%2FJakarta${h.key}`;
  return parseOpenMeteoForecast(await getJson(url, 20_000), cells, Date.now());
}

export async function fetchAir(cells: Cell[]): Promise<Air[]> {
  const h = host('air');
  const url = `${h.base}?${coords(cells)}&current=us_aqi,pm2_5,pm10&timezone=Asia%2FJakarta${h.key}`;
  return parseOpenMeteoAir(await getJson(url, 20_000), cells, Date.now());
}

const BATCH = 100;
function chunks<T>(a: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
}

async function saveWeather(cells: Cell[], ws: Weather[]) {
  await Promise.all(ws.map((w, i) => putWeather(cells[i]!.key, w)));
  await prisma.weatherObservation.createMany({
    data: ws.map((w, i) => ({
      cell: cells[i]!.key,
      lat: w.lat,
      lon: w.lon,
      modelTime: new Date(w.at),
      fetchedAt: new Date(w.fetchedAt),
      precipNow: w.now,
      past24: w.past24,
      next24: w.next24,
      temp: Number.isFinite(w.temp) ? w.temp : null,
      wind: Number.isFinite(w.wind) ? w.wind : null,
      level: rainLevel(w.past24, w.next24),
    })),
  });
}

async function saveAir(cells: Cell[], as: Air[]) {
  const valid = as.map((a, i) => ({ a, c: cells[i]! })).filter((x) => Number.isFinite(x.a.aqi));
  await Promise.all(valid.map((x) => putAir(x.c.key, x.a)));
  await prisma.airObservation.createMany({
    data: valid.map(({ a, c }) => ({
      cell: c.key,
      lat: a.lat,
      lon: a.lon,
      modelTime: new Date(a.at),
      fetchedAt: new Date(a.fetchedAt),
      aqi: a.aqi,
      pm25: a.pm25,
      pm10: a.pm10,
      level: aqiLevel(a.aqi),
    })),
  });
  return valid.length;
}

export async function collectCuaca(): Promise<RunResult> {
  if (!config.sources.openMeteo) throw new Error('Open-Meteo dimatikan di konfigurasi');
  const cells = await activeCells();
  let ok = 0;
  const errors: string[] = [];
  for (const batch of chunks(cells, BATCH)) {
    try {
      const ws = await fetchWeather(batch);
      await saveWeather(batch, ws);
      ok += ws.length;
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  if (!ok) throw new Error(errors.join('; ') || 'tidak ada sel');
  return { source: 'Open-Meteo', count: ok, note: errors.length ? `${errors.length} batch gagal` : undefined };
}

export async function collectUdara(): Promise<RunResult> {
  if (!config.sources.openMeteo) throw new Error('Open-Meteo dimatikan di konfigurasi');
  const cells = await activeCells();
  let ok = 0;
  const errors: string[] = [];
  for (const batch of chunks(cells, BATCH)) {
    try {
      ok += await saveAir(batch, await fetchAir(batch));
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  if (!ok) throw new Error(errors.join('; ') || 'tidak ada sel');
  return { source: 'Open-Meteo (CAMS)', count: ok, note: errors.length ? `${errors.length} batch gagal` : undefined };
}

/**
 * Untuk lokasi baru yang belum pernah dipantau: ambil langsung satu sel, dengan
 * batas global supaya kuota Open-Meteo tidak habis. Gagal → null (UI menampilkan
 * "data belum tersedia"; worker akan mengisinya pada putaran berikutnya).
 */
export async function weatherOnDemand(cell: Cell): Promise<{ weather: Weather | null; air: Air | null }> {
  await touchCell(cell.key);
  let [weather, air] = await Promise.all([getWeather(cell.key), getAir(cell.key)]);
  if ((weather && air) || !config.sources.openMeteo) return { weather, air };
  const release = await acquireLock(`ondemand:${cell.key}`, 15_000);
  if (!release) return { weather, air };
  try {
    if (!(await rateLimit('openmeteo:ondemand', 600, 3600))) return { weather, air };
    const tasks: Promise<unknown>[] = [];
    if (!weather)
      tasks.push(
        fetchWeather([cell])
          .then(async (ws) => {
            await saveWeather([cell], ws);
            weather = ws[0] ?? null;
          })
          .catch((e) => console.warn("ondemand", cell.key, e?.message)),
      );
    if (!air)
      tasks.push(
        fetchAir([cell])
          .then(async (as) => {
            await saveAir([cell], as);
            air = as[0] && Number.isFinite(as[0].aqi) ? as[0] : null;
          })
          .catch((e) => console.warn("ondemand", cell.key, e?.message)),
      );
    await Promise.race([Promise.all(tasks), new Promise((r) => setTimeout(r, 8_000))]);
    return { weather, air };
  } finally {
    await release();
  }
}
