'use client';
import type { Assessment, CitizenReport, FeedKey, FeedStatus, LatLon, NearbyEvent } from '@siaga/core';

export interface StatusResponse extends Assessment {
  place: LatLon & { name: string | null };
  nearby: NearbyEvent[];
  feeds: Record<FeedKey, FeedStatus>;
  generatedAt: number;
}

export interface MapResponse {
  mode: 'danger' | 'all';
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

export type LayerId = 'gempa' | 'banjir' | 'api' | 'udara' | 'gunung' | 'warga';

export interface LiveItem {
  id: string;
  type: LayerId;
  now: 0 | 1 | 2;
  rank: number;
  value?: string;
  unit?: string;
  icon?: string;
  t: number;
  title: string;
  sub: string;
  lat: number;
  lon: number;
  zoom: number;
  ref?: string;
}

export interface Overview {
  generatedAt: number;
  feeds: Record<FeedKey, FeedStatus>;
  situation: { level: 0 | 1 | 2; head: string; items: string[] };
  kpis: { id: LayerId; label: string; value: string; unit?: string; sub: string; color?: string }[];
  counts: Record<LayerId, number>;
  events: LiveItem[];
}

export interface SourcesResponse {
  feeds: (FeedStatus & { label: string; everyMs: number; staleAfterMs: number })[];
  attribution: { feed: string; text: string; url: string }[];
  generatedAt: number;
}

export interface Place {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface AlertConfig {
  channels: { webpush: boolean; telegram: boolean; whatsapp: boolean };
  vapidPublicKey: string | null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    msg: string,
  ) {
    super(msg);
  }
}

const BASE = '/api';
const TOKEN_KEY = 'siaga.token';

export const store = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem(k);
      return v == null ? d : (JSON.parse(v) as T);
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* penyimpanan penuh atau diblokir */
    }
  },
  del(k: string) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* abaikan */
    }
  },
};

let tokenPromise: Promise<string> | null = null;

/** Token perangkat anonim. Dibuat sekali, disimpan di localStorage. */
export function deviceToken(): Promise<string> {
  const t = store.get<string | null>(TOKEN_KEY, null);
  if (t) return Promise.resolve(t);
  tokenPromise ??= (async () => {
    const r = await fetch(`${BASE}/devices`, { method: 'POST' });
    if (!r.ok) throw new ApiError(r.status, 'device', 'Tidak bisa mendaftarkan perangkat.');
    const j = (await r.json()) as { token: string };
    store.set(TOKEN_KEY, j.token);
    return j.token;
  })().finally(() => {
    tokenPromise = null;
  });
  return tokenPromise;
}

async function parse<T>(r: Response): Promise<T> {
  if (r.status === 204) return undefined as T;
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new ApiError(r.status, j?.error?.code ?? 'error', j?.error?.message ?? 'Gagal menghubungi server.');
  return j as T;
}

export async function get<T>(path: string, opts: { auth?: boolean; signal?: AbortSignal } = {}): Promise<T> {
  return call<T>(path, { method: 'GET', signal: opts.signal }, !!opts.auth);
}

export async function send<T>(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  return call<T>(path, init, true);
}

async function call<T>(path: string, init: RequestInit, auth: boolean, retried = false): Promise<T> {
  const headers = new Headers(init.headers);
  if (auth) headers.set('Authorization', `Bearer ${await deviceToken()}`);
  const r = await fetch(`${BASE}${path}`, { ...init, headers, cache: 'no-store' });
  if (r.status === 401 && auth && !retried) {
    // token tidak dikenal (misalnya database diganti): daftar ulang sekali
    store.del(TOKEN_KEY);
    return call<T>(path, init, auth, true);
  }
  return parse<T>(r);
}

export const api = {
  status: (p: LatLon & { name?: string }, signal?: AbortSignal) =>
    get<StatusResponse>(`/status?lat=${p.lat}&lon=${p.lon}${p.name ? `&name=${encodeURIComponent(p.name)}` : ''}`, { signal }),
  levels: (pts: LatLon[]) =>
    get<{ lat: number; lon: number; level: 0 | 1 | 2 | null; label: string }[]>(`/status/levels?points=${pts.map((p) => `${p.lat},${p.lon}`).join(';')}`),
  map: (mode: 'danger' | 'all', focus: LatLon | null, signal?: AbortSignal) =>
    get<MapResponse>(`/map?mode=${mode}${focus ? `&focus=${focus.lat},${focus.lon}` : ''}`, { signal }),
  overview: () => get<Overview>('/overview'),
  sources: () => get<SourcesResponse>('/sources'),
  places: () => get<Place[]>('/places', { auth: true }),
  addPlace: (p: Omit<Place, 'id'>) => send<Place>('/places', 'POST', p),
  delPlace: (id: string) => send<void>(`/places/${id}`, 'DELETE'),
  mine: () => get<CitizenReport[]>('/reports/mine', { auth: true }),
  report: (fd: FormData) => send<{ id: string; status: 'pending' | 'duplicate'; message: string }>('/reports', 'POST', fd),
  alertConfig: () => get<AlertConfig>('/alerts/config'),
  alerts: () => get<{ id: string; channel: string }[]>('/alerts', { auth: true }),
  subscribe: (body: unknown) => send<{ ok: boolean; url?: string }>('/alerts/subscribe', 'POST', body),
  unsubscribe: (body: unknown = {}) => send<{ ok: boolean; removed: number }>('/alerts/unsubscribe', 'POST', body),
};
