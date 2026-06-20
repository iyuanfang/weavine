const CACHE = 'prm-v1';

const PRECACHE_URLS = [
  '/',
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

// ── Fetch (stale-while-revalidate) ───────────────────
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  // Skip non-http(s) requests (e.g., chrome-extension://)
  const url = new URL(event.request.url);
  if (!url.protocol.startsWith('http')) return;

  // API calls → network only (no cache, so data is always fresh)
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Next.js data requests (_next/data) → network first, cache fallback
  if (url.pathname.startsWith('/_next/data/')) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request)),
    );
    return;
  }

  // Static assets / pages → stale-while-revalidate
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, clone));
          return res;
        })
        .catch(() => cached); // fallback to cached even if fetch fails silently

      return cached || fetchPromise;
    }),
  );
});

// ── Push notification (existing) ─────────────────────
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
