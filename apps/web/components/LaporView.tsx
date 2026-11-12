'use client';
import { ago, REPORT_KINDS, where, type CitizenReport } from '@siaga/core';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, type Place } from '@/lib/api';
import { Icon, KIND_ICON } from '@/lib/icons';

const STATUS: Record<string, [string, string]> = {
  pending: ['Menunggu pemeriksaan', ''],
  approved: ['Tampil di peta', 'ok'],
  rejected: ['Tidak ditampilkan', 'no'],
  duplicate: ['Sudah dilaporkan warga lain', ''],
};

/** Perkecil foto di perangkat sebelum dikirim (hemat kuota). Server mengompres ulang dan membuang metadata. */
async function shrink(file: File): Promise<{ blob: Blob; url: string }> {
  const url = URL.createObjectURL(file);
  try {
    const im = new Image();
    await new Promise((res, rej) => {
      im.onload = res;
      im.onerror = rej;
      im.src = url;
    });
    const s = Math.min(1, 1600 / Math.max(im.width, im.height));
    const c = document.createElement('canvas');
    c.width = Math.round(im.width * s);
    c.height = Math.round(im.height * s);
    c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('foto'))), 'image/jpeg', 0.82));
    return { blob, url: URL.createObjectURL(blob) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function LaporView(props: {
  place: Place | null;
  active: boolean;
  pickLocation(cb: (lat: number, lon: number) => void): void;
  toast(m: string): void;
  onSent(r: { lat: number; lon: number }): void;
  showReport(r: CitizenReport): void;
}) {
  const [kind, setKind] = useState<string | null>(null);
  const [loc, setLoc] = useState<{ lat: number; lon: number; sub: string } | null>(null);
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<CitizenReport[]>([]);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!props.active) return;
    if (!loc && props.place) setLoc({ lat: props.place.lat, lon: props.place.lon, sub: `Lokasi pantauan Anda: ${props.place.name}` });
    api.mine().then(setMine).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.active]);

  const submit = async () => {
    if (!kind || !loc || busy) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('kind', kind);
      fd.set('text', text.trim());
      fd.set('lat', String(loc.lat));
      fd.set('lon', String(loc.lon));
      if (photo) fd.set('photo', photo.blob, 'foto.jpg');
      const r = await api.report(fd);
      props.toast(r.status === 'duplicate' ? 'Sudah dilaporkan warga lain. Terima kasih.' : 'Laporan terkirim');
      setKind(null);
      setText('');
      if (photo) URL.revokeObjectURL(photo.url);
      setPhoto(null);
      if (file.current) file.current.value = '';
      setLoc(null);
      setMine(await api.mine().catch(() => mine));
      props.onSent(loc);
    } catch (e) {
      props.toast(e instanceof ApiError ? e.message : 'Gagal mengirim. Periksa koneksi Anda.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Laporkan kejadian</h1>
      <p>Pilih jenisnya, lalu kirim. Laporan diperiksa dulu sebelum tampil ke warga sekitar.</p>
      <div className="kinds">
        {REPORT_KINDS.map((k) => (
          <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
            <Icon n={KIND_ICON[k] ?? 'banjir'} />
            {k}
          </button>
        ))}
      </div>
      <button className="lrow" onClick={() => props.pickLocation((lat, lon) => setLoc({ lat, lon, sub: 'Titik dipilih di peta' }))}>
        <Icon n="pin" />
        <div>
          <b>{loc ? where(loc.lat, loc.lon) : 'Lokasi belum dipilih'}</b>
          <span>{loc ? loc.sub : 'Ketuk untuk memilih di peta'}</span>
        </div>
        <u>Ubah</u>
      </button>
      <button className="lrow" onClick={() => file.current?.click()}>
        <svg className="i" viewBox="0 0 24 24">
          <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
          <circle cx="12" cy="13" r="3.5" />
        </svg>
        <div>
          <b>{photo ? 'Foto ditambahkan' : 'Tambah foto'}</b>
          <span>Opsional, membantu verifikasi</span>
        </div>
        {photo && <img src={photo.url} alt="" />}
      </button>
      <input
        ref={file}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            if (photo) URL.revokeObjectURL(photo.url);
            setPhoto(await shrink(f));
          } catch {
            props.toast('Foto tidak bisa dibaca');
          }
        }}
      />
      <textarea maxLength={200} placeholder="Keterangan (opsional)" aria-label="Keterangan" value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn pri" disabled={!kind || !loc || busy} onClick={submit}>
        {busy ? 'Mengirim…' : 'Kirim laporan'}
      </button>
      <div className="mine">
        {mine.length > 0 && <div className="h">Laporan Anda</div>}
        {mine.slice(0, 5).map((r) => {
          const [label, cls] = STATUS[r.status ?? 'pending'] ?? STATUS.pending!;
          return (
            <button key={r.id} className="nb" style={{ ['--c' as string]: 'var(--warga)' }} onClick={() => props.showReport(r)}>
              <i />
              <div>
                <b>
                  {r.kind}
                  {r.text ? `: ${r.text}` : ''}
                </b>
                <span>
                  {where(r.lat, r.lon)}, {ago(r.t)}
                  <em className={`st ${cls}`}>{label}</em>
                </span>
              </div>
              <Icon n="go" />
            </button>
          );
        })}
      </div>
    </>
  );
}
