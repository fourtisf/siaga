'use client';
import { useEffect, useRef, useState } from 'react';

export type LiveType = 'feed' | 'quake' | 'volcano' | 'report';

export interface LiveFeed {
  type: 'feed';
  key: 'gempa' | 'banjir' | 'cuaca' | 'udara' | 'api' | 'gunung';
  ok: boolean;
  source?: string | null;
  count?: number;
  ts: number;
}
export interface LiveQuake {
  type: 'quake';
  quake: { id: string; t: number; lat: number; lon: number; m: number; depthKm: number; place: string; tsunami: boolean; src: string };
  ts: number;
}
export interface LiveVolcano {
  type: 'volcano';
  code: string;
  name: string;
  from: number | null;
  to: number | null;
  ts: number;
}
export interface LiveReport {
  type: 'report';
  id: string;
  kind: string;
  lat: number;
  lon: number;
  ts: number;
}
export type LiveEvent = LiveFeed | LiveQuake | LiveVolcano | LiveReport;

/**
 * Sambungan realtime ke /api/stream (Server-Sent Events). EventSource menyambung
 * ulang sendiri bila putus. Mengembalikan status tersambung.
 */
export function useLive(onEvent: (ev: LiveEvent) => void): boolean {
  const [connected, setConnected] = useState(false);
  const cb = useRef(onEvent);
  cb.current = onEvent;
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/stream');
    es.addEventListener('hello', () => setConnected(true));
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(es.readyState === EventSource.OPEN);
    const handler = (e: MessageEvent) => {
      try {
        cb.current(JSON.parse(e.data) as LiveEvent);
      } catch {
        /* abaikan pesan rusak */
      }
    };
    for (const t of ['feed', 'quake', 'volcano', 'report'] as LiveType[]) es.addEventListener(t, handler as EventListener);
    return () => es.close();
  }, []);
  return connected;
}

/** Jalankan fn paling banyak sekali per `ms`, dengan panggilan terakhir tetap dijalankan. */
export function debounce<T extends unknown[]>(fn: (...a: T) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...a: T) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}
