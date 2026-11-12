# Sumber data SIAGA: hasil uji dan syarat pemakaian

Langkah 1 dari brief. Semua sumber diuji **dari server** (bukan browser) pada 12 Nov 2026 sekitar 15.30 WIB.
Uji ulang kapan saja di VPS dengan:

```bash
pnpm probe
```

Skrip itu (`apps/server/src/probe.ts`) memakai fungsi pengambil dan parser yang sama dengan worker, jadi hasilnya mencerminkan apa yang akan dilihat produksi.

## Hasil uji

| Sumber | Hasil | Isi saat diuji | Catatan |
|---|---|---|---|
| BMKG `gempaterkini.json`, `gempadirasakan.json`, `autogempa.json` | Hidup | 27 gempa unik | Format sama dengan prototipe. `Potensi` dipakai untuk mendeteksi "berpotensi tsunami". |
| USGS FDSN (cadangan) | Hidup | 21 gempa M4+ 48 jam | Hanya dipakai bila BMKG gagal. |
| Open-Meteo forecast | Hidup | Jakarta: 0,5 mm 24 jam lalu, 4,6 mm 24 jam ke depan | Multi-lokasi dalam satu permintaan berfungsi. |
| Open-Meteo air quality (CAMS) | Hidup | Jakarta AQI 151 | Data model, bukan sensor. |
| FIRMS VIIRS **Suomi NPP** (dipakai prototipe) | **Kosong** | 0 baris | **Suomi NPP berhenti mengirim data FIRMS sejak 2 Nov 2026.** Prototipe akan diam-diam menampilkan "tidak ada kebakaran". |
| FIRMS VIIRS NOAA-20 (berkas terbuka Asia Tenggara 24 jam) | Hidup | 3.201 baris, 2.014 di Indonesia | Dipakai sebagai pengganti. |
| FIRMS VIIRS NOAA-21 (berkas terbuka) | Hidup | 2.807 baris, 2.152 di Indonesia | Dipakai sebagai pengganti. |
| FIRMS API area dengan MAP_KEY | Belum diuji | | Butuh kunci. Tanpa kunci: `Invalid MAP_KEY.` (HTTP 400). |
| NASA EONET gunung api | **Kosong** | 0 kejadian di Indonesia | Kejadian gunung api terbaru di seluruh dunia bertanggal 15 Jun 2026. Kategori ini praktis tidak diperbarui. |
| PetaBencana.id `/reports` 72 jam | Hidup | 16 laporan: kebakaran 8, banjir 4, angin 3, gunung 1 | **Isinya bukan hanya banjir.** Prototipe menampilkan semuanya sebagai "Laporan banjir". |
| MAGMA Indonesia (halaman depan) | Hidup | 69 gunung: Normal 42, Waspada 24, Siaga 3, Awas 0; erupsi/VONA 4 | Tidak ada API publik, tetapi halaman depan menanam JSON `markersGunungApi` berisi **status resmi** tiap gunung. |

## Keputusan yang diambil di kode

- **Titik api:** pindah dari Suomi NPP ke NOAA-20 + NOAA-21. Bila *semua* berkas kosong, pengumpulan dianggap gagal (UI menampilkan "data belum tersedia"), bukan "tidak ada api". Deteksi dengan confidence rendah tidak dihitung dalam penilaian.
- **Gunung api:** status resmi dibaca dari HTML MAGMA (sumber utama), EONET hanya menambah tanda "aktivitas satelit". Bila MAGMA aktif tetapi gagal, sumber gunung dianggap tidak tersedia. Membaca HTML itu rapuh: parser melempar galat yang jelas bila struktur halaman berubah, dan tes memakai salinan halaman asli.
- **PetaBencana.id:** jenis bencana dibedakan (banjir, kebakaran, angin, gempa, gunung, asap).
- **Tsunami:** USGS punya properti `tsunami`, tetapi menurut dokumentasi USGS itu **bukan** peringatan. Prototipe menampilkannya sebagai "Peringatan tsunami diterbitkan". Sekarang status tsunami hanya diambil dari teks `Potensi` BMKG.
- **Open-Meteo:** dengan `OPEN_METEO_API_KEY`, permintaan otomatis pindah ke `customer-api.open-meteo.com` dan `customer-air-quality-api.open-meteo.com`.
- **User-Agent:** semua permintaan memakai `SOURCE_USER_AGENT` (PetaBencana meminta User-Agent yang jelas).
- Setiap sumber bisa dimatikan lewat env (`SOURCE_BMKG=0`, dst.) bila izinnya belum ada.

