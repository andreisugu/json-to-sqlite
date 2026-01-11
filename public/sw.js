// Service Worker for JSON to SQLite Converter
// This enables offline functionality by caching all necessary resources

const CACHE_NAME = 'json-to-sqlite-v1';
const BASE_PATH = '/json-to-sqlite';

// Core static assets to cache immediately on install
// These are the minimal files needed for the app to work
const CORE_ASSETS = [
  `${BASE_PATH}/`,
  `${BASE_PATH}/manifest.json`,
  `${BASE_PATH}/icon-192.svg`,
  `${BASE_PATH}/icon-512.svg`,
  `${BASE_PATH}/workers/db-worker.js`,
];

// External CDN resources used by the worker
const CDN_RESOURCES = [
  'https://esm.sh/sql.js@1.10.3',
  'https://esm.sh/@streamparser/json@0.0.22',
  'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.wasm',
];

// Install event: cache core assets
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching core assets...');
      
      // Cache core assets - these are essential
      const corePromise = cache.addAll(CORE_ASSETS).catch((err) => {
        console.error('[Service Worker] Failed to cache core assets:', err);
        // Log which asset failed
        return Promise.all(
          CORE_ASSETS.map(url => 
            cache.add(url).catch(e => console.error('[Service Worker] Failed to cache:', url, e))
          )
        );
      });
      
      // Cache CDN resources individually to handle failures gracefully
      const cdnPromises = CDN_RESOURCES.map((url) => 
        fetch(url, { mode: 'cors' })
          .then((response) => {
            if (response.ok) {
              return cache.put(url, response);
            }
            console.warn('[Service Worker] Failed to fetch CDN resource:', url);
            return Promise.resolve();
          })
          .catch((err) => {
            console.warn('[Service Worker] Error caching CDN resource:', url, err);
            return Promise.resolve();
          })
      );
      
      return Promise.all([corePromise, ...cdnPromises]);
    }).then(() => {
      console.log('[Service Worker] Installation complete');
      // Skip waiting to activate immediately
      return self.skipWaiting();
    })
  );
});

// Activate event: clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('[Service Worker] Activation complete');
      // Take control of all pages immediately
      return self.clients.claim();
    })
  );
});

// Fetch event: Network-first strategy for HTML, Cache-first for static assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }
  
  // Skip chrome-extension and other non-http(s) requests
  if (!url.protocol.startsWith('http')) {
    return;
  }
  
  // Determine caching strategy based on resource type
  const isHTML = request.headers.get('accept')?.includes('text/html');
  const isCDN = url.hostname === 'esm.sh' || url.hostname === 'cdnjs.cloudflare.com';
  const isAppResource = url.origin === location.origin;
  
  if (isHTML) {
    // Network-first for HTML to get updates
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache the new version
          if (response.ok) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return response;
        })
        .catch(() => {
          // Fallback to cache if offline
          return caches.match(request);
        })
    );
  } else {
    // Cache-first for all other resources (JS, CSS, images, CDN, etc.)
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          console.log('[Service Worker] Serving from cache:', request.url);
          return cachedResponse;
        }
        
        // Not in cache, fetch from network
        console.log('[Service Worker] Fetching from network:', request.url);
        return fetch(request).then((response) => {
          // Don't cache non-successful responses
          if (!response || response.status !== 200) {
            return response;
          }
          
          // Cache same-origin resources and CDN resources
          const shouldCache = isAppResource || isCDN;
          
          if (shouldCache) {
            // Clone the response before caching
            const responseToCache = response.clone();
            
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
              console.log('[Service Worker] Cached new resource:', request.url);
            });
          }
          
          return response;
        }).catch((error) => {
          console.error('[Service Worker] Fetch failed:', request.url, error);
          throw error;
        });
      })
    );
  }
});

// Handle messages from the client
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CACHE_URLS') {
    const urls = event.data.urls || [];
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => {
        return Promise.all(
          urls.map((url) => 
            fetch(url)
              .then((response) => cache.put(url, response))
              .catch((err) => console.warn('[Service Worker] Failed to cache URL:', url, err))
          )
        );
      })
    );
  }
});
