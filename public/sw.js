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
