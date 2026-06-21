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
