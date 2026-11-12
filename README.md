# SIAGA

Layanan peringatan bencana untuk masyarakat Indonesia. Pengguna memilih satu lokasi, lalu SIAGA menjawab dua pertanyaan: **"saya aman atau tidak?"** dan **"saya harus apa?"**.

Repo ini mengubah prototipe di [`prototype/`](prototype/) menjadi produk yang bisa dipasang di VPS. Brief aslinya ada di [`prototype/SIAGA-BRIEF.md`](prototype/SIAGA-BRIEF.md).

## Isi repo

```
packages/core   Logika murni: assess(), ambang, kalimat, parser tiap sumber. Dipakai server dan web.
apps/server     Fastify API + worker terjadwal + Prisma (PostgreSQL/PostGIS) + Redis
apps/web        Next.js 14, PWA: aplikasi warga (/) dari siaga-app.html dan halaman pantau realtime (/pantau) dari siaga-terminal.html
deploy/         PM2 (ecosystem.config.cjs) dan Nginx
docs/           SUMBER-DATA.md (hasil uji & lisensi), DEPLOY.md (pemasangan VPS)
prototype/      Prototipe asli satu berkas, sebagai acuan
```

## Alur data

```
BMKG, USGS, Open-Meteo, FIRMS, EONET, PetaBencana, MAGMA
        │  (hanya server yang memanggil sumber luar)
        ▼
siaga-worker ── normalkan ──► Redis (data terakhir)  +  PostgreSQL/PostGIS (riwayat)
        │   └── terbitkan kejadian ──► Redis pub/sub "siaga:live"
        │                          │
        │                          ▼
        │                    siaga-api (Fastify)  ◄── /api/... ── Nginx ◄── browser / PWA
        │                          └── /api/stream (SSE) ──────────────► browser: muat ulang sendiri
        ▼
peringatan: nilai tiap lokasi pantauan → kirim hanya saat tingkat naik (web push, Telegram)
```

## Realtime

Setiap kali worker selesai mengambil satu sumber, ia menerbitkan kejadian ke Redis. Setiap proses API
mendengarkan kanal itu dan meneruskannya ke browser lewat Server-Sent Events (`GET /api/stream`):

| Kejadian | Kapan | Yang dilakukan browser |
|---|---|---|
| `feed` | Satu sumber selesai diambil (berhasil atau gagal) | Muat ulang status/peta/ringkasan |
| `quake` | Gempa baru dari BMKG (< 6 jam) | Notifikasi di layar + muat ulang |
| `volcano` | Status resmi gunung berubah | Notifikasi di layar + muat ulang |
| `report` | Laporan warga disetujui moderator | Muat ulang peta |

Jeda dari data baru sampai tampil di layar: sekitar 2 detik. Data tetap mengikuti jadwal sumber
(gempa tiap menit, titik api tiap 30 menit, dst.). Bila sambungan realtime putus, browser
menyambung ulang sendiri dan sementara memuat ulang tiap menit.

## Halaman pantau (`/pantau`)

Dashboard padat data dari `siaga-terminal.html`, untuk pemda, logistik, dan asuransi:
peta dengan 6 layer yang bisa dinyalakan/dimatikan (beserta jumlahnya), citra satelit NASA harian,
angka utama nasional, ringkasan situasi, daftar kejadian "sedang berlangsung" dan "terbaru" dengan
filter, keadaan tiap sumber data, jam WIB, tanda LIVE, dan lokasi pantauan dengan status masing-masing.
Halaman ini belum dibatasi login; datanya sama dengan data publik aplikasi warga.

Citra satelit (VIIRS NOAA-20 lewat NASA GIBS, gratis tanpa kunci) beresolusi sekitar 250 m: asap
dan awan terlihat, rumah tidak. Citra hari ini dipakai setelah 14.00 UTC; sebelum itu citra kemarin,
karena bagian barat Indonesia belum selesai diproses NASA.

Jadwal worker mengikuti brief: gempa 1 menit, laporan PetaBencana 5 menit, hujan 10 menit, udara 15 menit, titik api dan gunung api 30 menit, peringatan 2 menit.

## API

Semua lewat Nginx di bawah `/api` (Nginx membuang awalan itu).

| Endpoint | Isi |
|---|---|
| `GET /status?lat=&lon=&name=` | Tingkat, kalimat, tindakan, rincian per kondisi, kejadian terdekat, keadaan sumber |
| `GET /status/levels?points=lat,lon;lat,lon` | Tingkat ringkas beberapa titik (daftar lokasi pantauan) |
| `GET /map?bbox=&mode=danger\|all&focus=lat,lon` | Penanda peta. `danger` (default) hanya yang berbahaya |
| `GET /sources` | Keadaan tiap sumber dan teks atribusi |
| `GET /overview` | Ringkasan nasional: situasi, angka utama, jumlah per layer, daftar kejadian |
| `GET /stream` | Realtime (Server-Sent Events): `feed`, `quake`, `volcano`, `report` |
| `POST /devices` | Daftarkan perangkat anonim, mengembalikan token |
| `GET/POST /places`, `PATCH/DELETE /places/:id` | Lokasi pantauan (maks 10 per perangkat) |
| `POST /reports` (multipart) | Laporan warga + foto. Tolak duplikat (jenis sama, 200 m, 30 menit), batas per perangkat |
| `GET /reports?near=lat,lon&radius=` | Laporan yang sudah disetujui moderator, 72 jam |
| `GET /reports/mine` | Laporan perangkat ini beserta statusnya |
| `GET /alerts/config`, `GET /alerts`, `POST /alerts/subscribe`, `POST /alerts/unsubscribe` | Peringatan otomatis (web push, Telegram) |
| `POST /telegram/webhook/:secret` | Webhook bot Telegram |
| `GET /admin/reports`, `POST /admin/reports/:id/moderate`, `GET /admin/feeds` | Moderasi dan pemantauan (header `x-admin-token`) |
| `GET /health` | Database dan Redis |

