/**
 * Worker terjadwal: menarik tiap sumber, menormalkan, menyimpan (Redis + PostgreSQL),
 * lalu menilai lokasi pantauan untuk peringatan. Aman dijalankan lebih dari satu
 * instans: setiap tugas dijaga kunci Redis.
 *
 * Jadwal (brief): gempa 1 mnt, laporan banjir 5 mnt, hujan 10 mnt, udara 15 mnt,
 * titik api & gunung api 30 mnt. Peringatan 2 mnt. Pembersihan riwayat 6 jam.
 */
import { FEED_KEYS, FEEDS, type FeedKey } from '@siaga/core';
import { pino } from 'pino';
import { COLLECTORS } from './collectors/index.js';
import { config } from './config.js';
import { prisma } from './lib/db.js';
import { acquireLock, redis } from './lib/redis.js';
import { runAlerts } from './services/alerts.js';
import { feedEnabled, lastAttempt, recordRun } from './services/store.js';

const log = pino({ level: config.isProd ? 'info' : 'debug', base: { proc: 'worker' } });

interface Job {
  name: string;
  everyMs: number;
  timeoutMs: number;
  run: () => Promise<unknown>;
  /** Tugas pengumpul: waktu percobaan terakhir disimpan di Redis */
  feed?: FeedKey;
}

const withTimeout = <T>(p: Promise<T>, ms: number, name: string) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${name}: melewati batas waktu ${ms} ms`)), ms))]);

const lastRun = new Map<string, number>();

async function tick(job: Job) {
  const release = await acquireLock(`job:${job.name}`, job.timeoutMs + 5_000);
  if (!release) return;
  try {
    const prev = job.feed ? await lastAttempt(job.feed) : (lastRun.get(job.name) ?? null);
    if (prev && Date.now() - prev < job.everyMs * 0.9) return;
    const started = Date.now();
    lastRun.set(job.name, started);
    try {
      const r = await withTimeout(job.run(), job.timeoutMs, job.name);
      if (job.feed) {
        const rr = r as { source: string; count: number; note?: string };
        await recordRun(job.feed, { ok: true, source: rr.source, count: rr.count }, started);
        log.info({ job: job.name, ms: Date.now() - started, source: rr.source, count: rr.count, note: rr.note }, 'selesai');
      } else log.info({ job: job.name, ms: Date.now() - started, result: r }, 'selesai');
    } catch (e) {
      const msg = (e as Error).message;
      if (job.feed) await recordRun(job.feed, { ok: false, error: msg }, started);
      log.warn({ job: job.name, ms: Date.now() - started, err: msg }, 'gagal');
    }
  } finally {
    await release();
  }
}

/** Hapus riwayat lama supaya database tidak membengkak. */
async function prune() {
  const day = 864e5;
  const ago = (d: number) => new Date(Date.now() - d * day);
  const [w, a, h, f] = await Promise.all([
    prisma.weatherObservation.deleteMany({ where: { fetchedAt: { lt: ago(90) } } }),
    prisma.airObservation.deleteMany({ where: { fetchedAt: { lt: ago(90) } } }),
    prisma.hotspot.deleteMany({ where: { time: { lt: ago(365) } } }),
    prisma.feedRun.deleteMany({ where: { startedAt: { lt: ago(30) } } }),
  ]);
  return { weather: w.count, air: a.count, hotspot: h.count, feedRun: f.count };
}

const jobs: Job[] = [
  ...FEED_KEYS.filter(feedEnabled).map((k) => ({
    name: `collect:${k}`,
    feed: k,
    everyMs: FEEDS[k].everyMs,
    timeoutMs: k === 'cuaca' || k === 'udara' ? 5 * 60_000 : 2 * 60_000,
    run: COLLECTORS[k],
  })),
  { name: 'alerts', everyMs: 2 * 60_000, timeoutMs: 5 * 60_000, run: runAlerts },
  { name: 'prune', everyMs: 6 * 3600_000, timeoutMs: 10 * 60_000, run: prune },
];

const timers: NodeJS.Timeout[] = [];
for (const [i, job] of jobs.entries()) {
  // Jalankan segera (sedikit berselang), lalu periksa tiap 15 detik apakah sudah waktunya.
  timers.push(setTimeout(() => void tick(job), 500 + i * 700));
  timers.push(setInterval(() => void tick(job), Math.min(15_000, job.everyMs)));
}
log.info({ jobs: jobs.map((j) => `${j.name}/${Math.round(j.everyMs / 60_000)}m`) }, 'worker berjalan');

const shutdown = async () => {
  timers.forEach(clearInterval);
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
