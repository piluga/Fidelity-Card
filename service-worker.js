const CACHE_NAME = 'fidelity-app-v2';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json',
    './assets/icons/user-avatar.png'
];

// Installazione del Service Worker e salvataggio in cache
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('Cache aperta');
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
});

// Attivazione e pulizia delle vecchie cache (utile per gli aggiornamenti futuri)
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        return caches.delete(cache);
                    }
                })
            );
        })
    );
});

// Intercettazione delle richieste di rete (Network First, fallback su Cache)
self.addEventListener('fetch', (event) => {
    event.respondWith(
        fetch(event.request).catch(() => {
            return caches.match(event.request);
        })
    );

});
