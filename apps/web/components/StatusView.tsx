'use client';
import { ago, type Condition, type NearbyEvent } from '@siaga/core';
import { useState } from 'react';
import type { Place, StatusResponse } from '@/lib/api';
import { COND_ICON, Icon } from '@/lib/icons';
import { AddPlace } from './AddPlace';

const tf = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false });
const NB_COLOR: Record<NearbyEvent['type'], string> = { warga: 'var(--warga)', komunitas: 'var(--air)', gempa: 'var(--gempa)' };

const SRC_LABEL: Record<string, string> = { gempa: 'gempa', banjir: 'laporan PetaBencana.id', cuaca: 'hujan', udara: 'kualitas udara', api: 'titik api', gunung: 'gunung api' };

export function StatusView(props: {
  place: Place | null;
  status: StatusResponse | null;
  loading: boolean;
  offline: boolean;
  alertOn: boolean;
  onAlert(): void;
  onNearby(e: NearbyEvent): void;
  onFocus(c: Condition): void;
  add: { onGps(): void; onCity(name: string, lat: number, lon: number): void; onMap(): void };
}) {
  const { place, status: s, loading, offline } = props;
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (!place)
    return (
      <div className="onb">
        <h1>Lokasi mana yang ingin Anda pantau?</h1>
        <p>Pilih satu tempat. SIAGA memberi tahu kalau ada bahaya di sekitarnya dan apa yang perlu dilakukan.</p>
        <AddPlace {...props.add} />
      </div>
    );
  if (!s) return <div className="skel">{offline ? 'Tidak tersambung ke server. Periksa koneksi internet Anda.' : 'Memuat status lokasi…'}</div>;

  const lvClass = s.level == null ? 'lx' : `l${s.level}`;
  // Nama sumber untuk atribusi (BMKG wajib dicantumkan), tanpa label teknis seperti "(berkas terbuka)".
  const sources = Object.values(s.feeds)
    .filter((f) => f.available && f.source)
    .flatMap((f) => f.source!.split(' + '))
    .map((v) => v.replace(/\s*\((API|berkas terbuka|CAMS)\)$/, '').replace(/^MAGMA$/, 'MAGMA (PVMBG)').replace(/^EONET$/, 'NASA EONET'))
    .filter((v, i, a) => a.indexOf(v) === i);

  return (
    <>
      {offline && (
        <div className="offline">
          <i />
          Tidak tersambung. Menampilkan data terakhir dari {tf.format(s.generatedAt)} WIB.
        </div>
      )}
      <div className={`hero ${lvClass}`}>
        <small>{place.name}</small>
        <h1>{s.label}</h1>
        <p>{s.sentence}</p>
        <em>{loading ? 'Memuat data terbaru' : `Diperbarui ${tf.format(s.generatedAt)} WIB`}</em>
      </div>
      {s.conditions.map((c) => (
        <details
          key={c.kind}
          className={`cond ${c.level == null ? 'lx' : `l${c.level}`}`}
          open={open.has(c.kind)}
          onToggle={(e) => {
            const o = (e.target as HTMLDetailsElement).open;
            setOpen((prev) => {
              const n = new Set(prev);
              if (o) n.add(c.kind);
              else n.delete(c.kind);
              return n;
            });
          }}
        >
          <summary>
            <span className="ig">
              <Icon n={COND_ICON[c.kind] ?? 'gempa'} />
            </span>
            <span className="tx">
              <b>{c.head}</b>
              <span>{c.act}</span>
            </span>
            {(c.rows.length > 0 || c.note) && <Icon n="ch" className="ch" />}
          </summary>
          {c.rows.length > 0 && (
            <table>
              <tbody>
                {c.rows.map((r) => (
                  <tr key={r[0]}>
                    <td>{r[0]}</td>
                    <td>{r[1]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {c.note && <p className="note">{c.note}</p>}
          {c.focus && c.level != null && c.level > 0 && (
            <button className="go" onClick={() => props.onFocus(c)}>
              <Icon n="map" />
              Lihat di peta
            </button>
          )}
        </details>
      ))}
      {s.nearby.length > 0 && (
        <>
          <div className="h">Kejadian terdekat</div>
          {s.nearby.map((e) => (
            <button key={`${e.type}:${e.ref}`} className="nb" style={{ ['--c' as string]: NB_COLOR[e.type] }} onClick={() => props.onNearby(e)}>
              <i />
              <div>
                <b>{e.title}</b>
                <span>
                  {Math.round(e.km)} km dari sini, {ago(e.t)}
                </span>
              </div>
              <Icon n="go" />
            </button>
          ))}
        </>
      )}
      <button className="alertrow" aria-pressed={props.alertOn} onClick={props.onAlert}>
        <div>
          <b>Peringatan otomatis</b>
          <span>Kabari saya saat tingkat bahaya di sini naik</span>
        </div>
        <span className="sw" />
      </button>
      <p className="srcnote">
        {sources.length > 0 && (
          <>
            <b>Sumber:</b> {sources.join(', ')}.{' '}
          </>
        )}
        {s.missing.length > 0 && <>Data {s.missing.map((k) => SRC_LABEL[k] ?? k).join(', ')} sedang tidak tersedia, jadi tidak ikut dinilai. </>}
        {s.feeds.gempa.available && s.feeds.gempa.lastSuccessAt && <>Data gempa diperiksa {ago(s.feeds.gempa.lastSuccessAt)}. </>}
        <a href="/pantau">Lihat situasi seluruh Indonesia</a>
      </p>
    </>
  );
}
