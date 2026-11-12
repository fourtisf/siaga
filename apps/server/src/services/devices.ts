/**
 * Akun anonim per perangkat. Browser menyimpan token di localStorage dan mengirimnya
 * sebagai `Authorization: Bearer <token>`. Server hanya menyimpan hash-nya.
 * Kelak bisa ditautkan ke nomor WhatsApp setelah verifikasi OTP.
 */
import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { prisma } from '../lib/db.js';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function hashIp(ip: string): string {
  return sha256(`${config.ipHashSalt}:${ip}`).slice(0, 32);
}

export async function createDevice(): Promise<{ deviceId: string; token: string }> {
  const token = randomBytes(32).toString('base64url');
  const d = await prisma.device.create({ data: { tokenHash: sha256(token) }, select: { id: true } });
  return { deviceId: d.id, token };
}

const seen = new Map<string, number>();

export async function deviceFromToken(token: string | undefined | null): Promise<{ id: string } | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const d = await prisma.device.findUnique({ where: { tokenHash: sha256(token) }, select: { id: true, blocked: true } });
  if (!d || d.blocked) return null;
  const last = seen.get(d.id) ?? 0;
  if (Date.now() - last > 3600_000) {
    seen.set(d.id, Date.now());
    await prisma.device.update({ where: { id: d.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }
  return { id: d.id };
}
