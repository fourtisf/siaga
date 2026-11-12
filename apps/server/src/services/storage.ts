/**
 * Penyimpanan foto laporan. "local" = folder di VPS (disajikan Nginx),
 * "s3" = object storage S3-compatible (Cloudflare R2, MinIO, IDCloudHost, dsb).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { config } from '../config.js';

export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Hanya untuk driver local saat pengembangan (produksi: Nginx). */
  get(key: string): Promise<Buffer | null>;
  url(key: string): string;
}

const safeKey = (key: string) => {
  if (!/^[a-z0-9/_-]+\.(jpg|jpeg|webp)$/i.test(key) || key.includes('..')) throw new Error('kunci tidak valid');
  return key;
};

function localStorage(): Storage {
  const root = config.storage.localDir;
  const pathOf = (key: string) => {
    const p = normalize(join(root, safeKey(key)));
    if (!p.startsWith(root)) throw new Error('kunci tidak valid');
    return p;
  };
  return {
    async put(key, body) {
      const p = pathOf(key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, body);
    },
    async get(key) {
      try {
        return await readFile(pathOf(key));
      } catch {
        return null;
      }
    },
    url: (key) => `${config.storage.publicBaseUrl}/${key}`,
  };
}

function s3Storage(): Storage {
  const s = config.storage.s3;
  if (!s.bucket || !s.accessKeyId || !s.secretAccessKey) throw new Error('S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY wajib diisi untuk STORAGE_DRIVER=s3');
  const client = new S3Client({
    region: s.region,
    endpoint: s.endpoint,
    forcePathStyle: !!s.endpoint,
    credentials: { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey },
  });
  return {
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket: s.bucket, Key: safeKey(key), Body: body, ContentType: contentType, CacheControl: 'public, max-age=31536000, immutable' }),
      );
    },
    async get(key) {
      try {
        const r = await client.send(new GetObjectCommand({ Bucket: s.bucket, Key: safeKey(key) }));
        return r.Body ? Buffer.from(await r.Body.transformToByteArray()) : null;
      } catch {
        return null;
      }
    },
    url: (key) => `${config.storage.publicBaseUrl}/${key}`,
  };
}

let instance: Storage | null = null;
export function storage(): Storage {
  instance ??= config.storage.driver === 's3' ? s3Storage() : localStorage();
  return instance;
}
