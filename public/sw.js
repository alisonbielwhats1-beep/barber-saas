const CACHE = "everflair-shell-v5";
const OFFLINE_URL = "/offline";
const STATIC_SHELL = [
  OFFLINE_URL,
  "/icon.svg?v=flair-dark-1",
  "/icon-192.png?v=flair-dark-1",
  "/icon-512.png?v=flair-dark-1",
  "/icon-maskable-512.png?v=flair-dark-1",
  "/apple-touch-icon-180.png?v=flair-dark-1",
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
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: typeof message.tag === "string" ? message.tag : "everflair-reminder",
    renotify: false,
    data: { url },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
    const target = new URL(url, self.location.origin).href;
    const existing = windows.find(client => client.url === target);
    if (existing) return existing.focus();
    return self.clients.openWindow(target);
  }));
});
