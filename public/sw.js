const CACHE = "everflair-shell-v6";
const OFFLINE_URL = "/offline";
const STATIC_SHELL = [
  OFFLINE_URL,
  "/icon.svg?v=flair-violeta-1",
  "/icon-192.png?v=flair-violeta-1",
  "/icon-512.png?v=flair-violeta-1",
  "/icon-maskable-512.png?v=flair-violeta-1",
  "/apple-touch-icon-180.png?v=flair-violeta-1",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(STATIC_SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
});

self.addEventListener("push", (event) => {
  let message = {};
  try { message = event.data?.json() || {}; } catch { /* Ignore malformed payload. */ }
  const title = typeof message.title === "string" ? message.title : "Seu lembrete EverFlair";
  const body = typeof message.body === "string" ? message.body : "Confira seu agendamento no aplicativo.";
  const url = typeof message.url === "string" && /^\/book\/[a-z0-9-]+\/minhas$/.test(message.url)
    ? message.url : "/";
  // Som e vibração seguem o canal de notificação do sistema; `silent: false`
  // e `vibrate` garantem o alerta onde o navegador permite. O badge precisa
  // ser monocromático para não virar um quadrado branco na barra do Android.
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      tag: typeof message.tag === "string" ? message.tag : "everflair-reminder",
      renotify: true,
      silent: false,
      requireInteraction: true,
      vibrate: [200, 100, 200, 100, 200],
      data: { url },
    }),
    updateAppBadge(),
  ]));
});

async function updateAppBadge() {
  if (typeof self.navigator?.setAppBadge !== "function") return;
  try {
    const open = await self.registration.getNotifications();
    await self.navigator.setAppBadge(open.length || 1);
  } catch { /* Badging API é opcional. */ }
}

async function clearAppBadge() {
  if (typeof self.navigator?.setAppBadge !== "function") return;
  try {
    const open = await self.registration.getNotifications();
    if (open.length > 0) await self.navigator.setAppBadge(open.length);
    else await self.navigator.clearAppBadge();
  } catch { /* Badging API é opcional. */ }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(clearAppBadge());
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
    const target = new URL(url, self.location.origin).href;
    const existing = windows.find(client => client.url === target);
    if (existing) return existing.focus();
    return self.clients.openWindow(target);
  }));
});

self.addEventListener("notificationclose", (event) => {
  event.waitUntil(clearAppBadge());
});
