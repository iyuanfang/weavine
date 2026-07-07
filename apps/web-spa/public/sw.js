const CACHE = 'prm-v8';

const PRECACHE_URLS = [
  '/',
  '/login',
  '/today',
  '/contacts',
  '/calendar',
  '/actions',
  '/reminders',
  '/tags',
  '/settings',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon.png',
  '/logo.svg',
];

const API_PATHS = [
  '/actions',
  '/contacts',
  '/events',
  '/tags',
  '/interactions',
  '/reminders',
  '/settings',
  '/search',
  '/auth',
  '/diagnostic',
];

function isApiRequest(url) {
  return API_PATHS.some(
    (p) => url.pathname === p || url.pathname.startsWith(p + '/'),
  );
}

// ── Install ──────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    }),
  );
  self.skipWaiting();
});

// ── Activate ─────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
      );
    }),
  );
  self.clients.claim();
});

// ── Fetch ───────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (!url.protocol.startsWith('http')) return;

  if (isApiRequest(url)) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, clone));
          return res;
        })
        .catch(() => cached);

      return cached || fetchPromise;
    }),
  );
});

// ── Push notification ────────────────────────────────
self.addEventListener('push', (event) => {
  let data = { title: 'PRM 提醒', body: '', link: '/' };
  try {
    if (event.data) {
      data = { ...data, ...event.data.json() };
    }
  } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      data: { link: data.link },
      icon: '/icon.png',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link ?? '/';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((cs) => {
      for (const c of cs) {
        if (c.url.includes(link)) return c.focus();
      }
      return clients.openWindow(link);
    }),
  );
});