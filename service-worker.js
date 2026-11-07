// ==========================================================================
// FILE: service-worker.js (JAPAR PANEL v4.0 - ZERO-SOCKET PWA CACHE MANAGER)
// FUNGSI:
//   1. 100% Zero-Socket (Tanpa SDK Firebase / FCM WebSocket di Latar Belakang).
//   2. Strategi Network-First dengan fallback Cache untuk index.html, CSS, dan JS
//      agar pembaruan kode langsung aktif tanpa tersangkut cache lama.
//   3. Strategi Cache-First khusus untuk aset gambar, ikon, dan font statis.
// ==========================================================================

let cachedUidMerchant = '';

const CACHE_CORE_NAME = 'japar-resto-panel-v4.0.0';

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_CORE_NAME).then((cache) => {
            return cache.addAll([
                './',
                './index.html',
                './manifest.json',
                './css/style.css',
                './css/components.css',
                './assets/logo.png',
                './assets/icon-192.png',
                './assets/icon-512.png'
            ]).catch(() => {});
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((k) => {
                    if (k !== CACHE_CORE_NAME) {
                        return caches.delete(k);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('message', (event) => {
    if (!event.data) return;
    if (event.data.type === 'JAPAR_SET_MERCHANT_UID' && event.data.uid) {
        cachedUidMerchant = String(event.data.uid).trim();
    }
    if (event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if ('focus' in client) return client.focus();
            }
            if (self.clients.openWindow) return self.clients.openWindow('./index.html');
        })
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) return;

    if (url.origin === self.location.origin) {
        const isStaticImageOrFont = /\.(png|jpg|jpeg|webp|svg|ico|woff2?)$/i.test(url.pathname);

        if (isStaticImageOrFont) {
            event.respondWith(
                caches.match(req).then((cached) => {
                    if (cached) return cached;
                    return fetch(req).then((netRes) => {
                        if (netRes && netRes.status === 200) {
                            const clone = netRes.clone();
                            caches.open(CACHE_CORE_NAME).then((c) => c.put(req, clone)).catch(() => {});
                        }
                        return netRes;
                    });
                })
            );
            return;
        }

        event.respondWith(
            fetch(req)
                .then((netRes) => {
                    if (netRes && netRes.status === 200) {
                        const clone = netRes.clone();
                        caches.open(CACHE_CORE_NAME).then((c) => c.put(req, clone)).catch(() => {});
                    }
                    return netRes;
                })
                .catch(() => {
                    return caches.match(req).then((cachedRes) => {
                        if (cachedRes) return cachedRes;
                        if (req.mode === 'navigate') {
                            return caches.match('./index.html');
                        }
                        return cachedRes;
                    });
                })
        );
    }
});
