// Service worker: permite abrir la app sin conexión y recibir actualizaciones al reconectar.
// Cambia VERSION cuando publiques una actualización grande para limpiar la caché antigua.
const VERSION = 'mycards-v5';
const SHELL = ['./', './index.html', './js/app.js', './js/backend.js', './js/srs.js', './js/importer.js', './js/firebase-config.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Archivos de la app: primero la red (para recibir actualizaciones), si no hay conexión, la copia guardada.
  if (url.origin === location.origin) {
    // cache: 'no-cache' pregunta siempre al servidor si hay versión nueva (si no la hay, responde rápido con 304).
    e.respondWith(fetch(req, { cache: 'no-cache' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
    return;
  }
  // Librerías de Firebase y tipografías: versión fija, se guardan la primera vez.
  if (url.hostname === 'www.gstatic.com' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    })));
  }
});
