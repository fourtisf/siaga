import { timingSafeEqual } from 'node:crypto';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { BBOX_ID, FEEDS, isValidLatLon, parseBBox, REPORT_KINDS } from '@siaga/core';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from './config.js';
import { prisma } from './lib/db.js';
import { redis } from './lib/redis.js';
import {
  channelsAvailable,
  handleTelegramUpdate,
  listSubscriptions,
  subscribeWebPush,
  telegramLinkStart,
  unsubscribe,
} from './services/alerts.js';
import { createDevice, deviceFromToken, hashIp } from './services/devices.js';
import { createPlace, deletePlace, listPlaces, PlaceError, updatePlace } from './services/places.js';
import { createReport, isKind, LIMITS, moderate, moderationQueue, myReports, approvedReportsNear, ReportError } from './services/reports.js';
import { mapFor, statusFor } from './services/status.js';
import { storage } from './services/storage.js';
import { getFeeds } from './services/store.js';

/** Atribusi sumber yang wajib/diminta ditampilkan. */
export const ATTRIBUTION = [
  { feed: 'gempa', text: 'Sumber: BMKG', url: 'https://data.bmkg.go.id' },
  { feed: 'gempa', text: 'Cadangan: U.S. Geological Survey', url: 'https://earthquake.usgs.gov' },
  { feed: 'cuaca', text: 'Data cuaca oleh Open-Meteo.com (CC BY 4.0)', url: 'https://open-meteo.com' },
  { feed: 'udara', text: 'Generated using Copernicus Atmosphere Monitoring Service information, via Open-Meteo', url: 'https://atmosphere.copernicus.eu' },
  { feed: 'api', text: 'NASA FIRMS (Fire Information for Resource Management System)', url: 'https://firms.modaps.eosdis.nasa.gov' },
  { feed: 'gunung', text: 'MAGMA Indonesia, PVMBG Badan Geologi', url: 'https://magma.esdm.go.id' },
  { feed: 'gunung', text: 'NASA EONET', url: 'https://eonet.gsfc.nasa.gov' },
  { feed: 'banjir', text: 'Data provided by PetaBencana.id', url: 'https://petabencana.id' },
];

const err = (reply: FastifyReply, status: number, code: string, message: string) => reply.code(status).send({ error: { code, message } });

const num = z.coerce.number();
const LatLonQ = z.object({ lat: num, lon: num, name: z.string().max(60).optional() });

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

