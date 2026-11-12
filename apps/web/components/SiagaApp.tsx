'use client';
/**
 * Aplikasi warga: Status, Peta, Lapor. Struktur dan kelas CSS mengikuti
 * prototype/siaga-app.html. Semua data dari API SIAGA (/api/...).
 */
import { nearestCity, type CitizenReport, type Condition, type Level, type NearbyEvent } from '@siaga/core';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api, ApiError, store, type AlertConfig, type MapResponse, type Place, type StatusResponse } from '@/lib/api';
import { Icon } from '@/lib/icons';
import { currentPushEndpoint, registerSW, subscribePush, unsubscribePush } from '@/lib/push';
import { LaporView } from './LaporView';
import { MapView, type MapHandle } from './MapView';
import { AlertsSheet, PlacesSheet, Sheet } from './Sheets';
import { StatusView } from './StatusView';

type View = 'status' | 'peta' | 'lapor';

const mq = () => window.matchMedia('(max-width: 860px)');
function useMobile() {
  return useSyncExternalStore(
    (cb) => {
      const m = mq();
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => mq().matches,
    () => false,
  );
}

export default function SiagaApp() {
  const mobile = useMobile();
  const [view, setView] = useState<View>('status');
  const [places, setPlaces] = useState<Place[]>(() => store.get('siaga.places', []));
  const [cur, setCur] = useState<number>(() => store.get('siaga.cur', 0));
  const place = places[cur] ?? places[0] ?? null;
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);
  const [mapData, setMapData] = useState<MapResponse | null>(null);
  const [mode, setMode] = useState<'danger' | 'all'>('danger');
  const [picking, setPicking] = useState<{ text: string; cb: (lat: number, lon: number) => void; back: View } | null>(null);
  const [sheet, setSheet] = useState<null | 'places' | 'alerts'>(null);
  const [levels, setLevels] = useState<Record<string, Level | null>>({});
  const [toastMsg, setToastMsg] = useState('');
  const [toastOn, setToastOn] = useState(false);
  const [alertCfg, setAlertCfg] = useState<AlertConfig | null>(null);
  const [subs, setSubs] = useState<{ id: string; channel: string }[]>([]);
  const [pushHere, setPushHere] = useState(false);
  const [busy, setBusy] = useState(false);
  const mapH = useRef<MapHandle>(null);
  const toastT = useRef<ReturnType<typeof setTimeout>>();

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    setToastOn(true);
    clearTimeout(toastT.current);
    toastT.current = setTimeout(() => setToastOn(false), 2600);
  }, []);

  const savePlaces = (list: Place[], c: number) => {
    setPlaces(list);
    setCur(c);
    store.set('siaga.places', list);
    store.set('siaga.cur', c);
  };

  /* ---------- awal: perangkat, lokasi tersimpan, service worker ---------- */
  useEffect(() => {
    (async () => {
      try {
        const list = await api.places();
        // Pindahkan lokasi dari prototipe (localStorage) ke akun perangkat, sekali saja.
        const legacy = store.get<{ name: string; lat: number; lon: number }[]>('siaga.app.places', []);
        if (!list.length && legacy.length) {
          for (const p of legacy.slice(0, 10)) list.push(await api.addPlace({ name: p.name, lat: p.lat, lon: p.lon }));
          store.del('siaga.app.places');
        }
        savePlaces(list, Math.min(store.get('siaga.cur', 0), Math.max(0, list.length - 1)));
      } catch {
        /* luring: pakai salinan lokal */
      }
    })();
    if (process.env.NODE_ENV === 'production') void registerSW();
    api.alertConfig().then(setAlertCfg).catch(() => undefined);
    api.alerts().then(setSubs).catch(() => undefined);
    void currentPushEndpoint().then((e) => setPushHere(!!e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- status lokasi aktif, diperbarui tiap menit ---------- */
  const loadStatus = useCallback(async (p: Place) => {
    setLoading(true);
    try {
      const s = await api.status(p);
      setStatus(s);
      setOffline(false);
      store.set(`siaga.status.${p.id}`, s);
    } catch {
      // Tampilkan data terakhir yang benar-benar pernah diterima, dengan waktunya.
      setOffline(true);
      setStatus((prev) => prev ?? store.get<StatusResponse | null>(`siaga.status.${p.id}`, null));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setStatus(null);
    if (!place) return;
    void loadStatus(place);
    const t = setInterval(() => !document.hidden && loadStatus(place), 60_000);
    const vis = () => !document.hidden && loadStatus(place);
    document.addEventListener('visibilitychange', vis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', vis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place?.id]);

  /* ---------- data peta ---------- */
  useEffect(() => {
    let stop = false;
    const load = () => api.map(mode, place).then((d) => !stop && setMapData(d)).catch(() => undefined);
    void load();
    const t = setInterval(() => !document.hidden && load(), 60_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, place?.id]);

  /* ---------- navigasi ---------- */
  const go = useCallback(
    (v: View) => {
      if (v === 'peta' && !mobile) v = 'status';
      setView(v);
      mapH.current?.invalidate();
    },
    [mobile],
  );
  useEffect(() => {
    document.body.dataset.view = view;
  }, [view]);
  useEffect(() => {
    document.body.classList.toggle('picking', !!picking);
    mapH.current?.invalidate();
  }, [picking]);
  useEffect(() => {
    if (!mobile && view === 'peta') setView('status');
    mapH.current?.invalidate();
  }, [mobile, view]);
  useEffect(() => {
    mapH.current?.focusPlace(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place?.id]);

  const show = (lat: number, lon: number, zoom: number, ref?: string) => {
    if (mobile) go('peta');
    mapH.current?.show(lat, lon, zoom, ref);
  };

  /* ---------- pilih titik di peta ---------- */
  const pick = (text: string, cb: (lat: number, lon: number) => void) => {
    setSheet(null);
    setPicking({ text, cb, back: view });
  };
  const onPick = (lat: number, lon: number) => {
    const p = picking;
    if (!p) return;
    setPicking(null);
    go(p.back);
    p.cb(lat, lon);
  };
  const cancelPick = () => {
    if (picking) go(picking.back);
    setPicking(null);
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setSheet(null);
      if (picking) cancelPick();
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  });

  /* ---------- lokasi pantauan ---------- */
  const addPlace = async (lat: number, lon: number, name?: string) => {
    const n = nearestCity(lat, lon);
    let nm = name || (n.km < 25 ? n.name : 'Lokasi saya');
    if (places.some((p) => p.name === nm)) nm += ` ${places.filter((p) => p.name.startsWith(nm)).length + 1}`;
    try {
      const p = await api.addPlace({ name: nm, lat: +lat.toFixed(4), lon: +lon.toFixed(4) });
      const list = [...places, p];
      savePlaces(list, list.length - 1);
      setSheet(null);
      go('status');
      toast(`${nm} dipantau`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Gagal menyimpan lokasi. Periksa koneksi Anda.');
    }
  };
  const gps = (cb: (lat: number, lon: number) => void) => {
    if (!navigator.geolocation) return toast('Perangkat ini tidak mendukung lokasi');
    toast('Mencari lokasi Anda');
    navigator.geolocation.getCurrentPosition(
      (p) => cb(p.coords.latitude, p.coords.longitude),
      () => toast('Izin lokasi ditolak. Ketik nama kota saja.'),
      { timeout: 10_000 },
    );
  };
  const addActs = {
    onGps: () => gps((la, lo) => void addPlace(la, lo)),
    onCity: (name: string, lat: number, lon: number) => void addPlace(lat, lon, name),
    onMap: () => pick('Ketuk lokasi yang ingin dipantau', (la, lo) => void addPlace(la, lo)),
  };
  const delPlace = async (i: number) => {
    const p = places[i];
    if (!p) return;
    try {
      await api.delPlace(p.id);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) return toast('Gagal menghapus. Periksa koneksi Anda.');
    }
    store.del(`siaga.status.${p.id}`);
    const list = places.filter((_, j) => j !== i);
    savePlaces(list, Math.max(0, Math.min(cur > i ? cur - 1 : cur, list.length - 1)));
    toast(`${p.name} dihapus`);
    if (!list.length) setSheet(null);
  };
  useEffect(() => {
    if (sheet !== 'places' || !places.length) return;
    api
      .levels(places)
      .then((r) => setLevels(Object.fromEntries(places.map((p, i) => [p.id, r[i]?.level ?? null]))))
      .catch(() => undefined);
  }, [sheet, places]);

  /* ---------- peringatan ---------- */
  const refreshAlerts = async () => {
    const [c, s, e] = await Promise.all([api.alertConfig().catch(() => alertCfg), api.alerts().catch(() => subs), currentPushEndpoint()]);
    setAlertCfg(c);
    setSubs(s);
    setPushHere(!!e && s.some((x) => x.channel === 'webpush'));
  };
  const openAlerts = () => {
    if (!places.length) return setSheet('places');
    setSheet('alerts');
    void refreshAlerts();
  };
  const onPush = async () => {
    if (!alertCfg?.vapidPublicKey) return;
    setBusy(true);
    try {
      const sub = await subscribePush(alertCfg.vapidPublicKey);
      await api.subscribe({ channel: 'webpush', subscription: sub });
      await refreshAlerts();
      toast('Notifikasi aktif di perangkat ini');
    } catch (e) {
      toast((e as Error).message || 'Gagal menyalakan notifikasi');
    } finally {
      setBusy(false);
    }
  };
  const onTelegram = async () => {
    const w = window.open('', '_blank'); // buka sekarang supaya tidak diblokir browser
    setBusy(true);
    try {
      const r = await api.subscribe({ channel: 'telegram' });
      if (r.url) {
        if (w) w.location.href = r.url;
        else window.location.href = r.url;
      }
      toast('Di Telegram, tekan Start untuk menyalakan');
    } catch (e) {
      w?.close();
      toast(e instanceof ApiError ? e.message : 'Gagal membuka Telegram');
    } finally {
      setBusy(false);
    }
  };
  const onOff = async () => {
    setBusy(true);
    try {
      await api.unsubscribe({});
      await unsubscribePush().catch(() => undefined);
      await refreshAlerts();
      toast('Peringatan dimatikan');
    } catch {
      toast('Gagal mematikan. Periksa koneksi Anda.');
    } finally {
      setBusy(false);
    }
  };

  /* ---------- tampilan ---------- */
  const nb = (e: NearbyEvent) => show(e.lat, e.lon, e.zoom, `${e.type}:${e.ref}`);
  const focusCond = (c: Condition) => c.focus && show(c.focus.lat, c.focus.lon, c.focus.zoom);
  const showReport = (r: CitizenReport) => show(r.lat, r.lon, 13, `warga:${r.id}`);

  return (
    <>
      <MapView ref={mapH} data={mapData} place={place} picking={!!picking} onPick={onPick} />

      <div className="fl mode" id="mode">
        <button className={mode === 'danger' ? 'on' : ''} onClick={() => setMode('danger')}>
          Yang berbahaya
        </button>
        <button className={mode === 'all' ? 'on' : ''} onClick={() => setMode('all')}>
          Semua
        </button>
      </div>
      <div className="fl leg">
        {(
          [
            ['var(--gempa)', 'Gempa'],
            ['var(--air)', 'Hujan lebat'],
            ['var(--api)', 'Titik api'],
            ['var(--warn)', 'Udara'],
            ['var(--gunung)', 'Gunung api'],
            ['var(--warga)', 'Laporan'],
          ] as const
        ).map(([c, t]) => (
          <span key={t} style={{ ['--c' as string]: c }}>
            <i />
            {t}
          </span>
        ))}
      </div>
      <div className="fl ctl">
        <button aria-label="Lihat seluruh Indonesia" onClick={() => mapH.current?.home()}>
          <svg className="i" viewBox="0 0 24 24">
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
        </button>
        <button aria-label="Ke lokasi pantauan" onClick={() => (place ? mapH.current?.focusPlace(true) : setSheet('places'))}>
          <Icon n="gps" />
        </button>
      </div>
      <div className="fl pick">
        <span>{picking?.text ?? 'Ketuk lokasi di peta'}</span>
        <button onClick={cancelPick}>Batal</button>
      </div>

      <main className="col">
        <header className="hd">
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
          {place && (
            <button className="locb" onClick={() => setSheet('places')}>
              <Icon n="pin" />
              <span>{place.name}</span>
              <Icon n="ch" />
            </button>
          )}
        </header>
        <section className="view" id="v-status">
          <StatusView
            place={place}
            status={status}
            loading={loading}
            offline={offline}
            alertOn={subs.length > 0}
            onAlert={openAlerts}
            onNearby={nb}
            onFocus={focusCond}
            add={addActs}
          />
        </section>
        <section className="view lap" id="v-lapor">
          <LaporView
            place={place}
            active={view === 'lapor'}
            pickLocation={(cb) => pick('Ketuk lokasi kejadian', cb)}
            toast={toast}
            onSent={() => {
              if (!mobile) go('status');
            }}
            showReport={showReport}
          />
        </section>
        <nav className="nav" id="nav">
          <button className={view === 'status' ? 'on' : ''} onClick={() => go('status')}>
            <svg className="i" viewBox="0 0 24 24">
              <path d="M12 3 4 6v6c0 4.5 3.4 7.8 8 9 4.6-1.2 8-4.5 8-9V6z" />
              <path d="m9 12 2.2 2.2L15.2 10" />
            </svg>
            Status
          </button>
          <button data-v="peta" className={view === 'peta' ? 'on' : ''} onClick={() => go('peta')}>
            <Icon n="map" />
            Peta
          </button>
          <button className={view === 'lapor' ? 'on' : ''} onClick={() => go('lapor')}>
            <svg className="i" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v8M8 12h8" />
            </svg>
            Lapor
          </button>
        </nav>
      </main>

      <Sheet open={!!sheet} onClose={() => setSheet(null)}>
        {sheet === 'places' && (
          <PlacesSheet
            places={places}
            cur={cur}
            levels={levels}
            onSelect={(i) => {
              savePlaces(places, i);
              setSheet(null);
              go('status');
            }}
            onDelete={(i) => void delPlace(i)}
            add={addActs}
          />
        )}
        {sheet === 'alerts' && (
          <AlertsSheet config={alertCfg} subs={subs} thisDevicePush={pushHere} busy={busy} onPush={onPush} onTelegram={onTelegram} onOff={onOff} />
        )}
      </Sheet>
      <div className={`fl toast${toastOn ? ' on' : ''}`} role="status" aria-live="polite">
        {toastMsg}
      </div>
    </>
  );
}
