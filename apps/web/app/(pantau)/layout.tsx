import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import 'leaflet/dist/leaflet.css';
import './pantau.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'SIAGA Pantau — situasi bencana realtime',
  description: 'Peta dan daftar kejadian bencana di Indonesia yang diperbarui langsung: gempa, hujan lebat, kualitas udara, titik api, gunung api, dan laporan warga.',
  applicationName: 'SIAGA',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icons/icon.svg', apple: '/icons/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  themeColor: '#06161f',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'dark',
};

/** Root layout terpisah dari aplikasi warga supaya CSS kedua tampilan tidak bercampur. */
export default function PantauLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <body data-sheet="">{children}</body>
    </html>
  );
}
