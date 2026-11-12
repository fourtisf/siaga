'use client';
/**
 * Peta Leaflet, dipindahkan dari prototipe. Data datang dari GET /api/map;
 * browser tidak lagi memanggil sumber luar.
 */
import { ALERT_NAMES, CITIES, num, where, wib, type VolcanoAlert } from '@siaga/core';
import L from 'leaflet';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { MapResponse, Place } from '@/lib/api';
import { esc, iconHtml, KIND_ICON } from '@/lib/icons';

export interface MapHandle {
  show(lat: number, lon: number, zoom: number, ref?: string): void;
  home(): void;
  focusPlace(anim: boolean): void;
  invalidate(): void;
  zoom(delta: number): void;
}

/** Layer peta yang bisa dinyalakan/dimatikan (halaman pantau). */
export type LayerId = 'gempa' | 'banjir' | 'api' | 'udara' | 'gunung' | 'warga';

interface Props {
  data: MapResponse | null;
  place: Place | null;
  /** Semua lokasi pantauan (halaman pantau). Bila kosong, hanya `place` yang ditandai. */
  places?: Place[];
  picking: boolean;
  onPick(lat: number, lon: number): void;
  /** Layer yang tampil. Tidak diisi = semua tampil. */
  layers?: Partial<Record<LayerId, boolean>>;
  /** Tanggal citra satelit NASA GIBS (YYYY-MM-DD), null = mati */
  imagery?: string | null;
  /** Ruang yang tertutup panel saat menampilkan seluruh Indonesia: [kiri-atas], [kanan-bawah] dalam px */
  fitPadding?: { tl: [number, number]; br: [number, number] };
}

/**
 * Citra harian VIIRS NOAA-20 dari NASA GIBS. Citra hari ini baru lengkap untuk seluruh
 * Indonesia beberapa jam setelah lintasan siang (pukul 09.00 UTC bagian barat masih kosong),
 * jadi sebelum 14.00 UTC (21.00 WIB) dipakai citra kemarin.
 */
export function imageryDate(now = new Date()): string {
  const d = new Date(now.getTime() - (now.getUTCHours() < 14 ? 864e5 : 0));
  return d.toISOString().slice(0, 10);
}

/** Laporan PetaBencana masuk ke layer sesuai jenisnya */
const COMMUNITY_LAYER: Record<string, LayerId> = { banjir: 'banjir', kebakaran: 'api', gunung: 'gunung', gempa: 'gempa' };

const SEAS: [string, number, number][] = [
  ['Samudra Hindia', -9.6, 101.5], ['Laut Jawa', -5.2, 111.6], ['Laut Banda', -6, 127.2], ['Laut Natuna', 3.9, 107.6],
  ['Samudra Pasifik', 4.2, 134.5], ['Laut Arafura', -9.4, 134.5], ['Laut Sulawesi', 3.6, 121.5],
];
const ID_BOUNDS: L.LatLngBoundsExpression = [[-11, 95], [6, 141]];

const HAZARD: Record<string, { k: string; c: string }> = {
  banjir: { k: 'Laporan banjir', c: 'var(--air)' },
  kebakaran: { k: 'Laporan kebakaran', c: 'var(--api)' },
  gempa: { k: 'Laporan gempa', c: 'var(--gempa)' },
  angin: { k: 'Laporan angin kencang', c: 'var(--mut)' },
  gunung: { k: 'Laporan gunung api', c: 'var(--gunung)' },
  asap: { k: 'Laporan kabut asap', c: 'var(--warn)' },
  lainnya: { k: 'Laporan', c: 'var(--warga)' },
};
const HAZARD_FILL: Record<string, string> = { banjir: '#5cc8ff', kebakaran: '#ff6a3d', gempa: '#ff7a9c', angin: '#8ba5ab', gunung: '#ffa36b', asap: '#ffb86b', lainnya: '#b7a6ff' };

