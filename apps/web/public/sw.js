// Moodwave service worker: makes the app installable and fully offline.
// Shell is precached; same-origin assets are cache-first with background
// revalidation, so a returning visit works without network (the music
// library itself lives in IndexedDB, never in the HTTP cache).
const CACHE = "moodwave-v4";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: network-first (pick up new deploys), cache fallback offline.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Assets (js/css/wasm/images): serve from cache when present, always
  // revalidate in the background; serve network when not cached yet.
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      const network = await fetch(req)
        .then(async (res) => {
          if (res.ok) {
            try {
              await cache.put(req, res.clone());
            } catch {
              // Non-cacheable response (e.g. opaque); serve it anyway.
            }
          }
          return res;
        })
        .catch(() => null);
      return hit || network || Response.error();
    })()
  );
});
