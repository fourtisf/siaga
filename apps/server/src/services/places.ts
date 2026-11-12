import { prisma } from '../lib/db.js';

export const MAX_PLACES = 10;

const select = { id: true, name: true, lat: true, lon: true, position: true, lastLevel: true, createdAt: true } as const;

export function listPlaces(deviceId: string) {
  return prisma.place.findMany({ where: { deviceId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], select });
}

export class PlaceError extends Error {}

export async function createPlace(deviceId: string, p: { name: string; lat: number; lon: number }) {
  const n = await prisma.place.count({ where: { deviceId } });
  if (n >= MAX_PLACES) throw new PlaceError(`Maksimal ${MAX_PLACES} lokasi pantauan.`);
  return prisma.place.create({
    data: { deviceId, name: p.name.trim().slice(0, 60), lat: +p.lat.toFixed(5), lon: +p.lon.toFixed(5), position: n },
    select,
  });
}

export async function updatePlace(deviceId: string, id: string, p: { name?: string; position?: number }) {
  const r = await prisma.place.updateMany({
    where: { id, deviceId },
    data: { ...(p.name ? { name: p.name.trim().slice(0, 60) } : {}), ...(p.position != null ? { position: p.position } : {}) },
  });
  if (!r.count) return null;
  return prisma.place.findUnique({ where: { id }, select });
}

export async function deletePlace(deviceId: string, id: string): Promise<boolean> {
  const r = await prisma.place.deleteMany({ where: { id, deviceId } });
  return r.count > 0;
}
