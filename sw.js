// Service worker de Mi Caja: guarda la app en el celular para que abra sin señal.
// Las llamadas a la planilla (Apps Script, otro dominio) no pasan por acá: las maneja la app con su cola de cambios.
/* STAMP:BEGIN */
const BUILD = '296314411e';
const SHELL = ["./","css/app.css","icons/apple-touch-icon.png","icons/favicon-32.png","icons/icon-192.png","icons/icon-512.png","icons/maskable-512.png","index.html","js/api.js","js/app.js","js/book.js","js/connect.js","js/core.js","js/icons.js","js/ledger.js","js/mock.js","js/store.js","js/sync.js","js/version.js","manifest.webmanifest"];
/* STAMP:END */
const CACHE = `mc-shell-${BUILD}`;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('mc-shell-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// La app pide pasar a la versión nueva cuando el usuario toca "Actualizar" (nunca en medio de una carga).
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
  if (e.data === 'BUILD' && e.source) e.source.postMessage({ build: BUILD });
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
      return res;
    } catch (err) {
      if (req.mode === 'navigate') {
        const fallback = (await cache.match('index.html')) || (await cache.match('./'));
        if (fallback) return fallback;
      }
      return new Response('Sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
