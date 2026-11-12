/** Ikon garis dari prototipe (viewBox 24). String statis, aman untuk innerHTML. */
export const IC = {
  gempa: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
  banjir: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  hujan: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  api: '<path d="M12 3c.5 3.5 4.5 5 4.5 9.5a4.5 4.5 0 0 1-9 0c0-1.8.8-3 1.8-4 .4 1.2 1 1.8 1.7 2C11 8.5 11 5.5 12 3z"/>',
  udara: '<path d="M3 9h10a2.8 2.8 0 1 0-2.8-2.8M3 14h15a2.8 2.8 0 1 1-2.8 2.8M3 19h5"/>',
  gunung: '<path d="m3 19 6.5-11 3 5 2-3 6.5 9z"/>',
  pohon: '<path d="M12 21v-7M7 14a5 5 0 1 1 10 0z"/>',
  jalan: '<path d="M8 3 5 21M16 3l3 18M12 5v3M12 11v3M12 17v3"/>',
  listrik: '<path d="M13 2 5 13.5h6L10 22l9-12h-6z"/>',
  laka: '<path d="M12 3 2.5 20h19zM12 10v5M12 17.5v.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  ch: '<path d="m7 10 5 5 5-5"/>',
  go: '<path d="m9 6 6 6-6 6"/>',
  pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.4"/>',
  gps: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  map: '<path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"/>',
  send: '<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/>',
  wa: '<path d="M4 20l1.3-4A8 8 0 1 1 8 18.7z"/>',
  warga: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
  ok: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.2 2.4 2.4 4.6-5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5zM3 13l9 5 9-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.4 5.7"/><path d="M20 4v7h-7"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  sat: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.6 3.6 5.4 3.6 8.5s-1.2 5.9-3.6 8.5c-2.4-2.6-3.6-5.4-3.6-8.5s1.2-5.9 3.6-8.5z"/>',
} as const;

export type IconName = keyof typeof IC;

export function Icon({ n, className }: { n: IconName; className?: string }) {
  return <svg className={`i${className ? ` ${className}` : ''}`} viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: IC[n] }} />;
}

export const iconHtml = (n: IconName, cls = '') => `<svg class="i${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24">${IC[n]}</svg>`;

/** Jenis laporan → ikon (sama dengan prototipe) */
export const KIND_ICON: Record<string, IconName> = {
  Banjir: 'banjir',
  Kebakaran: 'api',
  'Pohon tumbang': 'pohon',
  'Jalan rusak': 'jalan',
  'Mati listrik': 'listrik',
  Kecelakaan: 'laka',
};

export const COND_ICON: Record<string, IconName> = { gempa: 'gempa', hujan: 'banjir', udara: 'udara', api: 'api', gunung: 'gunung' };

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
