'use client';
/** Antrean moderasi laporan warga. Dilindungi ADMIN_TOKEN (disimpan di sessionStorage tab ini saja). */
import { ago, where, wib } from '@siaga/core';
import { useCallback, useEffect, useState } from 'react';

interface Item {
  id: string;
  kind: string;
  text: string;
  lat: number;
  lon: number;
  t: number;
  status: string;
  photoUrl: string | null;
  confirmations: number;
  reporter: { approved: number; rejected: number };
}

const S: Record<string, React.CSSProperties> = {
  page: { position: 'fixed', inset: 0, overflow: 'auto', padding: '20px 16px 60px' },
  wrap: { maxWidth: 760, margin: '0 auto' },
  card: { background: 'var(--row)', borderRadius: 16, padding: 14, marginTop: 12, display: 'flex', gap: 14, alignItems: 'flex-start' },
  img: { width: 120, height: 120, objectFit: 'cover', borderRadius: 12, flex: 'none', background: 'var(--row2)' },
  meta: { fontSize: 13, color: 'var(--mut)', marginTop: 4 },
  acts: { display: 'flex', gap: 8, marginTop: 12 },
};

export default function Moderation() {
  const [token, setToken] = useState('');
  const [input, setInput] = useState('');
  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [items, setItems] = useState<Item[]>([]);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    document.body.style.overflow = 'auto';
    setToken(sessionStorage.getItem('siaga.admin') ?? '');
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    const r = await fetch(`/api/admin/reports?status=${tab}`, { headers: { 'x-admin-token': token }, cache: 'no-store' });
    if (r.status === 401) {
      setMsg('Token salah.');
      sessionStorage.removeItem('siaga.admin');
      setToken('');
      return;
    }
    setItems(await r.json());
    setMsg('');
  }, [token, tab]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (id: string, action: 'approve' | 'reject') => {
    const r = await fetch(`/api/admin/reports/${id}/moderate`, {
      method: 'POST',
      headers: { 'x-admin-token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (r.ok) setItems((x) => x.filter((i) => i.id !== id));
    else setMsg('Gagal menyimpan keputusan.');
  };

  if (!token)
    return (
      <div style={S.page}>
        <div style={{ ...S.wrap, maxWidth: 380 }} className="onb">
          <h1>Moderasi laporan</h1>
          <p>Masukkan token moderator.</p>
          <input className="inp" type="password" value={input} onChange={(e) => setInput(e.target.value)} aria-label="Token moderator" />
          <button
            className="btn pri"
            style={{ marginTop: 10 }}
            onClick={() => {
              sessionStorage.setItem('siaga.admin', input);
              setToken(input);
            }}
          >
            Masuk
          </button>
          {msg && <p style={{ color: 'var(--bad)', marginTop: 12 }}>{msg}</p>}
        </div>
      </div>
    );

  return (
    <div style={S.page}>
      <div style={S.wrap}>
        <div className="lap">
          <h1>Moderasi laporan</h1>
        </div>
        <div className="fl mode" style={{ position: 'static', display: 'inline-flex', marginTop: 8 }}>
          {(['pending', 'approved', 'rejected'] as const).map((t) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {{ pending: 'Menunggu', approved: 'Disetujui', rejected: 'Ditolak' }[t]}
            </button>
          ))}
        </div>
        {msg && <p style={{ color: 'var(--bad)' }}>{msg}</p>}
        {!items.length && <p className="skel">Tidak ada laporan.</p>}
        {items.map((r) => (
          <div key={r.id} style={S.card}>
            {r.photoUrl ? (
              <a href={r.photoUrl} target="_blank" rel="noopener">
                <img src={r.photoUrl} alt="Foto laporan" style={S.img} />
              </a>
            ) : (
              <div style={{ ...S.img, display: 'grid', placeItems: 'center', color: 'var(--dim)', fontSize: 12 }}>Tanpa foto</div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <b style={{ fontSize: 16 }}>{r.kind}</b>
              {r.text && <div style={{ marginTop: 2 }}>{r.text}</div>}
              <div style={S.meta}>
                {where(r.lat, r.lon)} ·{' '}
                <a href={`https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lon}#map=16/${r.lat}/${r.lon}`} target="_blank" rel="noopener" style={{ color: 'var(--air)' }}>
                  lihat peta
                </a>
              </div>
              <div style={S.meta}>
                {wib(r.t)} ({ago(r.t)}) · {r.confirmations} warga lain melaporkan hal sama · pelapor: {r.reporter.approved} disetujui, {r.reporter.rejected} ditolak
              </div>
              {tab === 'pending' && (
                <div style={S.acts}>
                  <button className="btn pri" style={{ width: 'auto', padding: '0 18px', height: 42 }} onClick={() => act(r.id, 'approve')}>
                    Setujui
                  </button>
                  <button className="btn" style={{ width: 'auto', padding: '0 18px', height: 42, marginTop: 0 }} onClick={() => act(r.id, 'reject')}>
                    Tolak
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
