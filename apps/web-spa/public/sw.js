const CACHE = 'weavine-v3';

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

// All backend endpoints live under /api/. v2 only checked paths like
// `/contacts` (the SPA route name), which fails to match `/api/contacts/:id`
// — so GET /api/contacts/:id was being routed through the cache-then-network
// handler and served stale responses from the cache. Result: invalidating
// React Query for ['contact', id] kept returning the old avatar_storage_key,
// so the avatar never updated. Always bypass /api/ now.
function isApiRequest(url) {
  return url.pathname.startsWith('/api/');
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