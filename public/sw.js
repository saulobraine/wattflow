/**
 * WattFlow Progressive Web App - Service Worker
 * Versão: wattflow-static-v1
 *
 * Diretrizes Críticas de Segurança:
 * 1. BYPASS ESTRITO NETWORK-ONLY PARA /api/*:
 *    Nenhuma rota de API ou telemetria jamais é interceptada para cache.
 * 2. MÉTODOS NÃO-GET:
 *    Sempre despachados diretamente via rede sem intervenção de cache.
 * 3. FALLBACK OFFLINE:
 *    Requisições de navegação (HTML) sem conexão retornam /offline.html.
 * 4. CICLO DE VIDA:
 *    skipWaiting no install, clients.claim e purga de caches obsoletos no activate.
 */

const CACHE_NAME = 'wattflow-static-v1';

const PRECACHE_ASSETS = [
  '/',
  '/offline.html',
  '/favicon.ico',
  '/favicon.svg',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Precache resiliente: adiciona os que estiverem disponíveis sem travar o SW se algum faltar
      await Promise.allSettled(
        PRECACHE_ASSETS.map((url) => cache.add(url))
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      const cacheKeys = await caches.keys();
      await Promise.all(
        cacheKeys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // 1. Bypass absoluto Network-Only para métodos mutáveis (POST, PUT, DELETE, PATCH, etc.)
  if (request.method !== 'GET') {
    return;
  }

  // 2. Bypass absoluto Network-Only para qualquer rota de API (/api/*)
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // 3. Fallback Offline para Navegação HTML (pages)
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(request);
          return networkResponse;
        } catch (networkError) {
          const cache = await caches.open(CACHE_NAME);
          const cachedOffline = await cache.match('/offline.html');
          return cachedOffline || new Response('Offline', { status: 503, statusText: 'Offline' });
        }
      })()
    );
    return;
  }

  // 4. Estratégia Stale-While-Revalidate para assets estáticos do Next.js, fontes Google e recursos de imagem/fonte
  const isGoogleFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  const isStaticAsset =
    isGoogleFont ||
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.ico') ||
    url.pathname.endsWith('.png');

  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        const fetchPromise = fetch(request)
          .then((networkResponse) => {
            if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, responseToCache);
              });
            }
            return networkResponse;
          })
          .catch(() => cachedResponse || (isGoogleFont ? new Response('', { status: 200, headers: { 'Content-Type': 'text/css' } }) : undefined));

        return cachedResponse || fetchPromise;
      })
    );
    return;
  }

  // 5. Demais requisições GET padrão: Network-First com cache fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && (response.status === 200 || response.type === 'opaque')) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.destination === 'document') {
          const cache = await caches.open(CACHE_NAME);
          return cache.match('/offline.html');
        }
        if (isGoogleFont) {
          return new Response('', { status: 200, headers: { 'Content-Type': 'text/css' } });
        }
        return new Response(null, { status: 504, statusText: 'Gateway Timeout' });
      })
  );
});
