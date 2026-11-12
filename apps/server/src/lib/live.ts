/**
 * Kejadian realtime. Worker (dan API untuk moderasi) menerbitkan ke kanal Redis;
 * setiap proses API berlangganan dan meneruskannya ke browser lewat SSE (/stream).
 * Bekerja dengan lebih dari satu proses API karena semuanya mendengar kanal yang sama.
 */
import type { FeedKey, Quake } from '@siaga/core';
import { redis } from './redis.js';

export const LIVE_CHANNEL = 'siaga:live';

export type LiveEvent =
  | { type: 'feed'; key: FeedKey; ok: boolean; source?: string | null; count?: number }
  | { type: 'quake'; quake: Pick<Quake, 'id' | 't' | 'lat' | 'lon' | 'm' | 'depthKm' | 'place' | 'tsunami' | 'src'> }
  | { type: 'volcano'; code: string; name: string; from: number | null; to: number | null }
  | { type: 'report'; id: string; kind: string; lat: number; lon: number };

export async function publish(ev: LiveEvent): Promise<void> {
  await redis.publish(LIVE_CHANNEL, JSON.stringify({ ...ev, ts: Date.now() })).catch(() => undefined);
}
