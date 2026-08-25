/* OICR Monitor — network-first: online vedi sempre l'ultima versione, offline l'ultima scaricata */
/* Il nome della cache va cambiato a ogni ricablaggio: activate cancella tutte le
   cache che non si chiamano cosi', ed e' l'unico modo di buttare via la vecchia
   index.html da 2,2 MB che qualcuno ha ancora nel telefono. */
const CACHE = 'oicr-monitor-v2';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './apple-touch-icon.png',
  './icon-192.png', './icon-512.png', './data/bootstrap.json'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(r => {
        if (r && r.status === 200 && r.type === 'basic') {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return r;
      })
      .catch(() => caches.match(e.request).then(m => m || caches.match('./index.html')))
  );
});
