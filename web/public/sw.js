/**
 * Homepress service worker — network pass-through only.
 * Satisfies Chromium installability (real fetch handler). No offline cache.
 * skipWaiting + clients.claim so a new worker can take over promptly after update().
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
