/**
 * Laporan warga: simpan, tolak duplikat, batasi per perangkat, antrean moderasi.
 * Hanya laporan berstatus "approved" yang tampil ke publik.
 */
import { randomUUID } from 'node:crypto';
import { REPORT_KINDS, type BBox, type CitizenReport, type ReportKind } from '@siaga/core';
import sharp from 'sharp';
import { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../lib/db.js';
import { publish } from '../lib/live.js';
import { rateLimit } from '../lib/redis.js';
import { storage } from './storage.js';

export const LIMITS = {
  perDeviceHour: 5,
  perDeviceDay: 20,
  /** longgar karena CGNAT; batas utama per perangkat */
  perIpHour: 120,
  duplicateRadiusM: 200,
  duplicateWindowMin: 30,
  maxPhotoBytes: 8 * 1024 * 1024,
  maxTextLen: 200,
} as const;

export class ReportError extends Error {
  constructor(
    public code: 'rate_limited' | 'invalid' | 'photo_invalid',
    msg: string,
  ) {
    super(msg);
  }
}

export const isKind = (k: unknown): k is ReportKind => typeof k === 'string' && (REPORT_KINDS as readonly string[]).includes(k);

interface Row {
  id: string;
  kind: string;
  text: string;
  lat: number;
  lon: number;
  photoKey: string | null;
  status: CitizenReport['status'];
  createdAt: Date;
}

const toPublic = (r: Row, withStatus = false): CitizenReport => ({
  id: r.id,
  kind: r.kind as ReportKind,
  text: r.text,
  lat: r.lat,
  lon: r.lon,
  t: r.createdAt.getTime(),
  photoUrl: r.photoKey ? storage().url(r.photoKey) : null,
  ...(withStatus ? { status: r.status } : {}),
});

/** Kompres ulang foto: putar sesuai EXIF, maks 1280 px, JPEG, tanpa metadata (lokasi GPS ikut terhapus). */
export async function processPhoto(buf: Buffer): Promise<Buffer> {
  try {
    return await sharp(buf, { failOn: 'error', limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new ReportError('photo_invalid', 'Foto tidak bisa dibaca. Coba foto lain.');
  }
}

export interface NewReport {
  deviceId: string;
  kind: ReportKind;
  text: string;
  lat: number;
  lon: number;
  photo?: Buffer | null;
  ipHash: string;
}

export async function createReport(r: NewReport): Promise<{ id: string; status: 'pending' | 'duplicate'; duplicateOf?: string }> {
  const okHour = await rateLimit(`report:dev:h:${r.deviceId}`, LIMITS.perDeviceHour, 3600);
  const okDay = await rateLimit(`report:dev:d:${r.deviceId}`, LIMITS.perDeviceDay, 86400);
  const okIp = await rateLimit(`report:ip:h:${r.ipHash}`, LIMITS.perIpHour, 3600);
  if (!okHour || !okDay || !okIp) throw new ReportError('rate_limited', 'Terlalu banyak laporan dari perangkat ini. Coba lagi nanti.');

  // Duplikat: jenis sama, radius 200 m, 30 menit terakhir, belum ditolak.
  const dup = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Report"
    WHERE "kind" = ${r.kind}
      AND "status" IN ('pending', 'approved')
      AND "createdAt" > now() - make_interval(mins => ${LIMITS.duplicateWindowMin})
      AND ST_DWithin("geom", ST_SetSRID(ST_MakePoint(${r.lon}, ${r.lat}), 4326)::geography, ${LIMITS.duplicateRadiusM})
    ORDER BY "createdAt" ASC
    LIMIT 1`;
  const duplicateOf = dup[0]?.id;

  let photoKey: string | null = null;
  if (r.photo && !duplicateOf) {
    const jpg = await processPhoto(r.photo);
    const d = new Date();
    photoKey = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.jpg`;
    await storage().put(photoKey, jpg, 'image/jpeg');
  }

  const row = await prisma.report.create({
    data: {
      deviceId: r.deviceId,
      kind: r.kind,
      text: r.text.slice(0, LIMITS.maxTextLen),
      lat: r.lat,
      lon: r.lon,
      photoKey,
      status: duplicateOf ? 'duplicate' : 'pending',
      duplicateOfId: duplicateOf ?? null,
      ipHash: r.ipHash,
    },
    select: { id: true },
  });
  return duplicateOf ? { id: row.id, status: 'duplicate', duplicateOf } : { id: row.id, status: 'pending' };
}

export async function approvedReportsNear(lat: number, lon: number, radiusKm: number, hours: number): Promise<CitizenReport[]> {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT "id", "kind", "text", "lat", "lon", "photoKey", "status"::text AS "status", "createdAt"
    FROM "Report"
    WHERE "status" = 'approved'
      AND "createdAt" > now() - make_interval(hours => ${hours})
      AND ST_DWithin("geom", ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography, ${radiusKm * 1000})
    ORDER BY "createdAt" DESC
    LIMIT 200`;
  return rows.map((r) => toPublic(r));
}

export async function approvedReportsIn(bb: BBox, hours: number): Promise<CitizenReport[]> {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT "id", "kind", "text", "lat", "lon", "photoKey", "status"::text AS "status", "createdAt"
    FROM "Report"
    WHERE "status" = 'approved'
      AND "createdAt" > now() - make_interval(hours => ${hours})
      AND "lat" BETWEEN ${bb.s} AND ${bb.n} AND "lon" BETWEEN ${bb.w} AND ${bb.e}
    ORDER BY "createdAt" DESC
    LIMIT 500`;
  return rows.map((r) => toPublic(r));
}

export async function myReports(deviceId: string): Promise<CitizenReport[]> {
  const rows = await prisma.report.findMany({
    where: { deviceId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, kind: true, text: true, lat: true, lon: true, photoKey: true, status: true, createdAt: true },
  });
  return rows.map((r) => toPublic(r as Row, true));
}

/* ---------------- moderasi ---------------- */

export async function moderationQueue(status: 'pending' | 'approved' | 'rejected' = 'pending', limit = 50) {
  const rows = await prisma.report.findMany({
    where: { status },
    orderBy: { createdAt: status === 'pending' ? 'asc' : 'desc' },
    take: limit,
    include: { _count: { select: { duplicates: true } } },
  });
  const deviceIds = [...new Set(rows.map((r) => r.deviceId))];
  const history = deviceIds.length
    ? await prisma.report.groupBy({ by: ['deviceId', 'status'], where: { deviceId: { in: deviceIds } }, _count: true })
    : [];
  const stats = new Map<string, { approved: number; rejected: number }>();
  for (const h of history) {
    const s = stats.get(h.deviceId) ?? { approved: 0, rejected: 0 };
    if (h.status === 'approved') s.approved += h._count;
    if (h.status === 'rejected') s.rejected += h._count;
    stats.set(h.deviceId, s);
  }
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    text: r.text,
    lat: r.lat,
    lon: r.lon,
    t: r.createdAt.getTime(),
    status: r.status,
    photoUrl: r.photoKey ? storage().url(r.photoKey) : null,
    /** jumlah warga lain yang melaporkan hal sama (duplikat) */
    confirmations: r._count.duplicates,
    reporter: stats.get(r.deviceId) ?? { approved: 0, rejected: 0 },
  }));
}

export async function moderate(id: string, action: 'approve' | 'reject', by: string, note?: string) {
  const status = action === 'approve' ? 'approved' : 'rejected';
  try {
    const r = await prisma.report.update({
      where: { id },
      data: { status, moderatedAt: new Date(), moderatedBy: by, moderationNote: note ?? null },
      select: { id: true, status: true, kind: true, lat: true, lon: true },
    });
    if (r.status === 'approved') await publish({ type: 'report', id: r.id, kind: r.kind, lat: r.lat, lon: r.lon });
    return { id: r.id, status: r.status };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') return null;
    throw e;
  }
}
