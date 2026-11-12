/* Service worker SIAGA: cache tampilan untuk luring, dan notifikasi peringatan. */
const VERSION = 'siaga-v1';
const SHELL = ['/', '/manifest.webmanifest', '/geo/indonesia.json', '/icons/icon-192.png', '/icons/badge-96.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // ubin peta CARTO & foto luar: biarkan browser

  // API: selalu jaringan. Aplikasi menyimpan status terakhir sendiri beserta waktunya,
  // jadi service worker tidak boleh menyajikan respons lama seolah baru.
  if (url.pathname.startsWith('/api/')) return;

  // Aset build berversi: cache dulu
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/') || url.pathname.startsWith('/geo/')) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Halaman: jaringan dulu, cadangan dari cache saat luring
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/')),
    );
  }
});

self.addEventListener('push', (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = { title: 'SIAGA', body: e.data ? e.data.text() : '' };
  }
  e.waitUntil(
    self.registration.showNotification(d.title || 'SIAGA', {
      body: d.body || '',
      tag: d.tag || 'siaga',
      renotify: true,
      requireInteraction: d.level === 2,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      lang: 'id',
      data: { url: d.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (new URL(c.url).origin === self.location.origin) {
          c.focus();
          return c.navigate(target);
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
