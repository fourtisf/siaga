import type { Level, VolcanoAlert } from './types.js';

/**
 * Ambang tingkat bahaya. Nilai hujan, udara, gempa, dan titik api diambil
 * apa adanya dari prototipe (lihat prototype/SIAGA-BRIEF.md, "Aturan produk").
 * Ambang gunung api dan tsunami adalah tambahan, lihat catatan masing-masing.
 */
export const T = {
  /** Ambang harian BMKG: lebat 50 mm, sangat lebat 100 mm */
  rain: { waspada: 50, bahaya: 100 },
  /** US AQI: di atas 100 Waspada, di atas 200 Bahaya */
  aqi: { waspada: 100, bahaya: 200 },
  quake: {
    windowMs: 24 * 3600_000,
    /** Gempa apa pun dalam radius ini → Waspada */
    anyWithinKm: 100,
    /** M ≥ 5 dalam radius ini → Waspada */
    m5WithinKm: 300,
    strongM: 5,
    /** M ≥ 5,5 dalam radius ini → Bahaya */
    dangerM: 5.5,
    dangerWithinKm: 150,
    /**
     * Tambahan: BMKG menyatakan "berpotensi tsunami" dalam radius ini → Bahaya.
     * Prototipe tidak menangani tsunami sama sekali.
     */
    tsunamiWithinKm: 300,
  },
  fire: {
    radiusKm: 50,
    /** Lebih dari 10 titik → Bahaya, 1-10 → Waspada */
    dangerCount: 10,
    windowMs: 24 * 3600_000,
  },
  /**
   * USULAN, belum ada di brief. Radius rekomendasi PVMBG berbeda per gunung
   * (umumnya 1-4 km untuk Waspada, 3-7 km Siaga, 5-12 km Awas). Angka di bawah
   * sengaja lebih lebar. Perlu ditinjau tim sebelum rilis.
   */
  volcano: {
    /** [radius Bahaya, radius Waspada] dalam km per tingkat resmi */
    byAlert: {
      1: [0, 0],
      2: [0, 8],
      3: [10, 30],
      4: [15, 40],
    } as Record<VolcanoAlert, [number, number]>,
    /** Erupsi/VONA terbaru atau aktivitas satelit dalam radius ini → Waspada (abu) */
    eruptingWithinKm: 40,
  },
} as const;

export function rainLevel(past24: number, next24: number): Level {
  const mm = Math.max(past24, next24);
  return mm >= T.rain.bahaya ? 2 : mm >= T.rain.waspada ? 1 : 0;
}

export function aqiLevel(aqi: number): Level {
  return aqi > T.aqi.bahaya ? 2 : aqi > T.aqi.waspada ? 1 : 0;
}

/** Tingkat untuk satu gempa pada jarak tertentu, atau null bila tidak relevan. */
export function quakeLevel(m: number, distKm: number, tsunami = false): Level | null {
  const q = T.quake;
  if (tsunami && distKm < q.tsunamiWithinKm) return 2;
  if (m >= q.dangerM && distKm < q.dangerWithinKm) return 2;
  if (distKm < q.anyWithinKm || (m >= q.strongM && distKm < q.m5WithinKm)) return 1;
  return null;
}

export function fireLevel(count: number): Level {
  return count > T.fire.dangerCount ? 2 : count > 0 ? 1 : 0;
}

export function volcanoLevel(alert: VolcanoAlert | null, distKm: number, erupting: boolean): Level {
  let l: Level = 0;
  if (alert) {
    const [bahaya, waspada] = T.volcano.byAlert[alert];
    if (distKm <= bahaya) l = 2;
    else if (distKm <= waspada) l = 1;
  }
  if (l === 0 && erupting && distKm <= T.volcano.eruptingWithinKm) l = 1;
  return l;
}

/** Kategori dan warna AQI (US EPA) dalam bahasa Indonesia */
export function aqiCategory(v: number): { label: string; color: string } {
  if (v <= 50) return { label: 'Baik', color: '#6fe0a8' };
  if (v <= 100) return { label: 'Sedang', color: '#e9d66b' };
  if (v <= 150) return { label: 'Kurang sehat', color: '#ffb86b' };
  if (v <= 200) return { label: 'Tidak sehat', color: '#ff6b6b' };
  if (v <= 300) return { label: 'Sangat tidak sehat', color: '#c58bff' };
  return { label: 'Berbahaya', color: '#d94f7c' };
}

export const ALERT_NAMES: Record<VolcanoAlert, string> = {
  1: 'Level I (Normal)',
  2: 'Level II (Waspada)',
  3: 'Level III (Siaga)',
  4: 'Level IV (Awas)',
};

export const LEVEL_LABEL = ['Aman', 'Waspada', 'Bahaya'] as const;
