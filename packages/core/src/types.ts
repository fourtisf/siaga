/** 0 = Aman, 1 = Waspada, 2 = Bahaya */
export type Level = 0 | 1 | 2;

/** Kunci sumber data. Satu kunci = satu jadwal pengumpulan di worker. */
export type FeedKey = 'gempa' | 'banjir' | 'cuaca' | 'udara' | 'api' | 'gunung';

export interface LatLon {
  lat: number;
  lon: number;
}

/** Keadaan satu sumber data seperti dilihat API. */
export interface FeedStatus {
  key: FeedKey;
  /** Ada data yang cukup baru untuk dipakai. Bila false, tampilkan "data belum tersedia". */
  available: boolean;
  /** Waktu terakhir pengambilan berhasil (epoch ms), null bila belum pernah. */
  lastSuccessAt: number | null;
  lastAttemptAt: number | null;
  /** Nama sumber yang menghasilkan data terakhir, misalnya "BMKG" atau "USGS". */
  source: string | null;
  error?: string | null;
  count?: number;
}

export interface Quake extends LatLon {
  id: string;
  /** Waktu kejadian, epoch ms */
  t: number;
  m: number;
  depthKm: number;
  place: string;
  /** Teks "Dirasakan" dari BMKG (skala MMI per wilayah) */
  felt?: string;
  /** Teks "Potensi" dari BMKG */
  potential?: string;
  /** BMKG menyatakan gempa ini berpotensi tsunami */
  tsunami: boolean;
  src: 'BMKG' | 'USGS';
}

export interface Weather extends LatLon {
  /** mm/jam saat ini */
  now: number;
  temp: number;
  wind: number;
  past24: number;
  next24: number;
  /** waktu data model (epoch ms) */
  at: number;
  /** waktu SIAGA mengambil data ini (epoch ms) */
  fetchedAt: number;
}

export interface Air extends LatLon {
  aqi: number;
  pm25: number | null;
  pm10: number | null;
  at: number;
  fetchedAt: number;
}

export interface Hotspot extends LatLon {
  /** Fire radiative power, MW */
  frp: number;
  /** 'l' | 'n' | 'h' (VIIRS) atau 0-100 (MODIS) dinormalkan ke l/n/h */
  conf: 'l' | 'n' | 'h';
  t: number;
  sat: string;
}

/** Tingkat aktivitas resmi PVMBG: 1 Normal, 2 Waspada, 3 Siaga, 4 Awas */
export type VolcanoAlert = 1 | 2 | 3 | 4;

export interface Volcano extends LatLon {
  code: string;
  name: string;
  /** Status resmi MAGMA. null bila hanya diketahui dari satelit. */
  alert: VolcanoAlert | null;
  /** MAGMA menandai erupsi/VONA terbaru */
  erupting: boolean;
  /** Aktivitas terpantau satelit (EONET) */
  satellite: boolean;
  region?: string;
  src: 'MAGMA' | 'EONET';
}

export type CommunityHazard = 'banjir' | 'kebakaran' | 'gempa' | 'angin' | 'gunung' | 'asap' | 'lainnya';

/** Laporan dari platform pihak ketiga (PetaBencana.id) */
export interface CommunityReport extends LatLon {
  id: string;
  hazard: CommunityHazard;
  t: number;
  text: string;
  /** cm, hanya untuk banjir */
  depthCm?: number;
  imageUrl?: string;
  city?: string;
  src: 'PetaBencana.id';
}

export const REPORT_KINDS = ['Banjir', 'Kebakaran', 'Pohon tumbang', 'Jalan rusak', 'Mati listrik', 'Kecelakaan'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

/** Laporan warga yang sudah lolos moderasi (atau milik perangkat sendiri) */
export interface CitizenReport extends LatLon {
  id: string;
  kind: ReportKind;
  text: string;
  t: number;
  photoUrl?: string | null;
  status?: 'pending' | 'approved' | 'rejected' | 'duplicate';
}

export type ConditionKind = 'gempa' | 'hujan' | 'udara' | 'api' | 'gunung';

/** Satu baris penilaian di layar Status. */
export interface Condition {
  kind: ConditionKind;
  /** null = data belum tersedia */
  level: Level | null;
  /** Kalimat utama untuk orang awam */
  head: string;
  /** Satu tindakan yang bisa dilakukan */
  act: string;
  /** Angka rinci; hanya tampil setelah baris diketuk */
  rows: [string, string][];
  available: boolean;
  /** Waktu pembaruan terakhir sumber (epoch ms) */
  updatedAt: number | null;
  source: string | null;
  /** Catatan kecil di bawah rincian, misalnya batasan data */
  note?: string;
  /** Titik di peta yang relevan, untuk tombol "lihat di peta" */
  focus?: LatLon & { zoom: number };
}

export interface NearbyEvent extends LatLon {
  type: 'warga' | 'komunitas' | 'gempa';
  title: string;
  km: number;
  t: number;
  zoom: number;
  ref: string;
}

export interface Assessment {
  /** null bila tidak ada satu pun sumber yang tersedia */
  level: Level | null;
  label: 'Aman' | 'Waspada' | 'Bahaya' | 'Belum ada data';
  /** Kalimat ringkas di bawah kata status */
  sentence: string;
  /** Tindakan utama (dari kondisi terburuk) */
  action: string;
  conditions: Condition[];
  /** Sumber yang tidak tersedia saat ini */
  missing: FeedKey[];
}
