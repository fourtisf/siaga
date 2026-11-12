'use client';
/**
 * Halaman pantau realtime, dari prototype/siaga-terminal.html.
 * Data dari /api/overview, /api/map?mode=all, /api/sources; pembaruan didorong
 * server lewat /api/stream (SSE). Bila sambungan realtime putus, muat ulang tiap menit.
 */
import { ago, ALERT_NAMES, aqiCategory, CITIES, nearestCity, num, wib, type VolcanoAlert } from '@siaga/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, store, type LayerId, type LiveItem, type MapResponse, type Overview, type Place, type SourcesResponse, type StatusResponse } from '@/lib/api';
import { Icon, type IconName } from '@/lib/icons';
import { debounce, useLive, type LiveEvent } from '@/lib/live';
import { imageryDate, MapView, type MapHandle } from '../MapView';

const LAYERS: { id: LayerId; name: string; c: string; icon: IconName }[] = [
  { id: 'gempa', name: 'Gempa bumi', c: 'var(--gempa)', icon: 'gempa' },
  { id: 'banjir', name: 'Hujan dan banjir', c: 'var(--air)', icon: 'banjir' },
  { id: 'api', name: 'Titik api', c: 'var(--api)', icon: 'api' },
  { id: 'udara', name: 'Kualitas udara', c: 'var(--ok)', icon: 'udara' },
  { id: 'gunung', name: 'Gunung api', c: 'var(--gunung)', icon: 'gunung' },
  { id: 'warga', name: 'Laporan', c: 'var(--warga)', icon: 'warga' },
];
const COLOR: Record<LayerId, string> = { gempa: 'var(--gempa)', banjir: 'var(--air)', api: 'var(--api)', udara: 'var(--warn)', gunung: 'var(--gunung)', warga: 'var(--warga)' };
const FILT: [('semua' | LayerId), string][] = [['semua', 'Semua'], ['gempa', 'Gempa'], ['banjir', 'Banjir'], ['api', 'Api'], ['udara', 'Udara'], ['gunung', 'Gunung'], ['warga', 'Laporan']];
const SIT_COLOR = ['var(--ok)', 'var(--warn)', 'var(--bad)'];
const LV_LABEL = ['Aman', 'Waspada', 'Bahaya'];
const ALL_ON: Record<LayerId, boolean> = { gempa: true, banjir: true, api: true, udara: true, gunung: true, warga: true };

const clockF = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const hm = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false });
const mq = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 860px)').matches;

