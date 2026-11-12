/**
 * Peringatan otomatis. Worker menilai tiap lokasi pantauan yang punya langganan aktif
 * dan mengirim pesan HANYA saat tingkatnya naik (Aman→Waspada, Waspada→Bahaya, Aman→Bahaya).
 * Tingkat yang turun baru dicatat setelah bertahan 60 menit, supaya nilai yang naik-turun
 * di sekitar ambang tidak mengirim pesan berulang.
 */
import { randomBytes } from 'node:crypto';
import webpush from 'web-push';
import { config } from '../config.js';
import { prisma } from '../lib/db.js';
import { K, redis } from '../lib/redis.js';
import { statusFor } from './status.js';

type Channel = 'webpush' | 'telegram' | 'whatsapp';

export interface AlertMessage {
  title: string;
  body: string;
  url: string;
  level: 1 | 2;
  placeName: string;
  head: string;
  act: string;
}

export const channelsAvailable = () => ({
  webpush: !!(config.push.vapidPublic && config.push.vapidPrivate),
  telegram: !!(config.telegram.token && config.telegram.username),
  whatsapp: !!(config.whatsapp.token && config.whatsapp.phoneNumberId),
});

if (config.push.vapidPublic && config.push.vapidPrivate) {
  webpush.setVapidDetails(config.push.vapidSubject, config.push.vapidPublic, config.push.vapidPrivate);
}

/* ---------------- langganan ---------------- */

export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function subscribeWebPush(deviceId: string, sub: PushSubscriptionJSON) {
  const row = await prisma.alertSubscription.upsert({
    where: { channel_key: { channel: 'webpush', key: sub.endpoint } },
    create: { deviceId, channel: 'webpush', key: sub.endpoint, payload: JSON.stringify(sub) },
    update: { deviceId, payload: JSON.stringify(sub), active: true, lastError: null },
    select: { id: true, channel: true },
  });
  await baselinePlaces(deviceId);
  return row;
}

/** Kode sekali pakai untuk menautkan chat Telegram: t.me/<bot>?start=<kode> */
export async function telegramLinkStart(deviceId: string): Promise<{ url: string; code: string }> {
  const code = randomBytes(9).toString('base64url');
  await redis.set(K.tgLink(code), deviceId, 'EX', 1800);
  return { code, url: `https://t.me/${config.telegram.username}?start=${code}` };
}