type Row = [string, string] | null | false | undefined;
const pop = (k: string, c: string, title: string, say: string, rows: Row[], o: { img?: string | null; extra?: string; src?: string } = {}) =>
  `<div class="pp" style="--c:${c}"><div class="k">${esc(k)}</div><h4>${esc(title)}</h4>${say ? `<p>${esc(say)}</p>` : ''}` +
  `${o.img ? `<img src="${esc(o.img)}" alt="Foto laporan" loading="lazy">` : ''}` +
  `<table>${rows.filter((r): r is [string, string] => !!r).map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td></tr>`).join('')}</table>` +
  `${o.extra ? `<div class="ft">${o.extra}</div>` : ''}${o.src ? `<div class="src">Sumber: ${esc(o.src)}</div>` : ''}</div>`;

const div = (html: string, w: number, h: number, ax: number, ay: number, pa?: [number, number]) =>
  L.divIcon({ className: '', html, iconSize: [w, h], iconAnchor: [ax, ay], popupAnchor: pa ?? [0, -ay + 2] });

const RAIN_SAY = ['Hujan ringan.', 'Hujan lebat. Bawa jas hujan dan hindari jalan yang biasa tergenang.', 'Hujan sangat lebat. Waspada banjir.'];

export const MapView = forwardRef<MapHandle, Props>(function MapView({ data, place, places, picking, onPick, layers, imagery, fitPadding }, ref) {
  const fitRef = useRef(fitPadding);
  fitRef.current = fitPadding;
  const fitOpts = (): L.FitBoundsOptions =>
    fitRef.current ? { paddingTopLeft: fitRef.current.tl, paddingBottomRight: fitRef.current.br } : { padding: [20, 60] };
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const groups = useRef<Record<string, L.LayerGroup>>({});
  const markers = useRef(new Map<string, L.Layer>());
  const imgLayer = useRef<L.TileLayer | null>(null);
  const placeRef = useRef<Place | null>(place);
  const pickRef = useRef({ picking, onPick });
  placeRef.current = place;
  pickRef.current = { picking, onPick };

  // ---- inisialisasi sekali ----
  useEffect(() => {
    if (!el.current || mapRef.current) return;
    const map = L.map(el.current, { zoomControl: false, preferCanvas: true, minZoom: 4, maxZoom: 15, zoomSnap: 0.25 }).setView([-2.4, 118], 5);
    mapRef.current = map;
    map.attributionControl.setPrefix('');
    map.attributionControl.addAttribution('Data: BMKG, Open-Meteo, NASA FIRMS, MAGMA, PetaBencana.id');
    map.createPane('base').style.zIndex = '150';
    map.createPane('imagery').style.zIndex = '250'; // di atas peta dasar, tanpa filter warna ubin
    map.createPane('names').style.zIndex = '350';
    map.getPane('names')!.style.pointerEvents = 'none';
    const grat: L.LatLngExpression[][] = [];
    for (let x = 90; x <= 145; x += 5) grat.push([[-20, x], [15, x]]);
    for (let y = -20; y <= 15; y += 5) grat.push([[y, 85], [y, 150]]);
    L.polyline(grat, { pane: 'base', interactive: false, color: '#9fd0d6', weight: 0.5, opacity: 0.07 }).addTo(map);
    fetch('/geo/indonesia.json')
      .then((r) => r.json())
      .then((geo) => {
        L.geoJSON(geo, { pane: 'base', interactive: false, filter: (f) => !!f.properties?.id, style: { color: '#6fa3aa', weight: 6, opacity: 0.08, fill: false } }).addTo(map);
        L.geoJSON(geo, {
          pane: 'base',
          interactive: false,
          style: (f) =>
            f?.properties?.id
              ? { color: '#6fa3aa', weight: 1, fillColor: '#16343f', fillOpacity: 1 }
              : { color: '#24454f', weight: 0.7, fillColor: '#0d2731', fillOpacity: 1 },
        }).addTo(map);
      })
      .catch(() => undefined);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
      minZoom: 8,
      maxZoom: 15,
      attribution: '&copy; OpenStreetMap &copy; CARTO',
    }).addTo(map);
    for (const k of ['banjir', 'api', 'gempa', 'udara', 'gunung', 'warga', 'place']) groups.current[k] = L.layerGroup().addTo(map);
    const labels = L.layerGroup().addTo(map);
    const txt = (cls: string, html: string, lat: number, lon: number, anchor?: [number, number]) =>
      L.marker([lat, lon], { pane: 'names', interactive: false, icon: L.divIcon({ className: '', html: `<div class="${cls}">${esc(html)}</div>`, iconSize: [0, 0], iconAnchor: anchor ?? [0, 0] }) });
    const names = () => {
      labels.clearLayers();
      const z = map.getZoom();
      if (z < 7.5) SEAS.forEach((s) => txt('sl', s[0], s[1], s[2]).addTo(labels));
      if (z >= 6 && z < 8) CITIES.forEach((c) => txt('cl', c.name, c.lat, c.lon, [-9, 8]).addTo(labels));
    };
    map.on('zoomend', names);
    names();

    // Mode pilih titik: tangkap klik sebelum Leaflet (sama dengan prototipe)
    let pd: [number, number] | null = null;
    const mc = map.getContainer();
    const down = (e: PointerEvent) => (pd = [e.clientX, e.clientY]);
    const click = (e: MouseEvent) => {
      if (!pickRef.current.picking) return;
      e.stopPropagation();
      e.preventDefault();
      if (pd && Math.hypot(e.clientX - pd[0], e.clientY - pd[1]) > 8) return;
      const ll = map.mouseEventToLatLng(e);
      pickRef.current.onPick(ll.lat, ll.lng);
    };
    mc.addEventListener('pointerdown', down, true);
    mc.addEventListener('click', click, true);
    const p = placeRef.current;
    if (p) map.setView([p.lat, p.lon], 8.5);
    else map.fitBounds(ID_BOUNDS, fitOpts());
    const onResize = () => map.invalidateSize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      mc.removeEventListener('pointerdown', down, true);
      mc.removeEventListener('click', click, true);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useImperativeHandle(ref, () => ({
    show(lat, lon, zoom, key) {
      const map = mapRef.current;
      if (!map) return;
      map.flyTo([lat, lon], zoom, { duration: 0.8 });
      if (key)
        setTimeout(() => {
          const m = markers.current.get(key) as L.Marker | undefined;
          if (m && map.hasLayer(m)) m.openPopup();
        }, 900);
    },
    home() {
      mapRef.current?.flyToBounds(ID_BOUNDS, { ...fitOpts(), duration: 0.6 });
    },
    focusPlace(anim) {
      const map = mapRef.current, p = placeRef.current;
      if (!map) return;
      if (!p) return void map.fitBounds(ID_BOUNDS, fitOpts());
      if (anim) map.flyTo([p.lat, p.lon], 8.5, { duration: 0.7 });
      else map.setView([p.lat, p.lon], 8.5);
    },
    invalidate() {
      setTimeout(() => mapRef.current?.invalidateSize(), 0);
    },
    zoom(delta) {
      const map = mapRef.current;
      if (map) map.setZoom(map.getZoom() + delta);
    },
  }));

  // ---- layer tampil/sembunyi ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const k of ['gempa', 'banjir', 'api', 'udara', 'gunung', 'warga'] as LayerId[]) {
      const g = groups.current[k];
      if (!g) continue;
      const on = !layers || layers[k] !== false;
      if (on && !map.hasLayer(g)) g.addTo(map);
      if (!on && map.hasLayer(g)) map.removeLayer(g);
    }
  }, [layers]);

  // ---- citra satelit harian ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    imgLayer.current?.remove();
    imgLayer.current = null;
    if (!imagery) return;
    imgLayer.current = L.tileLayer(
      `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/${imagery}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
      { pane: 'imagery', maxNativeZoom: 9, maxZoom: 15, attribution: `Citra satelit: NASA GIBS, VIIRS NOAA-20, ${imagery}` },
    ).addTo(map);
  }, [imagery]);

  // ---- penanda lokasi pantauan ----
  useEffect(() => {
    const g = groups.current.place;
    if (!g) return;
    g.clearLayers();
    const list = places?.length ? places : place ? [place] : [];
    for (const p of list)
      L.marker([p.lat, p.lon], { zIndexOffset: 1000, icon: div('<div class="pm"></div>', 20, 20, 10, 10) })
        .bindTooltip(esc(p.name), { direction: 'top', offset: [0, -12] })
        .addTo(g);
  }, [place, places]);

  // ---- data ----
  useEffect(() => {
    const G = groups.current;
    if (!G.gempa || !data) return;
    Object.entries(G).forEach(([k, g]) => k !== 'place' && g.clearLayers());
    markers.current.clear();
    const now = Date.now();
    const canvas = L.canvas({ padding: 0.3 });

    for (const q of data.quakes) {
      const sz = Math.max(14, Math.round(Math.pow(1.55, q.m - 1) * 3.8));
      const fresh = now - q.t < 3600_000;
      const m = L.marker([q.lat, q.lon], {
        zIndexOffset: fresh ? 900 : Math.round(q.m * 10),
        icon: div(`<div class="qk${fresh ? ' new' : ''}" style="width:${sz}px;height:${sz}px">${sz >= 22 ? num(q.m, 1) : ''}</div>`, sz, sz, sz / 2, sz / 2),
      })
        .bindPopup(
          pop('Gempa bumi', 'var(--gempa)', `Magnitudo ${num(q.m, 1)}`, q.place, [
            ['Waktu', wib(q.t)],
            ['Kedalaman', `${Math.round(q.depthKm)} km`],
            q.felt ? ['Dirasakan', q.felt] : null,
            q.potential ? ['Potensi', q.potential] : null,
          ], { src: q.src }),
        )
        .addTo(G.gempa);
      markers.current.set(`gempa:${q.id}`, m);
    }

    for (const r of data.rain) {
      const mm = Math.max(r.next24, r.past24);
      const sz = Math.min(120, Math.round(30 + Math.sqrt(mm) * 8));
      L.marker([r.lat, r.lon], { zIndexOffset: -500, icon: div(`<div class="rn l${r.level}" style="width:${sz}px;height:${sz}px"></div>`, sz, sz, sz / 2, sz / 2, [0, -8]) })
        .bindPopup(
          pop('Hujan', 'var(--air)', r.name, RAIN_SAY[r.level] ?? '', [
            ['24 jam ke depan', `${num(r.next24)} mm`],
            ['24 jam terakhir', `${num(r.past24)} mm`],
            ['Saat ini', `${num(r.now, 1)} mm/jam`],
            ['Diperbarui', wib(r.fetchedAt)],
          ], { extra: 'Dihitung dari curah hujan, bukan ukuran tinggi air.', src: 'Open-Meteo' }),
        )
        .addTo(G.banjir);
    }

    for (const c of data.community) {
      const h = HAZARD[c.hazard] ?? HAZARD.lainnya!;
      const m = L.circleMarker([c.lat, c.lon], { renderer: canvas, radius: 6, color: '#06161f', weight: 2, fillColor: HAZARD_FILL[c.hazard] ?? '#b7a6ff', fillOpacity: 1 })
        .bindPopup(
          pop(h.k, h.c, c.city ?? where(c.lat, c.lon), c.text.slice(0, 160), [['Waktu', wib(c.t)], c.depthCm ? ['Kedalaman air', `${c.depthCm} cm`] : null], {
            img: c.imageUrl,
            src: 'PetaBencana.id',
          }),
        )
        .addTo(G[COMMUNITY_LAYER[c.hazard] ?? 'warga']!);
      markers.current.set(`komunitas:${c.id}`, m);
    }

    for (const f of data.fires) {
      const r = f.frp > 40 ? 3.6 : f.frp > 12 ? 2.8 : 2.1;
      L.circleMarker([f.lat, f.lon], { renderer: canvas, interactive: false, radius: r * 2.6, stroke: false, fillColor: '#ff6a3d', fillOpacity: 0.13 }).addTo(G.api);
      L.circleMarker([f.lat, f.lon], { renderer: canvas, radius: r, stroke: false, fillColor: f.frp > 40 ? '#ffe0b8' : '#ff8a52', fillOpacity: 0.95 })
        .bindPopup(
          pop('Titik api', 'var(--api)', where(f.lat, f.lon), 'Terdeteksi satelit. Bisa berupa kebakaran lahan atau pembakaran terbuka.', [
            ['Terdeteksi', wib(f.t)],
            ['Kekuatan', `${num(f.frp)} MW`],
            ['Satelit', f.sat],
          ], { src: 'NASA FIRMS' }),
        )
        .addTo(G.api);
    }

    for (const a of data.air) {
      const w = a.aqi > 99 ? 40 : 34;
      L.marker([a.lat, a.lon], { zIndexOffset: a.aqi, icon: div(`<div class="aqm" style="--c:${a.color}"><i></i>${a.aqi}</div>`, w, 19, w / 2, 28, [0, -26]) })
        .bindPopup(
          pop('Kualitas udara', a.color, a.name, a.label, [
            ['Indeks (AQI)', String(a.aqi)],
            a.pm25 != null ? ['PM2.5', `${num(a.pm25, 1)} µg/m³`] : null,
            ['Diperbarui', wib(a.fetchedAt)],
          ], { extra: 'Hasil model atmosfer, bukan sensor di lokasi.', src: 'Open-Meteo (CAMS)' }),
        )
        .addTo(G.udara);
    }

    for (const v of data.volcanoes) {
      const active = (v.alert ?? 0) >= 2 || v.erupting || v.satellite;
      const lv = v.alert ?? (active ? 2 : 1);
      const say = v.erupting
        ? 'Erupsi atau abu vulkanik dilaporkan baru-baru ini.'
        : v.satellite
          ? 'Aktivitas terpantau satelit.'
          : (v.alert ?? 1) >= 2
            ? 'Ikuti rekomendasi resmi PVMBG.'
            : 'Tidak ada laporan aktivitas baru.';
      L.marker([v.lat, v.lon], {
        zIndexOffset: active ? 800 : 0,
        icon: div(`<div class="vol lv${lv}${v.erupting ? ' act' : ''}"><svg viewBox="0 0 16 14"><path d="M8 1.5 15 13H1z"/></svg></div>`, 16, 14, 8, 11),
      })
        .bindPopup(
          pop('Gunung api', 'var(--gunung)', `Gunung ${v.name}`, say, [
            v.alert ? ['Status resmi', ALERT_NAMES[v.alert as VolcanoAlert]] : null,
            ['Lokasi', where(v.lat, v.lon)],
          ], { extra: 'Status dan radius bahaya resmi: <a href="https://magma.esdm.go.id" target="_blank" rel="noopener">MAGMA Indonesia</a>.', src: v.src === 'MAGMA' ? 'MAGMA (PVMBG)' : 'NASA EONET' }),
        )
        .addTo(G.gunung);
    }

    for (const r of data.reports) {
      const m = L.marker([r.lat, r.lon], { zIndexOffset: 700, icon: div(`<div class="rp">${iconHtml(KIND_ICON[r.kind] ?? 'banjir')}</div>`, 28, 28, 3, 28, [11, -28]) })
        .bindPopup(pop('Laporan warga', 'var(--warga)', r.kind, r.text, [['Waktu', wib(r.t)], ['Lokasi', where(r.lat, r.lon)]], { img: r.photoUrl, extra: 'Sudah diperiksa moderator SIAGA.' }))
        .addTo(G.warga);
      markers.current.set(`warga:${r.id}`, m);
    }
  }, [data]);

  return <div id="map" ref={el} />;
});
