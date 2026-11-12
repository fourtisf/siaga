'use client';
import dynamic from 'next/dynamic';

const PantauApp = dynamic(() => import('@/components/pantau/PantauApp'), {
  ssr: false,
  loading: () => <div id="map" />,
});

export default function PantauClient() {
  return <PantauApp />;
}
