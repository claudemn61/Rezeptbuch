const VERSION = 'v7';
const SHELL = `rezeptbuch-shell-${VERSION}`;
const IMGS = 'rezeptbuch-images';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'data.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
const MAX_IMGS = 400;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('rezeptbuch-shell-') && k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_IMGS) await Promise.all(keys.slice(0, keys.length - MAX_IMGS).map(k => cache.delete(k)));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // App-Dateien: zuerst Netz (damit Updates ankommen), sonst Cache
  if (url.origin === location.origin) {
    e.respondWith(fetch(req, { cache: 'no-store' }).then(res => {
      const copy = res.clone();
      caches.open(SHELL).then(c => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('index.html'))));
    return;
  }

  // Bilder von aussen: einmal gesehen, später auch offline verfügbar
  if (req.destination === 'image') {
    e.respondWith(caches.open(IMGS).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) { c.put(req, res.clone()); trim(c); }
        return res;
      } catch { return hit || Response.error(); }
    }));
  }
});
