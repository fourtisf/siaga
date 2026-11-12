# SIAGA — brief untuk Claude Code

SIAGA adalah layanan peringatan bencana untuk masyarakat Indonesia. Pengguna memilih satu lokasi, lalu SIAGA menjawab dua pertanyaan: "saya aman atau tidak?" dan "saya harus apa?". Tugas Anda: mengubah prototipe di folder ini menjadi produk yang berjalan di produksi.

## File di folder ini

| File | Isi | Peran |
|---|---|---|
| `siaga-app.html` | Aplikasi untuk masyarakat: Status, Peta, Lapor | Acuan utama tampilan dan perilaku. Ini yang dibangun lebih dulu. |
| `siaga-terminal.html` | Terminal padat data: 6 layer, daftar kejadian, ringkasan nasional | Acuan untuk dashboard berbayar (pemda, logistik, asuransi). Tahap berikutnya. |
| `SIAGA-BRIEF.md` | Dokumen ini | |

Kedua HTML adalah prototipe satu file. Leaflet dan garis pantai Indonesia ditanam langsung di dalamnya, jadi bisa dibuka tanpa server. Logika aplikasinya ada di blok `<script>` terakhir.

## Yang sudah jalan di prototipe

- Tiga layar di `siaga-app.html`: Status, Peta, Lapor. Di desktop, kolom kiri berisi Status atau Lapor dan peta selalu tampil di kanan.
- Penilaian satu lokasi (`assess()`): gempa, hujan, kualitas udara, titik api, gunung api. Hasilnya tingkat Aman, Waspada, atau Bahaya, satu kalimat, dan satu tindakan.
- Peta dengan mode "Yang berbahaya" (default) dan "Semua".
- Lapor: pilih jenis, lokasi otomatis dari lokasi pantauan, foto opsional, kirim.
- Pengambilan data langsung dari browser, dengan data simulasi berlabel bila sumber gagal.

## Yang masih simulasi atau belum ada

- **Koneksi data live belum pernah diuji.** Prototipe hanya diuji dengan data simulasi. Uji tiap sumber di bawah sebelum mengandalkannya.
- Laporan warga, lokasi pantauan, dan foto tersimpan di `localStorage` perangkat. Belum ada server.
- Tombol "Peringatan otomatis" hanya menyimpan pilihan. Belum ada pengiriman WhatsApp atau notifikasi.
- Sumber yang menolak akses langsung dari browser dicoba lewat perantara publik `api.allorigins.win`. Ini harus diganti (lihat Arsitektur).
- Daftar kota hanya 45 kota besar. Produksi butuh pencarian alamat sampai kelurahan.
- Status resmi gunung api (Normal sampai Awas) belum ada, karena MAGMA tidak punya API publik.

## Sumber data

| Data | Sumber | Endpoint yang dipakai prototipe | Catatan |
|---|---|---|---|
| Gempa | BMKG | `https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json` dan `gempadirasakan.json` | Wajib mencantumkan BMKG sebagai sumber. |
| Gempa (cadangan) | USGS | `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&...` | Dipakai bila BMKG gagal. |
| Hujan | Open-Meteo | `https://api.open-meteo.com/v1/forecast` (`hourly=precipitation`, `past_hours=24`, `forecast_hours=24`) | Gratis untuk non-komersial. Periksa lisensi komersial. |
| Kualitas udara | Open-Meteo (CAMS) | `https://air-quality-api.open-meteo.com/v1/air-quality` (`current=us_aqi,pm2_5`) | Data model, bukan sensor. |
| Titik api | NASA FIRMS | `https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/VIIRS_SNPP_NRT/94,-12,142,7/1` | Butuh MAP_KEY gratis. Jeda sekitar 3 jam. |
| Gunung api | NASA EONET | `https://eonet.gsfc.nasa.gov/api/v3/events?category=volcanoes&bbox=...` | Hanya aktivitas terpantau satelit. |
| Laporan banjir | PetaBencana.id | `https://data.petabencana.id/reports?timeperiod=259200&geoformat=geojson` | Cakupan terbaik di Jabodetabek. Periksa apakah endpoint masih aktif. |

Semua endpoint di atas ditulis dari ingatan saat membuat prototipe dan belum diverifikasi. Periksa dokumentasi resmi tiap sumber, termasuk syarat pemakaian komersial.