export default function PantauApp() {
  const mapH = useRef<MapHandle>(null);
  const [mapData, setMapData] = useState<MapResponse | null>(null);
  const [ov, setOv] = useState<Overview | null>(null);
  const [src, setSrc] = useState<SourcesResponse | null>(null);
  const [layers, setLayers] = useState<Record<LayerId, boolean>>(() => ({ ...ALL_ON, ...store.get('siaga.pantau.layers', {}) }));
  const [imagery, setImagery] = useState<boolean>(() => store.get('siaga.pantau.img', false));
  const [filter, setFilter] = useState<'semua' | LayerId>('semua');
  const [tab, setTab] = useState<'kejadian' | 'lokasi'>('kejadian');
  const [sheet, setSheetState] = useState<'' | 'kejadian' | 'lokasi' | 'layer'>('');
  const [pop, setPop] = useState(false);
  const [places, setPlaces] = useState<Place[]>(() => store.get('siaga.places', []));
  const [pst, setPst] = useState<Record<string, StatusResponse>>({});
  const [picking, setPicking] = useState<null | { text: string; cb: (lat: number, lon: number) => void }>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(false);
  const [pName, setPName] = useState('');
  const [q, setQ] = useState('');
  const [toastMsg, setToastMsg] = useState('');
  const [toastOn, setToastOn] = useState(false);
  const toastT = useRef<ReturnType<typeof setTimeout>>();
  const prevIds = useRef<Set<string> | null>(null);

  const toast = useCallback((m: string, ms = 3200) => {
    setToastMsg(m);
    setToastOn(true);
    clearTimeout(toastT.current);
    toastT.current = setTimeout(() => setToastOn(false), ms);
  }, []);

  const setSheet = (s: typeof sheet) => {
    setSheetState(s);
    document.body.dataset.sheet = s;
    if (s === 'kejadian' || s === 'lokasi') setTab(s);
  };

  /* ---------- muat data ---------- */
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [m, o, s] = await Promise.all([api.map('all', null), api.overview(), api.sources()]);
      setMapData(m);
      setSrc(s);
      setOv(o);
      // tandai kejadian yang baru muncul sejak pemuatan sebelumnya
      const ids = new Set(o.events.map((e) => e.id));
      if (prevIds.current) {
        const added = [...ids].filter((id) => !prevIds.current!.has(id));
        if (added.length) {
          setFresh(new Set(added));
          setTimeout(() => setFresh(new Set()), 3000);
        }
      }
      prevIds.current = ids;
    } catch {
      /* tetap tampilkan data terakhir */
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshPlaces = useCallback(async (list: Place[]) => {
    const res = await Promise.all(list.map((p) => api.status(p).catch(() => null)));
    setPst(Object.fromEntries(list.flatMap((p, i) => (res[i] ? [[p.id, res[i]!]] : []))));
  }, []);

  const soon = useMemo(() => debounce(() => void refresh(), 1500), [refresh]);
  const soonPlaces = useMemo(() => debounce((l: Place[]) => void refreshPlaces(l), 2500), [refreshPlaces]);
  const placesRef = useRef(places);
  placesRef.current = places;

  const connected = useLive((ev: LiveEvent) => {
    if (ev.type === 'feed') {
      soon();
      if (ev.key !== 'banjir') soonPlaces(placesRef.current);
    } else if (ev.type === 'quake') {
      const qk = ev.quake;
      toast(`${qk.tsunami ? 'BMKG: berpotensi tsunami. ' : ''}Gempa baru M ${num(qk.m, 1)}, ${qk.place}`, 8000);
      soon();
      soonPlaces(placesRef.current);
    } else if (ev.type === 'volcano') {
      toast(`Status Gunung ${ev.name}: ${ev.to ? ALERT_NAMES[ev.to as VolcanoAlert] : 'tidak diketahui'}`, 8000);
      soon();
    } else if (ev.type === 'report') {
      soon();
    }
  });

  useEffect(() => {
    void refresh();
    // cadangan bila realtime putus: muat ulang tiap menit; bila tersambung, tiap 5 menit saja
    const t = setInterval(() => !document.hidden && refresh(), connected ? 300_000 : 60_000);
    return () => clearInterval(t);
  }, [refresh, connected]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const list = await api.places();
        setPlaces(list);
        store.set('siaga.places', list);
        void refreshPlaces(list);
      } catch {
        void refreshPlaces(placesRef.current);
      }
    })();
  }, [refreshPlaces]);

  useEffect(() => store.set('siaga.pantau.layers', layers), [layers]);
  useEffect(() => store.set('siaga.pantau.img', imagery), [imagery]);
  useEffect(() => {
    document.body.classList.toggle('picking', !!picking);
  }, [picking]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setPop(false);
      setPicking(null);
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, []);

  /* ---------- aksi ---------- */
  const go = (e: { lat: number; lon: number; zoom: number; ref?: string }) => {
    if (mq()) setSheet('');
    mapH.current?.show(e.lat, e.lon, e.zoom, e.ref);
  };
  const goCity = (v: string) => {
    const s = v.trim().toLowerCase();
    if (!s) return;
    const c = CITIES.find((c) => c.name.toLowerCase() === s) ?? CITIES.find((c) => c.name.toLowerCase().startsWith(s));
    if (!c) return toast('Kota tidak ditemukan');
    mapH.current?.show(c.lat, c.lon, 10);
    setQ(c.name);
  };
  const pick = (text: string, cb: (lat: number, lon: number) => void) => {
    if (mq()) setSheet('');
    setPicking({ text, cb });
  };
  const gps = (cb: (lat: number, lon: number) => void) => {
    if (!navigator.geolocation) return toast('Perangkat ini tidak mendukung lokasi');
    toast('Mencari lokasi Anda');
    navigator.geolocation.getCurrentPosition((p) => cb(p.coords.latitude, p.coords.longitude), () => toast('Izin lokasi ditolak'), { timeout: 10_000 });
  };
  const addPlace = async (lat: number, lon: number) => {
    const n = nearestCity(lat, lon);
    const name = pName.trim() || (n.km < 25 ? n.name : `Lokasi ${places.length + 1}`);
    try {
      const p = await api.addPlace({ name, lat: +lat.toFixed(4), lon: +lon.toFixed(4) });
      const list = [...places, p];
      setPlaces(list);
      store.set('siaga.places', list);
      setPName('');
      setTab('lokasi');
      if (mq()) setSheet('lokasi');
      toast(`${name} dipantau`);
      void refreshPlaces(list);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Gagal menyimpan lokasi');
    }
  };
  const delPlace = async (p: Place) => {
    try {
      await api.delPlace(p.id);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) return toast('Gagal menghapus');
    }
    const list = places.filter((x) => x.id !== p.id);
    setPlaces(list);
    store.set('siaga.places', list);
    toast(`${p.name} dihapus`);
  };

  /* ---------- turunan ---------- */
  const feeds = src?.feeds ?? [];
  const live = feeds.filter((f) => f.available).length;
  const events = ov?.events ?? [];
  const shown = events.filter((e) => filter === 'semua' || e.type === filter);
  let ongoing = shown.filter((e) => e.now > 0);
  if (filter === 'semua') ongoing = ongoing.slice(0, 6);
  const log = shown.filter((e) => e.now === 0).slice(0, 80);
  const imgDate = imageryDate(new Date(now));

  const evRow = (e: LiveItem) => {
    const c = e.type === 'udara' && e.value ? aqiCategory(Number(e.value)).color : COLOR[e.type];
    return (
      <button key={e.id} className={`ev${fresh.has(e.id) ? ' fresh' : ''}`} style={{ ['--c' as string]: c }} onClick={() => go(e)}>
        <div className="ic">
          {e.value ? (
            <>
              <b>{e.value}</b>
              <small>{e.unit}</small>
            </>
          ) : (
            <Icon n={(e.icon as IconName) ?? 'warga'} />
          )}
        </div>
        <div className="bd">
          <b>{e.title}</b>
          <span>{e.sub}</span>
        </div>
        <div className="tm">{e.now ? 'sekarang' : ago(e.t, now).replace(' lalu', '')}</div>
      </button>
    );
  };

  return (
    <>
      <MapView
        ref={mapH}
        data={mapData}
        place={null}
        places={places}
        fitPadding={mq() ? { tl: [10, 150], br: [10, 74] } : { tl: [270, 70], br: [400, 100] }}
        picking={!!picking}
        onPick={(lat, lon) => {
          const p = picking;
          setPicking(null);
          p?.cb(lat, lon);
        }}
        layers={layers}
        imagery={imagery ? imgDate : null}
      />

      <div className="fl tl">
        <div className="brand">
          <svg viewBox="0 0 28 28" fill="none" aria-hidden="true">
            <circle cx="14" cy="14" r="12.5" stroke="#f1f5f2" strokeOpacity=".28" />
            <circle cx="14" cy="14" r="7.5" stroke="#f1f5f2" strokeOpacity=".55" />
            <path d="M14 14 23 5.5" stroke="#f1f5f2" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="14" cy="14" r="2.6" fill="#f1f5f2" />
            <circle cx="20.2" cy="18.6" r="1.7" fill="#ff7a9c" />
          </svg>
          <b>SIAGA</b>
        </div>
        <div className="search">
          <Icon n="search" />
          <input
            list="kota"
            placeholder="Cari kota"
            autoComplete="off"
            aria-label="Cari kota"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              if (CITIES.some((c) => c.name === e.target.value)) goCity(e.target.value);
            }}
            onKeyDown={(e) => e.key === 'Enter' && goCity(q)}
          />
          <datalist id="kota">
            {CITIES.map((c) => (
              <option key={c.name} value={c.name} />
            ))}
          </datalist>
        </div>
      </div>

      <div className="fl tr">
        <span className={`livechip${connected ? ' on' : ''}`} title={connected ? 'Pembaruan realtime tersambung' : 'Realtime terputus, memuat ulang tiap menit'}>
          <i />
          <span>{connected ? 'LIVE' : 'LURING'}</span>
        </span>
        <button className={`stat ${feeds.length && live === feeds.length ? 'live' : live ? 'part live' : 'part'}`} onClick={() => setPop((v) => !v)} aria-label="Status sumber data">
          <u />
          <b>
            {live}/{feeds.length || 6}
          </b>
          <span>sumber live</span>
        </button>
        <div className="clock">
          <span>{clockF.format(now)}</span>
          <small>WIB</small>
        </div>
        <button className={`ib${loading ? ' spin' : ''}`} onClick={() => void refresh()} aria-label="Segarkan data">
          <Icon n="refresh" />
        </button>
      </div>

      <div className={`fl pop${pop ? ' on' : ''}`}>
        <h3>Sumber data</h3>
        <p>
          {connected ? 'Pembaruan realtime tersambung: kejadian baru langsung tampil.' : 'Realtime terputus. Data dimuat ulang tiap menit.'} Sumber yang gagal tidak diganti data
          simulasi.
        </p>
        {feeds.map((f) => {
          const state = f.available ? 'live' : f.lastSuccessAt ? 'stale' : 'dead';
          return (
            <div className="srow" key={f.key}>
              <div>
                <b>{f.label}</b>
                <span>
                  {f.source ?? 'belum ada data'}, tiap {Math.round(f.everyMs / 60_000)} menit
                </span>
                {!f.available && f.error && <span className="err">{f.error.slice(0, 90)}</span>}
              </div>
              <i className={`pill ${state}`} style={{ fontStyle: 'normal' }}>
                {state === 'live' ? `Live ${hm.format(f.lastSuccessAt!)}` : state === 'stale' ? `Terakhir ${hm.format(f.lastSuccessAt!)}` : 'Mati'}
              </i>
            </div>
          );
        })}
        <p style={{ marginTop: 8 }}>{src?.attribution.map((a) => a.text.replace(/^Sumber: /, '')).join(' · ')}</p>
      </div>

      <div className="fl dock">
        <div className="grab" />
        <div className="only-m">Layer peta</div>
        {LAYERS.map((l) => (
          <button
            key={l.id}
            className={`ly${layers[l.id] ? ' on' : ''}`}
            style={{ ['--c' as string]: l.c }}
            aria-pressed={layers[l.id]}
            onClick={() => setLayers((s) => ({ ...s, [l.id]: !s[l.id] }))}
          >
            <span className="ig">
              <Icon n={l.icon} />
            </span>
            <span className="nm">{l.name}</span>
            <span className="ct">{ov ? ov.counts[l.id].toLocaleString('id-ID') : '–'}</span>
            <span className="tg" />
          </button>
        ))}
        <div className="sep" />
        <button className={`ly img${imagery ? ' on' : ''}`} aria-pressed={imagery} onClick={() => setImagery((v) => !v)}>
          <span className="ig">
            <Icon n="sat" />
          </span>
          <span className="nm">
            Citra satelit
            <small>NASA, {imgDate}</small>
          </span>
          <span className="tg" />
        </button>
      </div>

      <div className="fl ctl">
        <button className="ib zm" aria-label="Perbesar" onClick={() => mapH.current?.zoom(1)}>
          <Icon n="plus" />
        </button>
        <button className="ib zm" aria-label="Perkecil" onClick={() => mapH.current?.zoom(-1)}>
          <Icon n="minus" />
        </button>
        <button className="ib" aria-label="Lihat seluruh Indonesia" onClick={() => mapH.current?.home()}>
          <Icon n="expand" />
        </button>
        <button
          className="ib"
          aria-label="Ke lokasi saya"
          onClick={() => (places[0] ? mapH.current?.show(places[0].lat, places[0].lon, 9) : gps((la, lo) => mapH.current?.show(la, lo, 10)))}
        >
          <Icon n="gps" />
        </button>
      </div>

      <div className="fl pick">
        <span>{picking?.text ?? 'Ketuk lokasi di peta'}</span>
        <button onClick={() => setPicking(null)}>Batal</button>
      </div>

      <div className="fl rib">
        {(ov?.kpis ?? []).map((k) => (
          <button
            key={k.id}
            className="kp"
            style={{ ['--c' as string]: k.color ?? COLOR[k.id] }}
            onClick={() => {
              setFilter(k.id);
              setTab('kejadian');
              if (mq()) setSheet('kejadian');
            }}
          >
            <small>
              <i />
              {k.label}
            </small>
            <b>
              {k.value}
              {k.unit && <em>{k.unit}</em>}
            </b>
            <span>{k.sub}</span>
          </button>
        ))}
      </div>

      <aside className="fl side">
        <div className="grab" />
        <div className="seg">
          <button className={tab === 'kejadian' ? 'on' : ''} onClick={() => setTab('kejadian')}>
            Kejadian
          </button>
          <button className={tab === 'lokasi' ? 'on' : ''} onClick={() => setTab('lokasi')}>
            Lokasi saya
          </button>
        </div>
        <div className={`tab${tab === 'kejadian' ? ' on' : ''}`}>
          <div className="only-m">Kejadian</div>
          {ov && (
            <div className="sit" style={{ ['--c' as string]: SIT_COLOR[ov.situation.level] }}>
              <h2>
                <i />
                {ov.situation.head}
                <small>{hm.format(ov.generatedAt)}</small>
              </h2>
              <ul>
                {ov.situation.items.map((x, i) => (
                  // teks dari server, nama tempat sudah di-escape di server
                  <li key={i} dangerouslySetInnerHTML={{ __html: x }} />
                ))}
              </ul>
            </div>
          )}
          <div className="filt">
            {FILT.map(([id, label]) => (
              <button key={id} className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>
                {label}
              </button>
            ))}
          </div>
          <div className="scroll">
            {ongoing.length > 0 && <div className="sec">Sedang berlangsung</div>}
            {ongoing.map(evRow)}
            {log.length > 0 && <div className="sec">Terbaru</div>}
            {log.map(evRow)}
            {ov && !ongoing.length && !log.length && (
              <div className="empty">
                <Icon n="ok" />
                <br />
                Tidak ada kejadian untuk filter ini.
              </div>
            )}
            {!ov && <div className="empty">Memuat kejadian…</div>}
          </div>
        </div>
        <div className={`tab${tab === 'lokasi' ? ' on' : ''}`}>
          <div className="only-m">Lokasi saya</div>
          <div className="scroll">
            {places.map((p) => {
              const s = pst[p.id];
              const lv = s?.level;
              return (
                <div key={p.id} className={`pl w${lv ?? 0}`}>
                  <div className="hd">
                    <b onClick={() => go({ lat: p.lat, lon: p.lon, zoom: 10 })}>{p.name}</b>
                    {s ? <span className="st">{lv == null ? 'Belum ada data' : LV_LABEL[lv]}</span> : <small>memuat…</small>}
                    <button className="x" aria-label={`Hapus ${p.name}`} onClick={() => void delPlace(p)}>
                      <Icon n="x" />
                    </button>
                  </div>
                  {s && (
                    <ul>
                      {s.conditions.map((c) => (
                        <li key={c.kind} className={c.level ? `l${c.level}` : ''}>
                          <i style={c.level == null ? { background: 'var(--dim)' } : undefined} />
                          <span>
                            {c.head}
                            {c.available && c.rows[0] ? (
                              <>
                                {' · '}
                                <b>{c.rows[0][1]}</b>
                              </>
                            ) : null}
                            {!c.available ? ` (${c.act.replace(/\.$/, '').toLowerCase()})` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
            {!places.length && (
              <div className="empty">
                <Icon n="warga" />
                <br />
                Simpan kantor, gudang, atau wilayah yang Anda pantau. Statusnya diperbarui otomatis.
              </div>
            )}
            <div className="form">
              <h4>Tambah lokasi</h4>
              <input placeholder="Nama lokasi, misalnya Gudang Cikarang" maxLength={60} aria-label="Nama lokasi" value={pName} onChange={(e) => setPName(e.target.value)} />
              <div className="btns">
                <button className="btn" onClick={() => pick('Ketuk lokasi yang ingin dipantau', (la, lo) => void addPlace(la, lo))}>
                  <Icon n="pin" />
                  Pilih di peta
                </button>
                <button className="btn" onClick={() => gps((la, lo) => void addPlace(la, lo))}>
                  <Icon n="gps" />
                  Lokasi saya
                </button>
              </div>
            </div>
            <p className="note">
              Lokasi yang sama tampil di aplikasi warga. Nyalakan peringatan otomatis di <a href="/" style={{ color: 'var(--air)' }}>aplikasi warga</a>.
              {ov && ` Data terakhir dihitung ${wib(ov.generatedAt)}.`}
            </p>
          </div>
        </div>
      </aside>

      <nav className="mnav">
        {(
          [
            ['', 'Peta', 'map'],
            ['kejadian', 'Kejadian', 'gempa'],
            ['lokasi', 'Lokasi', 'pin'],
            ['layer', 'Layer', 'layers'],
          ] as const
        ).map(([s, label, icon]) => (
          <button key={s} className={sheet === s ? 'on' : ''} onClick={() => setSheet(sheet === s ? '' : s)}>
            <Icon n={icon} />
            {label}
          </button>
        ))}
      </nav>
      <div className={`fl toast${toastOn ? ' on' : ''}`} role="status" aria-live="polite">
        {toastMsg}
      </div>
    </>
  );
}
