import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import 'leaflet/dist/leaflet.css';
import './warga.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'SIAGA — Aman atau tidak, dan harus apa',
  description: 'Peringatan bencana untuk satu lokasi: gempa, hujan lebat, kualitas udara, titik api, dan gunung api.',
  applicationName: 'SIAGA',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'SIAGA', statusBarStyle: 'black-translucent' },
  icons: { icon: '/icons/icon.svg', apple: '/icons/apple-touch-icon.png' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#06161f',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <body data-view="status">{children}</body>
    </html>
  );
}