export async function listSubscriptions(deviceId: string) {
  return prisma.alertSubscription.findMany({
    where: { deviceId, active: true },
    select: { id: true, channel: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
}

export async function unsubscribe(deviceId: string, opts: { channel?: Channel; endpoint?: string }) {
  const r = await prisma.alertSubscription.updateMany({
    where: { deviceId, active: true, ...(opts.channel ? { channel: opts.channel } : {}), ...(opts.endpoint ? { key: opts.endpoint } : {}) },
    data: { active: false },
  });
  return r.count;
}

/** Saat berlangganan, tingkat sekarang menjadi patokan supaya tidak langsung dikirimi pesan untuk keadaan yang sudah terlihat. */
async function baselinePlaces(deviceId: string) {
  const places = await prisma.place.findMany({ where: { deviceId, notifiedLevel: null } });
  for (const p of places) {
    const st = await statusFor(p.lat, p.lon, p.name, { withNearby: false }).catch(() => null);
    if (st?.level != null) await prisma.place.update({ where: { id: p.id }, data: { notifiedLevel: st.level, lastLevel: st.level, lastAssessedAt: new Date() } });
  }
}

/* ---------------- Telegram ---------------- */

async function telegramApi(method: string, body: unknown): Promise<{ ok: boolean; status: number; description?: string }> {
  const r = await fetch(`https://api.telegram.org/bot${config.telegram.token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  return { ok: r.ok && !!j.ok, status: r.status, description: j.description };
}

/** Pembaruan dari webhook Telegram: /start <kode> menautkan, /stop berhenti. */
export async function handleTelegramUpdate(update: any): Promise<void> {
  const msg = update?.message;
  const chatId = msg?.chat?.id;
  const text: string = typeof msg?.text === 'string' ? msg.text.trim() : '';
  if (!chatId || !text) return;
  if (text.startsWith('/start')) {
    const code = text.split(/\s+/)[1];
    const deviceId = code ? await redis.getdel(K.tgLink(code)) : null;
    if (!deviceId) {
      await telegramApi('sendMessage', { chat_id: chatId, text: 'Buka SIAGA, nyalakan "Peringatan otomatis", lalu pilih Telegram untuk menautkan akun ini.' });
      return;
    }
    await prisma.alertSubscription.upsert({
      where: { channel_key: { channel: 'telegram', key: String(chatId) } },
      create: { deviceId, channel: 'telegram', key: String(chatId) },
      update: { deviceId, active: true, lastError: null },
    });
    await baselinePlaces(deviceId);
    await telegramApi('sendMessage', {
      chat_id: chatId,
      text: 'Peringatan SIAGA aktif. Anda akan dikabari saat tingkat bahaya di lokasi pantauan naik. Kirim /stop untuk berhenti.',
    });
  } else if (text === '/stop') {
    await prisma.alertSubscription.updateMany({ where: { channel: 'telegram', key: String(chatId) }, data: { active: false } });
    await telegramApi('sendMessage', { chat_id: chatId, text: 'Peringatan SIAGA dimatikan. Kirim /start dari aplikasi untuk menyalakan lagi.' });
  }
}

/* ---------------- pengiriman ---------------- */

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

interface SendResult {
  ok: boolean;
  error?: string;
  /** tujuan tidak berlaku lagi (izin dicabut, bot diblokir) */
  gone?: boolean;
}

async function sendWebPush(payload: string | null, m: AlertMessage): Promise<SendResult> {
  if (!channelsAvailable().webpush || !payload) return { ok: false, error: 'web push belum dikonfigurasi' };
  try {
    await webpush.sendNotification(
      JSON.parse(payload),
      JSON.stringify({ title: m.title, body: m.body, url: m.url, tag: `siaga-${m.placeName}`, level: m.level }),
      { TTL: 3 * 3600, urgency: m.level === 2 ? 'high' : 'normal' },
    );
    return { ok: true };
  } catch (e: any) {
    const code = e?.statusCode;
    return { ok: false, error: `HTTP ${code ?? '?'} ${e?.body ?? e?.message ?? ''}`.slice(0, 300), gone: code === 404 || code === 410 };
  }
}

async function sendTelegram(chatId: string, m: AlertMessage): Promise<SendResult> {
  if (!channelsAvailable().telegram) return { ok: false, error: 'Telegram belum dikonfigurasi' };
  const r = await telegramApi('sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    text: `<b>${esc(m.title)}</b>\n${esc(m.head)}.\n${esc(m.act)}\n\n${esc(m.url)}`,
  }).catch((e) => ({ ok: false, status: 0, description: (e as Error).message }));
  return r.ok ? { ok: true } : { ok: false, error: r.description, gone: r.status === 403 };
}

/**
 * WhatsApp Business Cloud API. Pesan yang dimulai bisnis wajib memakai template yang
 * sudah disetujui Meta. Template contoh (bahasa id), 4 variabel:
 *   "SIAGA: {{1}} berstatus {{2}}. {{3}}. {{4}}"
 */
async function sendWhatsApp(phone: string, m: AlertMessage): Promise<SendResult> {
  const w = config.whatsapp;
  if (!channelsAvailable().whatsapp) return { ok: false, error: 'WhatsApp belum dikonfigurasi' };
  const r = await fetch(`https://graph.facebook.com/v23.0/${w.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${w.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone,
      type: 'template',
      template: {
        name: w.template,
        language: { code: w.lang },
        components: [
          {
            type: 'body',
            parameters: [m.placeName, m.level === 2 ? 'Bahaya' : 'Waspada', m.head, m.act].map((text) => ({ type: 'text', text })),
          },
        ],
      },
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch((e) => ({ ok: false, status: 0, text: async () => (e as Error).message }) as unknown as Response);
  return r.ok ? { ok: true } : { ok: false, error: (await r.text()).slice(0, 300) };
}

/* ---------------- worker ---------------- */

export function buildMessage(placeName: string, level: 1 | 2, head: string, act: string): AlertMessage {
  const label = level === 2 ? 'Bahaya' : 'Waspada';
  return {
    title: `${label} di ${placeName}`,
    body: `${head}. ${act}`,
    url: `${config.publicAppUrl}/`,
    level,
    placeName,
    head,
    act,
  };
}

export interface Decision {
  send: boolean;
  notifiedLevel: number | null;
  downSince: Date | null;
}

/** Keputusan kirim/tidak. Dipisah supaya bisa diuji tanpa database. */
export function decide(cur: number | null, notified: number | null, downSince: Date | null, now: Date, holdMs = 60 * 60_000): Decision {
  const n = notified ?? 0;
  if (cur === null) return { send: false, notifiedLevel: notified, downSince };
  if (cur > n) return { send: true, notifiedLevel: cur, downSince: null };
  if (cur < n) {
    if (!downSince) return { send: false, notifiedLevel: notified, downSince: now };
    if (now.getTime() - downSince.getTime() >= holdMs) return { send: false, notifiedLevel: cur, downSince: null };
    return { send: false, notifiedLevel: notified, downSince };
  }
  return { send: false, notifiedLevel: notified ?? cur, downSince: null };
}

export async function runAlerts(): Promise<{ places: number; sent: number }> {
  const places = await prisma.place.findMany({
    where: { device: { blocked: false, subscriptions: { some: { active: true } } } },
    include: { device: { select: { subscriptions: { where: { active: true } } } } },
  });
  let sent = 0;
  for (const p of places) {
    const st = await statusFor(p.lat, p.lon, p.name, { withNearby: false }).catch(() => null);
    const now = new Date();
    const cur = st?.level ?? null;
    const d = decide(cur, p.notifiedLevel, p.downSince, now);
    if (d.send && st && (cur === 1 || cur === 2)) {
      const worst = st.conditions.find((c) => c.level === cur)!;
      const m = buildMessage(p.name, cur, worst.head, worst.act);
      for (const s of p.device.subscriptions) {
        const r =
          s.channel === 'webpush' ? await sendWebPush(s.payload, m) : s.channel === 'telegram' ? await sendTelegram(s.key, m) : await sendWhatsApp(s.key, m);
        if (r.ok) sent++;
        await prisma.alertLog.create({
          data: { placeId: p.id, subscriptionId: s.id, channel: s.channel, fromLevel: p.notifiedLevel, toLevel: cur, title: m.title, body: m.body, ok: r.ok, error: r.error ?? null },
        });
        if (!r.ok) await prisma.alertSubscription.update({ where: { id: s.id }, data: { lastError: r.error ?? null, ...(r.gone ? { active: false } : {}) } });
      }
    }
    await prisma.place.update({
      where: { id: p.id },
      data: {
        notifiedLevel: d.notifiedLevel,
        downSince: d.downSince,
        ...(cur !== null ? { lastLevel: cur, lastAssessedAt: now } : {}),
        ...(d.send ? { lastNotifiedAt: now } : {}),
      },
    });
  }
  return { places: places.length, sent };
}
