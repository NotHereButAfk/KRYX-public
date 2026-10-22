// Only a fallback document is cached. Game builds and account responses always use the network.
const CACHE = 'kryx-maintenance-v1';
const PAGE = '/maintenance.html';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(async cache => {
    const response = await fetch(PAGE, {cache:'reload'});
    if (!response.ok) throw new Error('Maintenance fallback unavailable');
    await cache.put(PAGE,response);
    await self.skipWaiting();
  }));
});
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || event.request.mode !== 'navigate'
      || url.origin !== self.location.origin || !['/','/index.html','/preview.html'].includes(url.pathname)) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (response.status < 500) return response;
      return (await caches.match(PAGE,{cacheName:CACHE})) || response;
    } catch (error) {
      const fallback = await caches.match(PAGE,{cacheName:CACHE});
      if (fallback) return fallback;
      throw error;
    }
  })());
});
