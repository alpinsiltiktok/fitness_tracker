const CACHE_NAME = 'stride-spoon-shell-v1';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './nutrition.js',
  './food-scan.js',
  './strava-import.js',
  './strava-ocr.js',
  './manifest.webmanifest',
  './icons/stride-icon.svg',
];
const APP_ASSETS = new Set(APP_SHELL.map((path) => new URL(path, self.registration.scope).pathname));

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith('stride-spoon-shell-') && cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  const isNavigation = request.mode === 'navigate';
  if (!isNavigation && !APP_ASSETS.has(new URL(request.url).pathname)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    } catch (error) {
      const cachedResponse = await cache.match(request, { ignoreSearch: true });
      if (cachedResponse) return cachedResponse;
      if (isNavigation) {
        const offlinePage = await cache.match(new URL('./index.html', self.registration.scope).href);
        if (offlinePage) return offlinePage;
      }
      throw error;
    }
  })());
});
