// Generated into dist/sw.js at build time. Caches the app so it works without a connection.
// It never sees your documents: they are read from your disk by the page and never requested over the network.
const VERSION = '__VERSION__';
const SHELL = __SHELL__;
const SHELL_CACHE = `hilvana-shell-${VERSION}`;
const ASSET_CACHE = 'hilvana-assets-v1'; // fonts and pdf.js data: versioned by file name, safe to keep

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('hilvana-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const lazy = /\/(fonts|pdfjs)\//.test(url.pathname);
  event.respondWith((async () => {
    // ignoreVary: some servers send "Vary: Origin" for module scripts, which would make every lookup miss.
    const hit = await caches.match(req, { ignoreSearch: true, ignoreVary: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && lazy) (await caches.open(ASSET_CACHE)).put(req, res.clone());
      return res;
    } catch {
      if (req.mode === 'navigate') {
        const index = await caches.match('./', { ignoreSearch: true, ignoreVary: true });
        if (index) return index;
      }
      // Offline and not cached: answer like a server would, instead of an error the browser reports.
      return new Response('', { status: 503, statusText: 'Offline' });
    }
  })());
});
