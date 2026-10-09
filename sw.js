/* =====================================================================
 * BINCO | Reto Comercial — sw.js (Service Worker)
 * Permite instalar la app (PC y celular) y abrirla aunque falle la red.
 * Estrategia "red primero": siempre intenta traer la versión más reciente
 * (incluida publicacion.json); si no hay conexión, usa la última copia guardada.
 * Al publicar una versión nueva del código, sube el número de CACHE.
 * ===================================================================== */
const CACHE = 'binco-reto-v11';
const SHELL = [
  './', './index.html', './styles.css', './app.js', './data-manager.js', './gamification.js',
  './manifest.webmanifest', './bootstrap.min.css', './bootstrap.bundle.min.js',
  './chart.umd.js', './xlsx.full.min.js',
  './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png', './favicon-32.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req, { cache: 'no-store' })
      .then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
  );
});
