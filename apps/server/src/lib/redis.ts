import { Redis } from 'ioredis';
import { config } from '../config.js';

export const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 3, enableAutoPipelining: true });

/** Semua kunci SIAGA memakai awalan ini supaya Redis bisa dipakai bersama. */
export const K = {
  feed: (k: string) => `siaga:feed:${k}`,
  data: (k: string) => `siaga:data:${k}`,
  ver: (k: string) => `siaga:ver:${k}`,
  wx: (cell: string) => `siaga:wx:${cell}`,
  aq: (cell: string) => `siaga:aq:${cell}`,
  activeCells: 'siaga:cells:active',
  lock: (name: string) => `siaga:lock:${name}`,
  rate: (name: string) => `siaga:rl:${name}`,
  tgLink: (code: string) => `siaga:tglink:${code}`,
  fetchLock: (name: string) => `siaga:fetching:${name}`,
};

export async function getJSON<T>(key: string): Promise<T | null> {
  const s = await redis.get(key);
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export async function setJSON(key: string, value: unknown, ttlSec?: number): Promise<void> {
  const s = JSON.stringify(value);
  if (ttlSec) await redis.set(key, s, 'EX', ttlSec);
  else await redis.set(key, s);
}

/** Kunci terdistribusi sederhana (SET NX PX). Mengembalikan fungsi pelepas, atau null bila sudah dipegang. */
export async function acquireLock(name: string, ttlMs: number): Promise<null | (() => Promise<void>)> {
  const token = Math.random().toString(36).slice(2);
  const ok = await redis.set(K.lock(name), token, 'PX', ttlMs, 'NX');
  if (!ok) return null;
  return async () => {
    // lepas hanya bila masih milik kita
    await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      K.lock(name),
      token,
    );
  };
}

/** Penghitung jendela tetap. Mengembalikan true bila masih di bawah batas. */
export async function rateLimit(name: string, max: number, windowSec: number): Promise<boolean> {
  const key = K.rate(name);
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, windowSec);
  return n <= max;
}
