'use client';
import type { ReactNode } from 'react';
import type { AlertConfig, Place } from '@/lib/api';
import { Icon } from '@/lib/icons';
import { iosNeedsInstall, pushSupported } from '@/lib/push';
import { AddPlace } from './AddPlace';

export function Sheet({ open, onClose, children }: { open: boolean; onClose(): void; children: ReactNode }) {
  return (
    <div className={`scrim${open ? ' on' : ''}`} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true">
        <div className="grab" />
        {children}
      </div>
    </div>
  );
}

const LV_COLOR = ['var(--ok)', 'var(--warn)', 'var(--bad)'];
const LV_LABEL = ['Aman', 'Waspada', 'Bahaya'];

export function PlacesSheet(props: {
  places: Place[];
  cur: number;
  levels: Record<string, 0 | 1 | 2 | null>;
  onSelect(i: number): void;
  onDelete(i: number): void;
  add: { onGps(): void; onCity(name: string, lat: number, lon: number): void; onMap(): void };
}) {
  return (
    <>
      {props.places.length > 0 && <h2>Lokasi pantauan</h2>}
      {props.places.map((p, i) => {
        const lv = props.levels[p.id];
        return (
          <div key={p.id} className={`pl${i === props.cur ? ' on' : ''}`} style={{ ['--c' as string]: lv == null ? 'var(--dim)' : LV_COLOR[lv] }}>
            <i />
            <span role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => props.onSelect(i)} onKeyDown={(e) => e.key === 'Enter' && props.onSelect(i)}>
              {p.name} <small>{lv == null ? '' : LV_LABEL[lv]}</small>
            </span>
            <button className="x" aria-label={`Hapus ${p.name}`} onClick={() => props.onDelete(i)}>
              <Icon n="x" />
            </button>
          </div>
        );
      })}
      <h2>{props.places.length ? 'Tambah lokasi' : 'Pilih lokasi'}</h2>
      <AddPlace {...props.add} />
    </>
  );
}

export function AlertsSheet(props: {
  config: AlertConfig | null;
  subs: { id: string; channel: string }[];
  thisDevicePush: boolean;
  busy: boolean;
  onPush(): void;
  onTelegram(): void;
  onOff(): void;
}) {
  const ch = props.config?.channels;
  const has = (c: string) => props.subs.some((s) => s.channel === c);
  const canPush = !!ch?.webpush && !!props.config?.vapidPublicKey && pushSupported();
  const ios = iosNeedsInstall();
  return (
    <>
      <h2>Peringatan otomatis</h2>
      <p className="lead">SIAGA mengabari Anda hanya saat tingkat bahaya di lokasi pantauan naik, misalnya dari Aman ke Waspada.</p>
      {!ch && <p className="lead">Memuat…</p>}
      {ch && (
        <>
          <button className="opt" disabled={!canPush || props.busy} onClick={props.onPush}>
            <Icon n="bell" />
            <div>
              <b>Notifikasi di perangkat ini</b>
              <span>
                {!ch.webpush
                  ? 'Belum tersedia di server ini.'
                  : ios
                    ? 'Di iPhone, pasang SIAGA ke Layar Utama dulu (Bagikan, lalu Tambah ke Layar Utama).'
                    : !pushSupported()
                      ? 'Browser ini tidak mendukung notifikasi.'
                      : 'Muncul di layar walau aplikasi tertutup.'}
              </span>
            </div>
            {props.thisDevicePush && <em>Aktif</em>}
          </button>
          <button className="opt" disabled={!ch.telegram || props.busy} onClick={props.onTelegram}>
            <Icon n="send" />
            <div>
              <b>Telegram</b>
              <span>{ch.telegram ? 'Buka Telegram, lalu tekan Start.' : 'Belum tersedia di server ini.'}</span>
            </div>
            {has('telegram') && <em>Aktif</em>}
          </button>
          <button className="opt" disabled>
            <Icon n="wa" />
            <div>
              <b>WhatsApp</b>
              <span>Segera hadir.</span>
            </div>
          </button>
          {props.subs.length > 0 && (
            <button className="btn" style={{ marginTop: 14 }} disabled={props.busy} onClick={props.onOff}>
              Matikan semua peringatan
            </button>
          )}
        </>
      )}
    </>
  );
}
