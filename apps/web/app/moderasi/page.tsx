import type { Metadata } from 'next';
import Moderation from './Moderation';

export const metadata: Metadata = { title: 'Moderasi laporan — SIAGA', robots: { index: false, follow: false } };

export default function Page() {
  return <Moderation />;
}
