import type { LatLon } from './types.js';

export interface VolcanoRef extends LatLon {
  code: string;
  name: string;
  region: string;
}

/**
 * Daftar gunung api yang dipantau PVMBG beserta koordinatnya, diambil dari halaman
 * MAGMA Indonesia pada 12 Nov 2026. Hanya data rujukan (nama dan posisi), bukan status.
 * Dipakai untuk mencocokkan aktivitas satelit (EONET) dan mencari gunung terdekat
 * saat sumber status sedang tidak tersedia.
 */
export const VOLCANOES: VolcanoRef[] = (
  [
  ['AGU', "Agung", -8.342, 115.508, "Bali"],
  ['AMB', "Ambang", 0.75, 124.42, "Sulawesi Utara"],
  ['KRA', "Anak Krakatau", -6.102, 105.423, "Lampung"],
  ['RAN', "Anak Ranakah", -8.62, 120.52, "Nusa Tenggara Timur"],
  ['WEL', "Arjuno Welirang", -7.725, 112.58, "Jawa Timur"],
  ['AWU', "Awu", 3.682846, 125.45598, "Sulawesi Utara"],
  ['BAN', "Banda Api", -4.523, 129.881, "Maluku"],
  ['BAT', "Batur", -8.242, 115.375, "Bali"],
  ['TAR', "Batutara", -7.792, 123.579, "Nusa Tenggara Timur"],
  ['BRO', "Bromo", -7.942, 112.95, "Jawa Timur"],
  ['TEL', "Bur Ni Telong", 4.769, 96.821, "Aceh"],
  ['CER', "Ciremai", -6.892, 108.4, "Jawa Barat"],
  ['COL', "Colo", -0.162, 121.601, "Sulawesi Tengah"],
  ['DEM', "Dempo", -4.03, 103.13, "Sumatera Selatan"],
  ['DIE', "Dieng", -7.2, 109.92, "Jawa Tengah"],
  ['DUK', "Dukono", 1.693, 127.894, "Maluku Utara"],
  ['EBU', "Ebulobo", -8.82, 121.18, "Nusa Tenggara Timur"],
  ['EGO', "Egon", -8.676, 122.455, "Nusa Tenggara Timur"],
  ['GAL', "Galunggung", -7.25, 108.058, "Jawa Barat"],
  ['GML', "Gamalama", 0.8, 127.33, "Maluku Utara"],
  ['GMK', "Gamkonora", 1.38, 127.53, "Maluku Utara"],
  ['GED', "Gede", -6.77, 106.965, "Jawa Barat"],
  ['GUN', "Guntur", -7.143, 107.84, "Jawa Barat"],
  ['HOB', "Hobal", -8.5444, 123.585, "Nusa Tenggara Timur"],
  ['IBU', "Ibu", 1.488, 127.63, "Maluku Utara"],
  ['IJE', "Ijen", -8.058, 114.242, "Jawa Timur"],
  ['WER', "Ile Werung", -8.53, 123.57, "Nusa Tenggara Timur"],
  ['BOL', "Ili Boleng", -8.342, 123.258, "Nusa Tenggara Timur"],
  ['LEW', "Ili Lewotolok", -8.272, 123.505, "Nusa Tenggara Timur"],
  ['LIK', "Inielika", -8.73, 120.98, "Nusa Tenggara Timur"],
  ['RIE', "Inierie", -8.875, 120.95, "Nusa Tenggara Timur"],
  ['IYA', "Iya", -8.897, 121.645, "Nusa Tenggara Timur"],
  ['KAB', "Kaba", -3.52, 102.62, "Bengkulu"],
  ['KAR', "Karangetang", 2.78, 125.406, "Sulawesi Utara"],
  ['KLM', "Kelimutu", -8.77, 121.82, "Nusa Tenggara Timur"],
  ['KLD', "Kelud", -7.93, 112.308, "Jawa Timur"],
  ['KER', "Kerinci", -1.697, 101.264, "Jambi, Sumatera Barat"],
  ['KIE', "Kie Besi", 0.32, 127.4, "Maluku Utara"],
  ['LAM', "Lamongan", -7.979, 113.342, "Jawa Timur"],
  ['LER', "Lereboleng", -8.365, 122.833, "Nusa Tenggara Timur"],
  ['LWK', "Lewotobi Laki-laki", -8.5389, 122.7682, "Nusa Tenggara Timur"],
  ['LWP', "Lewotobi Perempuan", -8.5539, 122.7805, "Nusa Tenggara Timur"],
  ['LOK', "Lokon", 1.358, 124.792, "Sulawesi Utara"],
  ['MAH', "Mahawu", 1.352, 124.865, "Sulawesi Utara"],
  ['MAR', "Marapi", -0.381, 100.473, "Sumatera Barat"],
  ['MER', "Merapi", -7.542, 110.442, "Daerah Istimewa Yogyakarta dan Jawa Tengah"],
  ['PAP', "Papandayan", -7.32, 107.73, "Jawa Barat"],
  ['PEU', "Peut Sague", 4.914, 96.329, "Daerah Istimewa Aceh"],
  ['RAU', "Raung", -8.125, 114.042, "Jawa Timur"],
  ['RIN', "Rinjani", -8.42, 116.47, "Nusa Tenggara Barat"],
  ['ROK', "Rokatenda", -8.32, 121.708, "Nusa Tenggara Timur"],
  ['RUA', "Ruang", 2.3031, 125.3667, "Sulawesi Utara"],
  ['SAL', "Salak", -6.72, 106.73, "Jawa Barat"],
  ['SAN', "Sangeangapi", -8.2, 119.07, "Nusa Tenggara Barat"],
  ['SMR', "Semeru", -8.108, 112.92, "Jawa Timur"],
  ['SEU', "Seulawah Agam", 5.448, 95.658, "Daerah Istimewa Aceh"],
  ['SIN', "Sinabung", 3.17, 98.392, "Sumatera Utara"],
  ['SIR', "Sirung", -8.508, 124.13, "Nusa Tenggara Timur"],
  ['SLA', "Slamet", -7.242, 109.208, "Jawa Tengah"],
  ['SOP', "Soputan", 1.1145, 124.737, "Sulawesi Utara"],
  ['SOR', "Sorikmarapi", 0.686, 99.537, "Sumatera Utara"],
  ['SBG', "Sumbing", -7.384, 110.07, "Jawa Tengah"],
  ['SUN', "Sundoro", -7.3, 109.992, "Jawa Tengah"],
  ['TAL', "Talang", -0.978, 100.679, "Sumatera Barat"],
  ['TAM', "Tambora", -8.25, 118, "Nusa Tenggara Barat"],
  ['TAN', "Tandikat", -0.39, 100.331, "Sumatera Barat"],
  ['TGK', "Tangkoko", 1.518, 125.185, "Sulawesi Utara"],
  ['TPR', "Tangkuban Parahu", -6.77, 107.6, "Jawa Barat"],
  ['WUR', "Wurlali", -7.125, 128.675, "Maluku"],
  ] as const
).map(([code, name, lat, lon, region]) => ({ code, name, lat, lon, region }));
