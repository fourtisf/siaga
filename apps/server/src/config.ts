import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

// .env dicari di DOTENV_PATH, folder kerja, lalu akar monorepo. Env dari PM2/sistem tetap menang.
for (const p of [process.env.DOTENV_PATH, resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
  if (p && existsSync(p)) {
    const before = { ...process.env };
    process.loadEnvFile(p);
    Object.assign(process.env, before);
    break;
  }
}

const flag = z
  .string()
  .optional()
  .transform((v) => v !== '0' && v?.toLowerCase() !== 'false');
const optStr = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const Env = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379/0'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().default(4000),
  CORS_ORIGINS: optStr,
  PUBLIC_APP_URL: z.string().default('http://localhost:3000'),
  IP_HASH_SALT: z.string().min(8),
  ADMIN_TOKEN: z.string().min(12),

  FIRMS_MAP_KEY: optStr,
  OPEN_METEO_API_KEY: optStr,
  SOURCE_BMKG: flag,
  SOURCE_USGS: flag,
  SOURCE_OPEN_METEO: flag,
  SOURCE_FIRMS: flag,
  SOURCE_EONET: flag,
  SOURCE_PETABENCANA: flag,
  SOURCE_MAGMA: flag,
  SOURCE_USER_AGENT: z.string().default('SIAGA/0.1'),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./var/photos'),
  STORAGE_PUBLIC_BASE_URL: z.string().default('/api/photos'),
  S3_ENDPOINT: optStr,
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: optStr,
  S3_ACCESS_KEY_ID: optStr,
  S3_SECRET_ACCESS_KEY: optStr,

  VAPID_PUBLIC_KEY: optStr,
  VAPID_PRIVATE_KEY: optStr,
  VAPID_SUBJECT: z.string().default('mailto:admin@example.com'),
  TELEGRAM_BOT_TOKEN: optStr,
  TELEGRAM_BOT_USERNAME: optStr,
  TELEGRAM_WEBHOOK_SECRET: optStr,
  WHATSAPP_TOKEN: optStr,
  WHATSAPP_PHONE_NUMBER_ID: optStr,
  WHATSAPP_TEMPLATE: z.string().default('siaga_peringatan'),
  WHATSAPP_TEMPLATE_LANG: z.string().default('id'),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error('Konfigurasi tidak valid:', z.prettifyError(parsed.error));
  process.exit(1);
}
const e = parsed.data;

export const config = {
  env: e.NODE_ENV,
  isProd: e.NODE_ENV === 'production',
  databaseUrl: e.DATABASE_URL,
  redisUrl: e.REDIS_URL,
  api: {
    host: e.API_HOST,
    port: e.API_PORT,
    corsOrigins: e.CORS_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean) ?? [],
  },
  publicAppUrl: e.PUBLIC_APP_URL.replace(/\/$/, ''),
  ipHashSalt: e.IP_HASH_SALT,
  adminToken: e.ADMIN_TOKEN,
  sources: {
    userAgent: e.SOURCE_USER_AGENT,
    bmkg: e.SOURCE_BMKG,
    usgs: e.SOURCE_USGS,
    openMeteo: e.SOURCE_OPEN_METEO,
    openMeteoKey: e.OPEN_METEO_API_KEY,
    firms: e.SOURCE_FIRMS,
    firmsKey: e.FIRMS_MAP_KEY,
    eonet: e.SOURCE_EONET,
    petabencana: e.SOURCE_PETABENCANA,
    magma: e.SOURCE_MAGMA,
  },
  storage: {
    driver: e.STORAGE_DRIVER,
    localDir: resolve(e.STORAGE_LOCAL_DIR),
    publicBaseUrl: e.STORAGE_PUBLIC_BASE_URL.replace(/\/$/, ''),
    s3: {
      endpoint: e.S3_ENDPOINT,
      region: e.S3_REGION,
      bucket: e.S3_BUCKET,
      accessKeyId: e.S3_ACCESS_KEY_ID,
      secretAccessKey: e.S3_SECRET_ACCESS_KEY,
    },
  },
  push: {
    vapidPublic: e.VAPID_PUBLIC_KEY,
    vapidPrivate: e.VAPID_PRIVATE_KEY,
    vapidSubject: e.VAPID_SUBJECT,
  },
  telegram: {
    token: e.TELEGRAM_BOT_TOKEN,
    username: e.TELEGRAM_BOT_USERNAME,
    webhookSecret: e.TELEGRAM_WEBHOOK_SECRET,
  },
  whatsapp: {
    token: e.WHATSAPP_TOKEN,
    phoneNumberId: e.WHATSAPP_PHONE_NUMBER_ID,
    template: e.WHATSAPP_TEMPLATE,
    lang: e.WHATSAPP_TEMPLATE_LANG,
  },
} as const;

export type Config = typeof config;