function safeEq(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function buildApp() {
  const app = Fastify({
    logger: config.env === 'test' ? false : { level: config.isProd ? 'info' : 'debug', redact: ['req.headers.authorization', 'req.headers["x-admin-token"]'] },
    trustProxy: 'loopback',
    bodyLimit: 256 * 1024,
  });

  await app.register(cors, { origin: config.api.corsOrigins.length ? config.api.corsOrigins : false });
  // Batas per IP sengaja longgar: operator seluler Indonesia memakai CGNAT, jadi ratusan
  // pelanggan bisa tampil dengan satu IP publik. Pembatasan utama ada per perangkat.
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
    redis,
    nameSpace: 'siaga:rl:http:',
    errorResponseBuilder: () => ({ statusCode: 429, error: { code: 'rate_limited', message: 'Terlalu banyak permintaan. Coba lagi sebentar lagi.' } }),
  });
  await app.register(multipart, { limits: { fileSize: LIMITS.maxPhotoBytes, files: 1, fields: 8, fieldSize: 2048 } });

  const device = async (req: FastifyRequest, reply: FastifyReply) => {
    const d = await deviceFromToken(bearer(req));
    if (!d) {
      err(reply, 401, 'unauthorized', 'Perangkat belum terdaftar.');
      return null;
    }
    return d;
  };
  const admin = (req: FastifyRequest, reply: FastifyReply) => {
    const t = req.headers['x-admin-token'];
    if (typeof t !== 'string' || !safeEq(t, config.adminToken)) {
      err(reply, 401, 'unauthorized', 'Token moderator salah.');
      return false;
    }
    return true;
  };

  app.setErrorHandler((e: any, req, reply) => {
    if (e?.statusCode === 429) return reply.code(429).send({ error: e.error ?? { code: 'rate_limited', message: 'Terlalu banyak permintaan.' } });
    if (e?.code === 'FST_REQ_FILE_TOO_LARGE') return err(reply, 413, 'too_large', 'Foto terlalu besar (maks 8 MB).');
    req.log.error(e);
    return err(reply, e?.statusCode && e.statusCode < 500 ? e.statusCode : 500, 'server_error', 'Terjadi kesalahan di server.');
  });

  /* ---------- kesehatan & sumber ---------- */

  app.get('/health', async (_req, reply) => {
    const [db, rd] = await Promise.allSettled([prisma.$queryRaw`SELECT 1`, redis.ping()]);
    const ok = db.status === 'fulfilled' && rd.status === 'fulfilled';
    return reply.code(ok ? 200 : 503).send({ ok, db: db.status === 'fulfilled', redis: rd.status === 'fulfilled' });
  });

  app.get('/sources', async () => {
    const feeds = await getFeeds();
    return {
      feeds: Object.values(feeds).map((f) => ({ ...f, label: FEEDS[f.key].label, everyMs: FEEDS[f.key].everyMs, staleAfterMs: FEEDS[f.key].staleAfterMs })),
      attribution: ATTRIBUTION,
      generatedAt: Date.now(),
    };
  });

  /* ---------- status satu titik ---------- */

  app.get('/status', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (req, reply) => {
    const q = LatLonQ.safeParse(req.query);
    if (!q.success || !isValidLatLon(q.data.lat, q.data.lon)) return err(reply, 400, 'invalid', 'Parameter lat dan lon wajib diisi.');
    reply.header('Cache-Control', 'no-store');
    return statusFor(q.data.lat, q.data.lon, q.data.name ?? null);
  });

  /** Tingkat ringkas untuk beberapa titik sekaligus (daftar lokasi pantauan). points=lat,lon;lat,lon */
  app.get('/status/levels', async (req, reply) => {
    const raw = String((req.query as any).points ?? '');
    const pts = raw.split(';').filter(Boolean).slice(0, 10).map((s) => s.split(',').map(Number) as [number, number]);
    if (!pts.length || pts.some(([la, lo]) => !isValidLatLon(la, lo))) return err(reply, 400, 'invalid', 'Format points: lat,lon;lat,lon');
    const out = await Promise.all(pts.map(([lat, lon]) => statusFor(lat, lon, null, { withNearby: false })));
    return out.map((s) => ({ lat: s.place.lat, lon: s.place.lon, level: s.level, label: s.label }));
  });

  /* ---------- peta ---------- */

  app.get('/map', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const bb = q.bbox ? parseBBox(q.bbox) : BBOX_ID;
    if (!bb) return err(reply, 400, 'invalid', 'Format bbox: barat,selatan,timur,utara');
    const mode = q.mode === 'all' ? 'all' : 'danger';
    let focus = null;
    if (q.focus) {
      const [lat, lon] = q.focus.split(',').map(Number);
      if (isValidLatLon(lat, lon)) focus = { lat: lat!, lon: lon! };
    }
    reply.header('Cache-Control', 'public, max-age=30');
    return mapFor(bb, mode, focus);
  });

  /* ---------- perangkat ---------- */

  app.post('/devices', { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } }, async (_req, reply) => {
    return reply.code(201).send(await createDevice());
  });

  /* ---------- lokasi pantauan ---------- */

  const PlaceBody = z.object({ name: z.string().trim().min(1).max(60), lat: z.number(), lon: z.number() });
  app.get('/places', async (req, reply) => {
    const d = await device(req, reply);
    if (!d) return;
    return listPlaces(d.id);
  });
  app.post('/places', async (req, reply) => {
    const d = await device(req, reply);
    if (!d) return;
    const b = PlaceBody.safeParse(req.body);
    if (!b.success || !isValidLatLon(b.data.lat, b.data.lon)) return err(reply, 400, 'invalid', 'Nama dan koordinat wajib diisi.');
    try {
      return reply.code(201).send(await createPlace(d.id, b.data));
    } catch (e) {
      if (e instanceof PlaceError) return err(reply, 409, 'limit', e.message);
      throw e;
    }
  });
  app.patch('/places/:id', async (req, reply) => {
    const d = await device(req, reply);
    if (!d) return;
    const b = z.object({ name: z.string().trim().min(1).max(60).optional(), position: z.number().int().min(0).max(100).optional() }).safeParse(req.body);
    if (!b.success) return err(reply, 400, 'invalid', 'Data tidak valid.');
    const p = await updatePlace(d.id, (req.params as any).id, b.data);
    return p ?? err(reply, 404, 'not_found', 'Lokasi tidak ditemukan.');
  });
  app.delete('/places/:id', async (req, reply) => {
    const d = await device(req, reply);
    if (!d) return;
    return (await deletePlace(d.id, (req.params as any).id)) ? reply.code(204).send() : err(reply, 404, 'not_found', 'Lokasi tidak ditemukan.');
  });

  /* ---------- laporan warga ---------- */

  app.post('/reports', { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } }, async (req, reply) => {
    const d = await device(req, reply);
    if (!d) return;
    if (!req.isMultipart()) return err(reply, 415, 'invalid', 'Kirim sebagai multipart/form-data.');
    const fields: Record<string, string> = {};
    let photo: Buffer | null = null;
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'photo') {
          await part.toBuffer();
          continue;
        }
        if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(part.mimetype)) return err(reply, 400, 'photo_invalid', 'Format foto tidak didukung.');
        photo = await part.toBuffer();
      } else fields[part.fieldname] = String(part.value ?? '');
    }
    const lat = Number(fields.lat), lon = Number(fields.lon);
    if (!isKind(fields.kind)) return err(reply, 400, 'invalid', `Jenis laporan harus salah satu dari: ${REPORT_KINDS.join(', ')}.`);
    if (!isValidLatLon(lat, lon)) return err(reply, 400, 'invalid', 'Lokasi kejadian wajib diisi.');
    try {
      const r = await createReport({ deviceId: d.id, kind: fields.kind, text: (fields.text ?? '').trim(), lat, lon, photo, ipHash: hashIp(req.ip) });
      return reply.code(201).send({
        ...r,
        message:
          r.status === 'duplicate'
            ? 'Kejadian ini sudah dilaporkan warga lain. Laporan Anda menguatkan laporan itu.'
            : 'Laporan terkirim. Laporan tampil di peta setelah diperiksa.',
      });
    } catch (e) {
      if (e instanceof ReportError) return err(reply, e.code === 'rate_limited' ? 429 : 400, e.code, e.message);
      throw e;
    }
  });

  app.get('/reports', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const [lat, lon] = String(q.near ?? '').split(',').map(Number);
    const radius = Math.min(100, Math.max(1, Number(q.radius) || 40));
    if (!isValidLatLon(lat, lon)) return err(reply, 400, 'invalid', 'Format near: lat,lon');
    return approvedReportsNear(lat!, lon!, radius, 72);
  });

  app.get('/reports/mine', async (req, reply) => {
    const d = await device(req, reply);
    if (!d) return;
    return myReports(d.id);
  });

  if (config.storage.driver === 'local') {
    // Pengembangan saja. Di produksi Nginx menyajikan folder foto langsung.
    app.get('/photos/*', async (req, reply) => {
      const key = (req.params as any)['*'] as string;
      const buf = await storage().get(key).catch(() => null);
      if (!buf) return err(reply, 404, 'not_found', 'Foto tidak ditemukan.');
      return reply.header('Content-Type', 'image/jpeg').header('Cache-Control', 'public, max-age=31536000, immutable').send(buf);
    });
  }

  /* ---------- peringatan ---------- */

  app.get('/alerts/config', async () => ({ channels: channelsAvailable(), vapidPublicKey: config.push.vapidPublic ?? null }));

  app.get('/alerts', async (req, reply) => {
    const d = await device(req, reply);
    if (!d) return;
    return listSubscriptions(d.id);
  });

  const SubBody = z.discriminatedUnion('channel', [
    z.object({
      channel: z.literal('webpush'),
      subscription: z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }),
    }),
    z.object({ channel: z.literal('telegram') }),
    z.object({ channel: z.literal('whatsapp'), phone: z.string().optional() }),
  ]);
  app.post('/alerts/subscribe', async (req, reply) => {
    const d = await device(req, reply);
    if (!d) return;
    const b = SubBody.safeParse(req.body);
    if (!b.success) return err(reply, 400, 'invalid', 'Data langganan tidak valid.');
    const ch = channelsAvailable();
    if (b.data.channel === 'webpush') {
      if (!ch.webpush) return err(reply, 503, 'unavailable', 'Notifikasi perangkat belum tersedia.');
      const s = await subscribeWebPush(d.id, b.data.subscription);
      return reply.code(201).send({ ok: true, id: s.id, channel: 'webpush' });
    }
    if (b.data.channel === 'telegram') {
      if (!ch.telegram) return err(reply, 503, 'unavailable', 'Peringatan lewat Telegram belum tersedia.');
      return reply.code(201).send({ ok: true, channel: 'telegram', ...(await telegramLinkStart(d.id)) });
    }
    // WhatsApp butuh verifikasi nomor (OTP) dan template yang disetujui Meta. Belum dibuka.
    return err(reply, 501, 'unavailable', 'Peringatan lewat WhatsApp segera hadir.');
  });

  app.post('/alerts/unsubscribe', async (req, reply) => {
    const d = await device(req, reply);
    if (!d) return;
    const b = z.object({ channel: z.enum(['webpush', 'telegram', 'whatsapp']).optional(), endpoint: z.string().max(1000).optional() }).safeParse(req.body ?? {});
    if (!b.success) return err(reply, 400, 'invalid', 'Data tidak valid.');
    return { ok: true, removed: await unsubscribe(d.id, b.data) };
  });

  app.post('/telegram/webhook/:secret', async (req, reply) => {
    const secret = config.telegram.webhookSecret;
    if (!secret || !safeEq(String((req.params as any).secret), secret)) return reply.code(404).send();
    await handleTelegramUpdate(req.body).catch((e) => req.log.warn(e, 'telegram update gagal'));
    return { ok: true };
  });

  /* ---------- moderasi ---------- */

  app.get('/admin/reports', async (req, reply) => {
    if (!admin(req, reply)) return;
    const s = (req.query as any).status;
    const status = s === 'approved' || s === 'rejected' ? s : 'pending';
    return moderationQueue(status);
  });

  app.post('/admin/reports/:id/moderate', async (req, reply) => {
    if (!admin(req, reply)) return;
    const b = z.object({ action: z.enum(['approve', 'reject']), note: z.string().max(300).optional(), by: z.string().max(60).optional() }).safeParse(req.body);
    if (!b.success) return err(reply, 400, 'invalid', 'action harus approve atau reject.');
    const r = await moderate((req.params as any).id, b.data.action, b.data.by ?? 'moderator', b.data.note);
    return r ?? err(reply, 404, 'not_found', 'Laporan tidak ditemukan.');
  });

  app.get('/admin/feeds', async (req, reply) => {
    if (!admin(req, reply)) return;
    const runs = await prisma.feedRun.findMany({ orderBy: { startedAt: 'desc' }, take: 100 });
    return runs.map((r) => ({ ...r, id: String(r.id) }));
  });

  return app;
}
