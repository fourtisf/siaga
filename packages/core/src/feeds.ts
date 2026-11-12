import type { FeedKey } from './types.js';

export interface FeedDef {
  key: FeedKey;
  label: string;
  /** Jadwal pengumpulan di worker (ms), sesuai brief */
  everyMs: number;
  /**
   * Data dianggap kedaluwarsa bila pengambilan berhasil terakhir lebih tua dari ini.
   * Kedaluwarsa = tampil "data belum tersedia" + waktu pembaruan terakhir.
   */
  staleAfterMs: number;
}

const MIN = 60_000;

export const FEEDS: Record<FeedKey, FeedDef> = {
  gempa: { key: 'gempa', label: 'Gempa', everyMs: 1 * MIN, staleAfterMs: 10 * MIN },
  banjir: { key: 'banjir', label: 'Laporan banjir', everyMs: 5 * MIN, staleAfterMs: 30 * MIN },
  cuaca: { key: 'cuaca', label: 'Hujan', everyMs: 10 * MIN, staleAfterMs: 60 * MIN },
  udara: { key: 'udara', label: 'Kualitas udara', everyMs: 15 * MIN, staleAfterMs: 90 * MIN },
  api: { key: 'api', label: 'Titik api', everyMs: 30 * MIN, staleAfterMs: 3 * 60 * MIN },
  gunung: { key: 'gunung', label: 'Gunung api', everyMs: 30 * MIN, staleAfterMs: 3 * 60 * MIN },
};

export const FEED_KEYS = Object.keys(FEEDS) as FeedKey[];

export function isFresh(key: FeedKey, lastSuccessAt: number | null | undefined, now = Date.now()): boolean {
  return lastSuccessAt != null && now - lastSuccessAt <= FEEDS[key].staleAfterMs;
}
