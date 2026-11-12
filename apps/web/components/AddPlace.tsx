'use client';
import { CITIES } from '@siaga/core';
import { useState } from 'react';
import { Icon } from '@/lib/icons';

/** Blok "Gunakan lokasi saya / ketik nama kota / pilih di peta" dari prototipe. */
export function AddPlace({
  onGps,
  onCity,
  onMap,
}: {
  onGps(): void;
  onCity(name: string, lat: number, lon: number): void;
  onMap(): void;
}) {
  const [q, setQ] = useState('');
  const v = q.trim().toLowerCase();
  const m = v
    ? CITIES.filter((c) => c.name.toLowerCase().includes(v))
        .sort((a, b) => a.name.toLowerCase().indexOf(v) - b.name.toLowerCase().indexOf(v))
        .slice(0, 5)
    : [];
  return (
    <>
      <button className="btn pri" onClick={onGps}>
        <Icon n="gps" />
        Gunakan lokasi saya
      </button>
      <div className="or">atau ketik nama kota</div>
      <input className="inp" placeholder="Misalnya Bekasi" autoComplete="off" aria-label="Nama kota" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="sug">
        {m.map((c) => (
          <button key={c.name} onClick={() => onCity(c.name, c.lat, c.lon)}>
            {c.name}
          </button>
        ))}
        {v && !m.length && <div className="or">Kota belum tersedia. Coba &quot;Pilih di peta&quot;.</div>}
      </div>
      <button className="btn" onClick={onMap} style={{ marginTop: 10 }}>
        <Icon n="pin" />
        Pilih di peta
      </button>
    </>
  );
}
