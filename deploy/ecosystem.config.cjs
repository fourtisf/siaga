/**
 * PM2: tiga proses SIAGA. Jalankan dari akar repo setelah `pnpm build`:
 *   pm2 start deploy/ecosystem.config.cjs && pm2 save
 * Konfigurasi dibaca dari .env di akar repo (lihat .env.example).
 */
const path = require('node:path');
const root = path.resolve(__dirname, '..');

module.exports = {
  apps: [
    {
      name: 'siaga-api',
      cwd: path.join(root, 'apps/server'),
      script: 'dist/api.js',
      // Satu proses cukup untuk awal (I/O-bound). Untuk menambah, jalankan beberapa
      // instans di port berbeda (API_PORT) dan daftarkan semuanya di upstream Nginx.
      instances: 1,
      exec_mode: 'fork',
      // NODE_USE_ENV_PROXY: fetch Node mengikuti HTTPS_PROXY bila ada (Node >= 22.21). Tanpa proxy: tidak berpengaruh.
      env: { NODE_ENV: 'production', NODE_USE_ENV_PROXY: '1' },
      max_memory_restart: '500M',
      kill_timeout: 8000,
      time: true,
    },
    {
      name: 'siaga-worker',
      cwd: path.join(root, 'apps/server'),
      script: 'dist/worker.js',
      // Aman lebih dari satu (tugas dijaga kunci Redis), tetapi satu sudah cukup.
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production', NODE_USE_ENV_PROXY: '1' },
      max_memory_restart: '500M',
      kill_timeout: 8000,
      time: true,
    },
    {
      name: 'siaga-web',
      cwd: path.join(root, 'apps/web'),
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000 -H 127.0.0.1',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' },
      max_memory_restart: '600M',
      time: true,
    },
  ],
};
