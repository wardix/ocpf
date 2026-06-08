const CACHE_NAME = 'ocpf-cache-v1';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/vite.svg'
];

// Instalasi SW dan cache asset statis
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Aktivasi dan hapus cache lama
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.filter(name => name !== CACHE_NAME).map(name => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Intercept requests: Network First for API, Cache First for Static Assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Jangan cache request ke API server (node.js / bun) atau WebSocket
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/ws') || url.protocol === 'ws:' || url.protocol === 'wss:') {
    event.respondWith(fetch(event.request));
    return;
  }

  // Cache First strategy untuk file statis / halaman web
  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) {
        return response; // Return dari cache jika ada
      }
      return fetch(event.request).then((networkResponse) => {
        // Jangan simpan respons gagal
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        
        // Simpan ke cache untuk request berikutnya
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        
        return networkResponse;
      });
    })
  );
});
