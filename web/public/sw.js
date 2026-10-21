/* Service Worker：缓存应用外壳；接口 GET 请求网络优先、失败回落缓存（离线只读）。 */
const SHELL = 'ca-shell-v1';
const API = 'ca-api-v1';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/index.html', '/manifest.webmanifest', '/icon-192.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => ![SHELL, API].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname.startsWith('/api/backup') || url.pathname.startsWith('/api/media')) return;
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(API).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req).then((r) => r || new Response(JSON.stringify({ error: { code: 'offline', message: '离线：显示的是缓存数据或暂无缓存' } }), { status: 503, headers: { 'content-type': 'application/json', 'x-offline': '1' } }))),
    );
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok && (url.pathname.startsWith('/assets/') || url.pathname === '/')) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match('/index.html'))));
});
