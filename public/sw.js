// MebelFlow service worker: app shell offline + faster repeat starts.
//
//   HTML (navigations)     network first; offline → the last cached app shell,
//                          or a small «Нет связи» page on a first visit
//   /assets/* (hashed)     cache first — the file name changes with content
//   icons, fonts, logos    cache, refreshed in the background
//   /api/*                 never cached — orders, money and clients must not
//                          linger on the phone, and must always be current
//
// Bump VERSION to drop every old cache on the next visit.
const VERSION = 'mf-v1';
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;
const STATIC = `${VERSION}-static`;

const OFFLINE_HTML = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Нет связи · MebelFlow</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 system-ui,sans-serif;background:#EEF1F7;color:#111827;text-align:center;padding:24px}
@media (prefers-color-scheme:dark){body{background:#0F1217;color:#E5E7EB}}button{margin-top:16px;padding:12px 22px;border:0;border-radius:10px;background:#2563EB;color:#fff;font:600 15px system-ui}</style>
</head><body><div><div style="font-size:40px">📡</div><h2>Нет подключения к интернету</h2>
<p>MebelFlow откроется, как только связь вернётся.</p><button onclick="location.reload()">Повторить</button></div>
<script>addEventListener('online',()=>location.reload())</script></body></html>`;

self.addEventListener('install', (event) => {
  // Pre-cache the shell so even the first offline start shows the app.
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/app.html'])).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Data and auth: straight to the network, never stored.
  if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/branding/')) return;
  if (url.pathname === '/health' || url.pathname === '/sw.js') return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) {
          const cache = await caches.open(SHELL);
          cache.put(url.pathname === '/app.html' ? '/app.html' : '/', res.clone());
        }
        return res;
      } catch {
        const cached = await caches.match(url.pathname === '/app.html' ? '/app.html' : '/');
        return cached || new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok) {
        const cache = await caches.open(ASSETS);
        await cache.put(req, res.clone());
        // Every deploy adds new hashed files; keep only the newest ones.
        const keys = await cache.keys();
        await Promise.all(keys.slice(0, Math.max(0, keys.length - 40)).map((k) => cache.delete(k)));
      }
      return res;
    })());
    return;
  }

  if (/^\/(favicon|brand-logos|api\/branding)\//.test(url.pathname) || url.pathname === '/site.webmanifest') {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC);
      const cached = await cache.match(req);
      const fresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
      return cached || (await fresh) || Response.error();
    })());
  }
});
