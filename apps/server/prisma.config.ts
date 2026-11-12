import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

// Muat .env dari akar repo (atau DOTENV_PATH) bila ada. Di produksi, PM2 boleh menyuntikkan env langsung.
for (const p of [process.env.DOTENV_PATH, resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
  if (p && existsSync(p)) {
    process.loadEnvFile(p);
    break;
  }
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