Antrean moderasi punya halaman sendiri di `/moderasi`.

## Aturan produk yang dijaga

- Layar pertama selalu status satu lokasi, bukan peta.
- Kalimat untuk orang awam; angka hanya di rincian setelah baris diketuk.
- Setiap peringatan punya satu tindakan.
- Peta default hanya menampilkan yang berbahaya.
- **Tidak ada data simulasi.** Sumber yang gagal atau kedaluwarsa tampil sebagai "Data … belum tersedia" dengan waktu pembaruan terakhir. Bila tidak ada sumber sama sekali, status tertulis "Belum ada data", bukan "Aman". Batas kedaluwarsa ada di `packages/core/src/feeds.ts`.
- Ambang hujan, udara, gempa, dan titik api sama dengan prototipe (`packages/core/src/thresholds.ts`).
- "Hujan" dihitung dari curah hujan dan diberi catatan "bukan ukuran tinggi air".

## Yang berubah dari prototipe

Perilaku yang sengaja diubah, semuanya ada tesnya:

1. **Satelit titik api diganti.** Suomi NPP berhenti 2 Nov 2026; prototipe akan menampilkan "tidak ada kebakaran" padahal datanya kosong. Sekarang NOAA-20 + NOAA-21.
2. **Gunung api memakai status resmi PVMBG** (Normal/Waspada/Siaga/Awas) dari halaman MAGMA. EONET tidak punya kejadian gunung api sejak Juni 2026.
3. **Gempa: dipilih yang paling berbahaya**, bukan yang terdekat. Prototipe bisa menampilkan Waspada untuk gempa kecil dekat padahal ada M6 dalam 150 km.
4. **Tsunami:** gempa yang menurut BMKG "berpotensi tsunami" dalam 300 km → Bahaya. Properti `tsunami` USGS tidak lagi dibaca sebagai peringatan (memang bukan).
5. **Laporan PetaBencana dibedakan jenisnya.** Prototipe menampilkan kebakaran dan angin sebagai "Laporan banjir".
6. **Laporan warga lewat moderasi** sebelum tampil ke publik. Duplikat menambah hitungan "warga lain melaporkan hal sama" di antrean moderasi.
7. **Foto dikompres ulang di server tanpa metadata**, jadi lokasi GPS di EXIF ikut terhapus.
8. Lokasi pantauan tersimpan di akun perangkat (server). Lokasi lama dari localStorage prototipe dipindahkan otomatis sekali.

**Usulan baru yang perlu ditinjau tim:** ambang gunung api per status resmi (Siaga ≤ 10 km Bahaya, ≤ 30 km Waspada; Awas ≤ 15/40 km; Waspada ≤ 8 km; erupsi ≤ 40 km Waspada) dan ambang tsunami 300 km. Nilainya ada di `thresholds.ts`.

## Menjalankan di komputer sendiri

Butuh Node 22, pnpm 10, PostgreSQL 16 + PostGIS, Redis.

```bash
pnpm install && cp .env.example .env
```

Isi `.env` (untuk lokal: `NODE_ENV=development`, `STORAGE_PUBLIC_BASE_URL=/api/photos`, `STORAGE_LOCAL_DIR` ke folder yang bisa ditulis), lalu:

```bash
pnpm --filter @siaga/core build && pnpm db:migrate
```

Tiga terminal:

```bash
pnpm dev:worker
```

```bash
pnpm dev:api
```

```bash
pnpm dev:web
```

Buka http://localhost:3000. Di jaringan yang memakai proxy keluar, jalankan worker dan API dengan `NODE_USE_ENV_PROXY=1`.

## Tes

```bash
pnpm test
```

Tes integrasi HTTP (butuh PostgreSQL+PostGIS dan Redis; memakai Redis DB 15):

```bash
SIAGA_IT=1 pnpm --filter @siaga/server test
```

Tes parser memakai respons asli tiap sumber yang direkam 12 Nov 2026 (`packages/core/test/fixtures/`).

## Belum dikerjakan

Sesuai urutan di brief:

- **Pencarian alamat sampai kelurahan** (langkah 5). Sekarang: GPS, 45 kota, atau pilih di peta. Rencana: impor gazetir desa/kelurahan Kemendagri/BPS ke PostgreSQL dan cari dengan `pg_trgm`, tanpa bergantung geocoder luar.
- **Dashboard berbayar** (langkah 6): tampilan `/pantau` sudah ada, tetapi belum ada login, paket, grafik riwayat, atau ekspor. Riwayat yang dibutuhkan sudah disimpan: `Earthquake`, `Hotspot`, `WeatherObservation`, `AirObservation`, `CommunityReport`, `VolcanoChange`.
- **Citra resolusi tinggi** (atap rumah terlihat): butuh penyedia berbayar (Esri, Mapbox, MapTiler, atau Google Map Tiles). Citra itu biasanya berumur bulanan sampai tahunan, jadi harus diberi label "bukan kondisi saat ini".
- **WhatsApp.** Pengirim Cloud API sudah ditulis (`services/alerts.ts`), tetapi berlangganan dimatikan sampai ada verifikasi nomor (OTP) dan template pesan yang disetujui Meta.
- **Izin sumber data** untuk pemakaian komersial. Lihat [`docs/SUMBER-DATA.md`](docs/SUMBER-DATA.md).

Pemasangan di VPS: [`docs/DEPLOY.md`](docs/DEPLOY.md).
