# Memasang SIAGA di VPS

Stack: Node.js 22, PostgreSQL 16 + PostGIS 3, Redis 7, Nginx, PM2. Diuji di Ubuntu 24.04.
Perkiraan awal: 2 vCPU, 4 GB RAM, 40 GB disk sudah cukup.

## 1. Paket sistem

```bash
sudo apt update && sudo apt install -y postgresql-16 postgresql-16-postgis-3 redis-server nginx certbot python3-certbot-nginx
```

Node.js 22 (minimal 22.21, untuk `NODE_USE_ENV_PROXY`), pnpm, dan PM2:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
```

```bash
sudo npm i -g pnpm@10 pm2@6
```

## 2. Database

```bash
sudo -u postgres psql -c "CREATE ROLE siaga LOGIN PASSWORD 'GANTI_PASSWORD';"
```

```bash
sudo -u postgres psql -c "CREATE DATABASE siaga OWNER siaga;"
```

PostGIS harus dibuat oleh superuser, sebelum migrasi:

```bash
sudo -u postgres psql -d siaga -c "CREATE EXTENSION IF NOT EXISTS postgis;"
```

## 3. Kode dan konfigurasi

```bash
sudo mkdir -p /srv/siaga /var/lib/siaga/photos && sudo chown -R $USER /srv/siaga /var/lib/siaga
```

```bash
git clone <repo> /srv/siaga && cd /srv/siaga && cp .env.example .env
```

Isi `.env`. Yang wajib: `DATABASE_URL`, `IP_HASH_SALT`, `ADMIN_TOKEN`, `PUBLIC_APP_URL`, `STORAGE_PUBLIC_BASE_URL`.
String acak bisa dibuat dengan:

```bash
openssl rand -base64 32
```

Kunci web push (salin ke `VAPID_PUBLIC_KEY` dan `VAPID_PRIVATE_KEY`):

```bash
pnpm install && pnpm --filter @siaga/server vapid
```

## 4. Build dan migrasi

```bash
pnpm install --frozen-lockfile && pnpm build
```

```bash
pnpm db:deploy
```

Uji semua sumber data dari VPS ini sebelum menyalakan worker:

```bash
pnpm probe
```

## 5. Jalankan dengan PM2

```bash
pm2 start deploy/ecosystem.config.cjs && pm2 save && pm2 startup
```

Tiga proses: `siaga-api` (Fastify, 127.0.0.1:4000), `siaga-worker` (pengumpul + peringatan), `siaga-web` (Next.js, 127.0.0.1:3000).

## 6. Nginx dan HTTPS

```bash
sudo cp deploy/nginx/siaga.conf /etc/nginx/sites-available/siaga.conf && sudo ln -s ../sites-available/siaga.conf /etc/nginx/sites-enabled/siaga.conf
```

Ganti `siaga.example.id` di berkas itu. Untuk sertifikat pertama, sementara komentari blok `server` port 443, lalu:

```bash
sudo certbot certonly --nginx -d siaga.example.id
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 7. Telegram (opsional)

Buat bot di @BotFather, isi `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, dan `TELEGRAM_WEBHOOK_SECRET` (string acak), lalu daftarkan webhook:

```bash
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook?url=https://siaga.example.id/api/telegram/webhook/$TELEGRAM_WEBHOOK_SECRET"
```

## Pembaruan

```bash
cd /srv/siaga && git pull && pnpm install --frozen-lockfile && pnpm build && pnpm db:deploy && pm2 reload deploy/ecosystem.config.cjs
```

## Pemantauan

- `GET /api/health`: database dan Redis.
- `GET /api/sources`: keadaan tiap sumber (tersedia, waktu berhasil terakhir, galat terakhir).
- `GET /api/admin/feeds` (header `x-admin-token`): 100 pengambilan terakhir dari tabel `FeedRun`.
- `pm2 logs siaga-worker`: setiap tugas mencatat `selesai`/`gagal` dalam JSON.

Pasang pemantau dari luar (UptimeRobot, Better Stack, dsb.) ke `/api/health`, dan beri tanda bila `/api/sources` menunjukkan `gempa` tidak tersedia lebih dari 10 menit.

## Cadangan

```bash
pg_dump -Fc siaga > /var/backups/siaga-$(date +%F).dump
```

Jadwalkan harian lewat cron, simpan salinannya di luar VPS. Foto ada di `/var/lib/siaga/photos` (atau di object storage bila `STORAGE_DRIVER=s3`).

## Object storage untuk foto

Untuk lebih dari satu server, pakai S3-compatible (Cloudflare R2, MinIO, penyedia lokal):
`STORAGE_DRIVER=s3`, isi `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, dan `STORAGE_PUBLIC_BASE_URL` (URL publik bucket atau CDN).
