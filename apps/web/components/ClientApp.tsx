'use client';
import dynamic from 'next/dynamic';

/** Kerangka yang tampil sebelum JavaScript peta dimuat. */
function Shell() {
  return (
    <>
      <div id="map" />
      <main className="col">
        <header className="hd">
          <div className="brand">
            <svg viewBox="0 0 28 28" fill="none" aria-hidden="true">
              <circle cx="14" cy="14" r="12.5" stroke="#f1f5f2" strokeOpacity=".28" />
              <circle cx="14" cy="14" r="7.5" stroke="#f1f5f2" strokeOpacity=".55" />
              <path d="M14 14 23 5.5" stroke="#f1f5f2" strokeWidth="1.8" strokeLinecap="round" />
              <circle cx="14" cy="14" r="2.6" fill="#f1f5f2" />
              <circle cx="20.2" cy="18.6" r="1.7" fill="#ff7a9c" />
            </svg>
            <b>SIAGA</b>
          </div>
        </header>
        <section className="view" id="v-status">
          <div className="skel">Memuat SIAGA…</div>
        </section>
        <nav className="nav" />
      </main>
    </>
  );
}

const SiagaApp = dynamic(() => import('./SiagaApp'), { ssr: false, loading: Shell });

export default function ClientApp() {
  return <SiagaApp />;
}
