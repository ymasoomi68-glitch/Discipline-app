/* ═══════════════════════════════════════════════════
   📱 Service Worker - دفتر انضباطی
   ═══════════════════════════════════════════════════ */

var CACHE_NAME = 'discipline-book-v11';
var CACHE_FILES = [
    './',
    './index.html',
    './teacher.html',
    './manifest.json',
    './manifest-teacher.json',
    './icon-t-192.png',
    './icon-t-512.png',
    './apple-touch-icon-t.png',
    './icon-192.png',
    './icon-512.png',
    './icon-maskable-512.png',
    './apple-touch-icon.png',
    './favicon.png'
];

// ===== نصب =====
self.addEventListener('install', function(event) {
    console.log('✅ Service Worker نصب شد');
    event.waitUntil(
        caches.open(CACHE_NAME).then(function(cache) {
            return cache.addAll(CACHE_FILES);
        }).catch(function(err) {
            console.log('خطا در کش کردن:', err);
        })
    );
    self.skipWaiting();
});

// ===== فعال‌سازی =====
self.addEventListener('activate', function(event) {
    console.log('✅ Service Worker فعال شد');
    event.waitUntil(
        caches.keys().then(function(names) {
            return Promise.all(
                names.filter(function(name) {
                    return name !== CACHE_NAME;
                }).map(function(name) {
                    return caches.delete(name);
                })
            );
        })
    );
    self.clients.claim();
});

// ===== دریافت =====
self.addEventListener('fetch', function(event) {
    // فقط درخواست‌های GET رو کش کن
    if (event.request.method !== 'GET') return;

    // درخواست‌های API سیدا رو کش نکن
    if (event.request.url.indexOf('/api/') !== -1) return;

    var reqUrl = new URL(event.request.url);
    // درخواست‌های خارج از این سایت (مثل GitHub) را دست نزن
    if (reqUrl.origin !== self.location.origin) return;
    // فایل نسخه همیشه از شبکه خوانده شود
    if (/\/version\.json$/.test(reqUrl.pathname)) return;

    event.respondWith(
        caches.match(event.request).then(function(cached) {
            // اگه توی کش هست، برگردون (Cache First)
            if (cached) return cached;

            // وگرنه از شبکه بگیر
            return fetch(event.request).then(function(response) {
                // فقط پاسخ‌های موفق رو کش کن
                if (!response || response.status !== 200 || response.type === 'opaque') {
                    return response;
                }

                var responseClone = response.clone();
                caches.open(CACHE_NAME).then(function(cache) {
                    cache.put(event.request, responseClone);
                });
                return response;
            }).catch(function() {
                // اگه شبکه نبود، صفحهٔ اصلی رو برگردون
                return caches.match('./index.html');
            });
        })
    );
});