## Arsitektur yang diminta

Pakai stack produksi yang sudah dipakai tim: Next.js 14, Fastify, Prisma, PostgreSQL, Redis, di VPS dengan PM2 dan Nginx.

1. **Pengumpul data di server.** Worker terjadwal menarik tiap sumber, menormalkan hasilnya, dan menyimpannya. Browser tidak lagi memanggil sumber luar, sehingga perantara publik dan masalah CORS hilang.
   - Jadwal: gempa tiap 1 menit, laporan banjir 5 menit, hujan 10 menit, udara 15 menit, titik api dan gunung api 30 menit.
   - Simpan hasil terakhir di Redis, riwayat di PostgreSQL (pakai PostGIS untuk pencarian radius).
2. **API sendiri.**
   - `GET /status?lat=&lon=` mengembalikan tingkat, kalimat, tindakan, dan rincian untuk satu titik. Pindahkan logika `assess()` ke sini.
   - `GET /map?bbox=&mode=danger|all` mengembalikan penanda peta.
   - `POST /reports` dan `GET /reports?near=` untuk laporan warga.
   - `POST /places` dan `POST /alerts/subscribe` untuk lokasi pantauan dan peringatan.
3. **Peringatan.** Worker membandingkan status tiap lokasi pantauan dengan status sebelumnya dan mengirim pesan hanya saat tingkatnya naik. Mulai dari Telegram bot atau web push, lalu WhatsApp Business API.
4. **Laporan warga.** Foto disimpan di object storage. Sebelum tampil ke publik: tolak duplikat (jenis sama, radius 200 m, 30 menit), batasi jumlah laporan per perangkat, dan sediakan antrean moderasi.
5. **Frontend.** Next.js, mobile-first, bisa dipasang sebagai PWA. Pertahankan tampilan `siaga-app.html`.

## Aturan produk yang harus dipertahankan

- Layar pertama selalu status satu lokasi, bukan peta.
- Kalimat untuk orang awam. Angka (mm, AQI, MW) hanya muncul setelah baris diketuk.
- Setiap peringatan punya satu tindakan yang bisa dilakukan.
- Peta default hanya menampilkan yang berbahaya.
- Data simulasi atau data yang gagal dimuat tidak boleh tampil seolah nyata. Di produksi, tampilkan "data belum tersedia" dan waktu pembaruan terakhir, bukan angka simulasi.
- Ambang tingkat bahaya di prototipe:
  - Hujan (ambang harian BMKG): 50 mm ke atas Waspada, 100 mm ke atas Bahaya.
  - Udara (AQI): di atas 100 Waspada, di atas 200 Bahaya.
  - Gempa 24 jam terakhir: dalam 100 km, atau M 5+ dalam 300 km, Waspada; M 5,5+ dalam 150 km Bahaya.
  - Titik api dalam radius 50 km: ada Waspada, lebih dari 10 Bahaya.
- "Potensi banjir" saat ini dihitung dari curah hujan, bukan tinggi air. Jangan menyebutnya data banjir sampai ada sensor atau laporan terverifikasi.

## Desain

- Warna dasar: laut `#06161f`, panel `#0a1e28`, baris `#102a36`, teks `#edf3f1`, tombol utama putih kertas `#f1f5f2`.
- Warna hanya untuk bahaya: gempa `#ff7a9c`, hujan `#5cc8ff`, api `#ff6a3d`, gunung `#ffa36b`, laporan warga `#b7a6ff`, aman `#6fe0a8`, waspada `#ffb86b`, bahaya `#ff6b6b`.
- Huruf: Plus Jakarta Sans untuk antarmuka, Barlow Condensed untuk angka dan kata status.
- Jangan pakai tema terang, dan jangan pakai kombinasi hitam-emas.

## Urutan kerja yang disarankan

1. Uji semua sumber data dari server, catat mana yang hidup dan apa syarat lisensinya.
2. Bangun pengumpul data dan `GET /status`, lalu sambungkan `siaga-app.html` ke API itu.
3. Laporan warga dengan server dan foto.
4. Lokasi pantauan tersimpan di akun, lalu peringatan otomatis.
5. Pencarian alamat sampai kelurahan.
6. Dashboard dari `siaga-terminal.html`.