## Syarat pemakaian (ringkasan riset, 12 Nov 2026)

Riset diambil dari kutipan halaman resmi lewat pencarian web; teks lengkapnya belum dibaca baris per baris. **Periksa ulang sebelum peluncuran komersial.**

| Sumber | Komersial | Atribusi | Batas | Kunci |
|---|---|---|---|---|
| BMKG | **Perlu izin tertulis BMKG** untuk aplikasi pihak ketiga dan pemakaian komersial; kerja sama data lewat PNBP di ptsp.bmkg.go.id ([ketentuan](https://www.bmkg.go.id/ketentuan-penggunaan)) | "Sumber: BMKG", wajib tampil di aplikasi | 60 permintaan/menit/IP. SIAGA memakai 3/menit. | Tidak |
| USGS | Boleh (domain publik AS) | "U.S. Geological Survey" | Tidak dipublikasikan, HTTP 429 bila berlebihan | Tidak |
| Open-Meteo | **Perlu paket berbayar.** API gratis hanya non-komersial, < 10.000 panggilan/hari ([terms](https://open-meteo.com/en/terms), [pricing](https://open-meteo.com/en/pricing)) | CC BY 4.0; CAMS: "Generated using Copernicus Atmosphere Monitoring Service information" | Gratis: 600/menit, 5.000/jam, 10.000/hari | Berbayar: `apikey` |
| NASA FIRMS | Boleh (kebijakan data terbuka NASA) | Sebut NASA FIRMS | 5.000 transaksi/10 menit per MAP_KEY | MAP_KEY gratis untuk API area |
| NASA EONET | Boleh (kebijakan NASA, belum dipastikan khusus EONET) | NASA EONET | | Tidak |
| PetaBencana.id | **Perlu lisensi komersial** dari Yayasan Peta Bencana; non-komersial CC BY-NC 4.0 ([EULA](https://docs.petabencana.id/master-1/end-user-license-agreement)) | "Data provided by PetaBencana.id" | Ada, angka tidak dipublikasikan | Tidak (kecuali arsip) |
| MAGMA (PVMBG) | **Tidak jelas.** Tidak ada API publik atau syarat pemakaian; API resmi hanya untuk BNPB/BPBD | Badan Geologi / PVMBG | | |
| Peta dasar CARTO (frontend) | Gratis terbatas; komersial butuh lisensi CARTO | © OpenStreetMap © CARTO | | |

### Perkiraan pemakaian Open-Meteo

Worker memperbarui semua sel aktif: 45 kota + lokasi pantauan + sel yang diminta dalam 24 jam terakhir.
Dengan 45 sel saja: hujan tiap 10 menit (144 × 45 = 6.480) + udara tiap 15 menit (96 × 45 = 4.320) = **sekitar 10.800 panggilan/hari**, sudah melewati batas gratis.
Setiap lokasi dalam permintaan multi-lokasi kemungkinan dihitung terpisah (belum dipastikan dari halaman resmi). Produksi butuh paket berbayar; pilih tingkatnya dari jumlah sel aktif setelah beta.

## Yang harus diurus sebelum peluncuran komersial

1. **BMKG:** ajukan izin tertulis (dan kerja sama PNBP bila perlu) untuk memakai data gempa di aplikasi.
2. **Open-Meteo:** ambil paket berbayar, isi `OPEN_METEO_API_KEY`.
3. **PetaBencana.id:** minta lisensi komersial, atau set `SOURCE_PETABENCANA=0`.
4. **MAGMA / Badan Geologi:** minta izin atau akses API resmi. Sampai ada jawaban, putuskan apakah membaca halaman depan boleh dilanjutkan (`SOURCE_MAGMA=0` untuk mematikan).
5. **FIRMS:** daftarkan MAP_KEY (gratis) supaya permintaan hanya untuk wilayah Indonesia.
6. **CARTO:** lisensi peta dasar, atau ganti ke penyedia ubin lain.
