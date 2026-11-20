// Mailemu Bodega · guarda la app en el aparato para que abra sin señal.
// Siempre intenta traer la versión nueva de internet; si no hay señal, usa la última guardada.
// Los datos (Supabase) no pasan por aquí: los maneja la app (lecturas guardadas y cola de registros).
const CACHE = 'bodega-app';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// La app avisa qué archivos usó al abrir (página, estilos, código, fuentes) para guardarlos todos
self.addEventListener('message', (e) => {
  const urls = (e.data && e.data.cachear) || [];
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(urls.map((u) => fetch(u).then((r) => (r.ok ? c.put(u, r) : null)).catch(() => null)))));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).hostname.endsWith('supabase.co')) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copia = res.clone(); caches.open(CACHE).then((c) => c.put(req, copia)); }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r
        || (req.mode === 'navigate' ? caches.match('./').then((x) => x || caches.match('./index.html')) : Response.error()))),
  );
});
