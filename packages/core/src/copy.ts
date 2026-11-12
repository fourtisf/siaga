/**
 * Kalimat untuk orang awam. Satu kalimat keadaan + satu tindakan.
 * Angka tidak boleh muncul di sini; angka hanya di baris rincian.
 */
import type { Level } from './types.js';

export const RAIN: Record<Level, [head: string, act: string]> = {
  0: ['Cuaca aman', 'Tidak perlu tindakan khusus.'],
  1: ['Hujan lebat', 'Bawa jas hujan dan hindari jalan yang biasa tergenang.'],
  2: ['Hujan sangat lebat', 'Waspada banjir. Pindahkan kendaraan ke tempat tinggi dan amankan barang penting.'],
};

export function rainCopy(level: Level, next24: number): [string, string] {
  if (level > 0) return RAIN[level];
  if (next24 >= 20) return ['Hujan sedang', 'Cukup bawa payung.'];
  if (next24 >= 2) return ['Hujan ringan', 'Cukup bawa payung.'];
  return RAIN[0];
}

export function airCopy(aqi: number): [head: string, act: string, level: Level] {
  if (aqi > 200) return ['Udara sangat tidak sehat', 'Tetap di dalam ruangan dan tutup jendela.', 2];
  if (aqi > 150) return ['Udara tidak sehat', 'Pakai masker di luar dan kurangi aktivitas luar ruangan.', 1];
  if (aqi > 100) return ['Udara kurang sehat', 'Anak, lansia, dan penderita asma sebaiknya pakai masker.', 1];
  if (aqi > 50) return ['Udara cukup baik', 'Aman untuk beraktivitas di luar.', 0];
  return ['Udara bersih', 'Aman untuk beraktivitas di luar.', 0];
}

export const QUAKE = {
  none: ['Tidak ada gempa', 'Tidak ada gempa berarti dalam 24 jam terakhir.'],
  felt: ['Gempa terasa di sekitar Anda', 'Periksa rumah dari retakan. Waspada gempa susulan.'],
  strong: ['Gempa kuat di dekat Anda', 'Jauhi bangunan retak dan waspada gempa susulan.'],
  tsunami: [
    'Gempa berpotensi tsunami',
    'Bila Anda di dekat pantai, segera menjauh ke tempat tinggi dan ikuti arahan BMKG dan BPBD.',
  ],
} as const;

export const FIRE = {
  none: ['Tidak ada kebakaran', 'Tidak ada titik api di sekitar Anda.'],
  some: ['Ada titik api di sekitar Anda', 'Waspada asap. Tutup jendela dan pakai masker bila berasap.'],
  many: ['Banyak titik api di sekitar Anda', 'Waspada asap. Tutup jendela dan pakai masker bila berasap.'],
} as const;

export const VOLCANO_ACT: Record<Level, string> = {
  0: 'Tidak perlu tindakan khusus.',
  1: 'Ikuti arahan resmi dan jauhi radius bahaya.',
  2: 'Jauhi kawasan rawan bencana dan ikuti arahan BPBD. Siapkan masker untuk abu.',
};

/** Teks saat sumber gagal atau kedaluwarsa. Tidak pernah menampilkan angka lama seolah terbaru. */
export const UNAVAILABLE: Record<'gempa' | 'hujan' | 'udara' | 'api' | 'gunung', string> = {
  gempa: 'Data gempa belum tersedia',
  hujan: 'Data hujan belum tersedia',
  udara: 'Data kualitas udara belum tersedia',
  api: 'Data titik api belum tersedia',
  gunung: 'Data gunung api belum tersedia',
};

const tf = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** "12 Nov 15.04 WIB" */
export function wib(t: number): string {
  return `${tf.format(t)} WIB`;
}

export function ago(t: number, now = Date.now()): string {
  const m = Math.round((now - t) / 60_000);
  if (m < 1) return 'baru saja';
  if (m < 60) return `${m} menit lalu`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} jam lalu`;
  return `${Math.round(h / 24)} hari lalu`;
}

export function lastUpdate(t: number | null, now = Date.now()): string {
  return t == null ? 'Belum pernah berhasil dimuat.' : `Pembaruan terakhir ${ago(t, now)} (${wib(t)}).`;
}

/** Angka dengan koma desimal ala Indonesia */
export const num = (v: number, digits = 0) =>
  v.toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits });
