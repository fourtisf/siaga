/**
 * Ringkasan nasional untuk halaman pantau: situasi, angka utama, daftar kejadian,
 * dan jumlah per layer. Diturunkan dari data yang sama dengan /map.
 * Logika mengikuti renderSit/renderRib/events() di prototype/siaga-terminal.html.
 */
import { ALERT_NAMES, BBOX_ID, nearestCity, num, where, type FeedKey, type FeedStatus, type Level, type VolcanoAlert } from '@siaga/core';
import { prisma } from '../lib/db.js';
import { mapFor, type MapResponse } from './status.js';

export type LayerId = 'gempa' | 'banjir' | 'api' | 'udara' | 'gunung' | 'warga';

export interface LiveItem {
  id: string;
  type: LayerId;
  /** Tingkat kejadian yang sedang berlangsung (1-2); 0 = catatan kejadian */
  now: 0 | 1 | 2;
  rank: number;
  /** Angka besar di ikon (misalnya "5,2") dan satuannya ("M") */
  value?: string;
  unit?: string;
  /** Nama ikon bila tidak ada angka */
  icon?: string;
  t: number;
  title: string;
  sub: string;
  lat: number;
  lon: number;
  zoom: number;
  /** Kunci penanda di peta, untuk membuka popup */
  ref?: string;
}

export interface Overview {
  generatedAt: number;
  feeds: Record<FeedKey, FeedStatus>;
  situation: { level: Level; head: string; items: string[] };
  kpis: { id: LayerId; label: string; value: string; unit?: string; sub: string; color?: string }[];
  counts: Record<LayerId, number>;
  events: LiveItem[];
}

const DAY = 864e5;
const HEAD = ['Situasi nasional terkendali', 'Perlu waspada di beberapa wilayah', 'Siaga tinggi di beberapa wilayah'] as const;
const FEED_NAME: Record<FeedKey, string> = { gempa: 'gempa', banjir: 'laporan PetaBencana', cuaca: 'hujan', udara: 'kualitas udara', api: 'titik api', gunung: 'gunung api' };

const COMMUNITY_TYPE: Record<string, LayerId> = { banjir: 'banjir', kebakaran: 'api', gunung: 'gunung', gempa: 'gempa' };
const COMMUNITY_TITLE: Record<string, string> = {
  banjir: 'Banjir', kebakaran: 'Kebakaran', gunung: 'Aktivitas gunung', gempa: 'Gempa dirasakan', angin: 'Angin kencang', asap: 'Kabut asap', lainnya: 'Kejadian',
};

function fireGroups(fires: MapResponse['fires']) {
  const m = new Map<string, { n: number; frp: number; t: number; lat: number; lon: number }>();
  for (const f of fires) {
    const name = nearestCity(f.lat, f.lon).name;
    const g = m.get(name) ?? { n: 0, frp: 0, t: 0, lat: f.lat, lon: f.lon };
    g.n++;
    if (f.frp > g.frp) Object.assign(g, { frp: f.frp, lat: f.lat, lon: f.lon });
    g.t = Math.max(g.t, f.t);
    m.set(name, g);
  }
  return [...m].sort((a, b) => b[1].n - a[1].n);
}

export async function overview(now = Date.now()): Promise<Overview> {
  const m = await mapFor(BBOX_ID, 'all', null);
  const f = m.feeds;
  const changes = await prisma.volcanoChange.findMany({
    where: { at: { gt: new Date(now - 7 * DAY) } },
    orderBy: { at: 'desc' },
    take: 20,
    include: { volcano: { select: { name: true, lat: true, lon: true } } },
  });

  /* ---- situasi ---- */
  let lv: Level = 0;
  const up = (l: Level) => (lv = Math.max(lv, l) as Level);
  const items: string[] = [];
  const q24 = m.quakes.filter((q) => now - q.t < DAY).sort((a, b) => b.m - a.m);
  const qmax = q24[0];
  if (f.gempa.available) {
    if (qmax) {
      if (qmax.m >= 6) up(2);
      else if (qmax.m >= 5) up(1);
      items.push(`Gempa terbesar 24 jam terakhir <b>M ${num(qmax.m, 1)}</b>, ${esc(qmax.place)}`);
    } else items.push('Tidak ada gempa tercatat dalam 24 jam terakhir');
    const ts = q24.find((q) => q.tsunami);
    if (ts) {
      up(2);
      items.push(`<b>BMKG: gempa berpotensi tsunami</b>, ${esc(ts.place)}`);
    }
  }
  const heavy = m.rain.filter((r) => r.level === 2).sort((a, b) => b.next24 - a.next24);
  const rainy = m.rain.filter((r) => r.level >= 1);
  if (heavy.length) {
    up(heavy.length >= 8 ? 2 : 1);
    items.push(`<b>${heavy.length} kota</b> hujan sangat lebat, tertinggi ${esc(heavy[0]!.name)} (${num(Math.max(heavy[0]!.next24, heavy[0]!.past24))} mm)`);
  } else if (rainy.length) {
    up(1);
    items.push(`<b>${rainy.length} kota</b> hujan lebat`);
  }
  const bad = m.air.filter((a) => a.aqi > 150).sort((a, b) => b.aqi - a.aqi);
  if (bad.length) {
    up(1);
    items.push(`Udara tidak sehat di <b>${bad.length} kota</b>, terburuk ${esc(bad[0]!.name)} (AQI ${bad[0]!.aqi})`);
  }
  const groups = fireGroups(m.fires);
  if (m.fires.length) items.push(`<b>${m.fires.length.toLocaleString('id-ID')} titik api</b> 24 jam terakhir, terbanyak di sekitar ${esc(groups[0]![0])}`);
  const hot = m.volcanoes.filter((v) => (v.alert ?? 0) >= 3).sort((a, b) => (b.alert ?? 0) - (a.alert ?? 0));
  if (hot.length) {
    up(hot.some((v) => v.alert === 4) ? 2 : 1);
    items.push(`<b>${hot.length} gunung</b> berstatus Siaga/Awas: ${hot.map((v) => esc(v.name)).join(', ')}`);
  }
  const missing = (Object.keys(f) as FeedKey[]).filter((k) => !f[k].available);
  if (missing.length) items.push(`Data ${missing.map((k) => FEED_NAME[k]).join(', ')} belum tersedia`);

  /* ---- angka utama ---- */
  const wet = [...m.rain].sort((a, b) => b.next24 - a.next24)[0];
  const dirty = [...m.air].sort((a, b) => b.aqi - a.aqi)[0];
  const kpis: Overview['kpis'] = [
    { id: 'gempa', label: 'Gempa 24 jam', value: f.gempa.available ? String(q24.length) : '–', sub: qmax ? `Terbesar M ${num(qmax.m, 1)}` : f.gempa.available ? 'Tidak ada' : 'Data belum tersedia' },
    { id: 'banjir', label: 'Hujan terlebat', value: wet ? num(wet.next24) : '–', unit: wet ? 'mm' : undefined, sub: wet ? `${wet.name}, 24 jam ke depan` : f.cuaca.available ? 'Kering' : 'Data belum tersedia' },
    { id: 'api', label: 'Titik api', value: f.api.available ? m.fires.length.toLocaleString('id-ID') : '–', sub: f.api.available ? '24 jam terakhir' : 'Data belum tersedia' },
    { id: 'udara', label: 'Udara terburuk', value: dirty ? String(dirty.aqi) : '–', unit: dirty ? 'AQI' : undefined, sub: dirty?.name ?? 'Data belum tersedia', color: dirty?.color },
    { id: 'warga', label: 'Laporan', value: String(m.reports.length + m.community.length), sub: '3 hari terakhir' },
  ];

  /* ---- kejadian ---- */
  const ev: LiveItem[] = [];
  for (const q of m.quakes)
    ev.push({
      id: `q:${q.id}`, type: 'gempa', now: q.tsunami && now - q.t < DAY ? 2 : 0, rank: q.m, value: num(q.m, 1), unit: 'M', t: q.t, title: q.place,
      sub: q.tsunami ? 'Berpotensi tsunami (BMKG)' : `Kedalaman ${Math.round(q.depthKm)} km${q.felt ? `, dirasakan ${q.felt}` : ''}`,
      lat: q.lat, lon: q.lon, zoom: 7, ref: `gempa:${q.id}`,
    });
  for (const r of rainy)
    ev.push({
      id: `r:${r.name}`, type: 'banjir', now: r.level as 1 | 2, rank: r.next24, value: num(Math.max(r.next24, r.past24)), unit: 'mm', t: r.fetchedAt, title: r.name,
      sub: r.level === 2 ? 'Hujan sangat lebat, waspada genangan' : 'Hujan lebat', lat: r.lat, lon: r.lon, zoom: 10,
    });
  for (const a of bad)
    ev.push({
      id: `a:${a.name}`, type: 'udara', now: a.aqi > 200 ? 2 : 1, rank: a.aqi / 3, value: String(a.aqi), unit: 'AQI', t: a.fetchedAt, title: a.name,
      sub: `Udara ${a.label.toLowerCase()}${a.pm25 != null ? `, PM2.5 ${num(a.pm25, 1)} µg/m³` : ''}`, lat: a.lat, lon: a.lon, zoom: 10,
    });
  for (const v of m.volcanoes.filter((v) => (v.alert ?? 0) >= 3 || v.erupting))
    ev.push({
      id: `v:${v.code}`, type: 'gunung', now: v.alert === 4 ? 2 : 1, rank: (v.alert ?? 2) * 10, icon: 'gunung', t: f.gunung.lastSuccessAt ?? now, title: `Gunung ${v.name}`,
      sub: `${v.alert ? ALERT_NAMES[v.alert as VolcanoAlert] : 'Status belum diketahui'}${v.erupting ? ', erupsi atau abu dilaporkan' : ''}`,
      lat: v.lat, lon: v.lon, zoom: 10,
    });
  for (const c of changes)
    ev.push({
      id: `vc:${c.id}`, type: 'gunung', now: 0, rank: 0, icon: 'gunung', t: c.at.getTime(), title: `Status Gunung ${c.volcano.name} berubah`,
      sub: `${c.fromAlert ? LEVEL_NAME(c.fromAlert) : '?'} → ${c.toAlert ? LEVEL_NAME(c.toAlert) : '?'}`, lat: c.volcano.lat, lon: c.volcano.lon, zoom: 10,
    });
  for (const c of m.community)
    ev.push({
      id: `c:${c.id}`, type: COMMUNITY_TYPE[c.hazard] ?? 'warga', now: 0, rank: 0, icon: c.hazard === 'kebakaran' ? 'api' : c.hazard === 'banjir' ? 'banjir' : 'warga',
      t: c.t, title: `${COMMUNITY_TITLE[c.hazard] ?? 'Kejadian'}, ${c.city ?? where(c.lat, c.lon)}`,
      sub: c.text || 'Laporan dari PetaBencana.id', lat: c.lat, lon: c.lon, zoom: 13, ref: `komunitas:${c.id}`,
    });
  for (const [name, g] of groups.slice(0, 8))
    ev.push({
      id: `f:${name}`, type: 'api', now: 0, rank: g.n, value: g.n.toLocaleString('id-ID'), unit: 'titik', t: g.t, title: `Titik api di sekitar ${name}`,
      sub: `Terkuat ${num(g.frp)} MW`, lat: g.lat, lon: g.lon, zoom: 8,
    });
  for (const r of m.reports)
    ev.push({
      id: `w:${r.id}`, type: 'warga', now: 0, rank: 0, icon: 'warga', t: r.t, title: `${r.kind}, ${where(r.lat, r.lon)}`, sub: r.text || 'Laporan warga (sudah diperiksa)',
      lat: r.lat, lon: r.lon, zoom: 14, ref: `warga:${r.id}`,
    });
  ev.sort((a, b) => b.now - a.now || (a.now ? b.rank - a.rank : b.t - a.t));

  const counts: Record<LayerId, number> = {
    gempa: m.quakes.length,
    banjir: rainy.length + m.community.filter((c) => c.hazard === 'banjir').length,
    api: m.fires.length,
    udara: m.air.filter((a) => a.aqi > 100).length,
    gunung: m.volcanoes.filter((v) => (v.alert ?? 0) >= 2 || v.erupting).length,
    warga: m.reports.length + m.community.filter((c) => !['banjir'].includes(c.hazard)).length,
  };

  return { generatedAt: now, feeds: f, situation: { level: lv, head: HEAD[lv], items }, kpis, counts, events: ev.slice(0, 150) };
}

const LEVEL_NAME = (a: number) => ALERT_NAMES[a as VolcanoAlert] ?? `Level ${a}`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
