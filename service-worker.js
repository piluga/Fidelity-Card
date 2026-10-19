const CACHE = 'fidelity-app-sicurezza-v2';
const ASSETS = ['./', './index.html', './style.css', './avvio.js', './app.js', './firebase-client.js', './firebase-config.js', './dati.js', './foto.js', './jsbarcode.js', './manifest.json', './icone/user-avatar.svg', './icone/icon-192.png', './icone/icon-512.png'];
const urls = new Set(ASSETS.map(path => new URL(path, self.registration.scope).href));
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))));
self.addEventListener('activate', event => event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('fidelity-app-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
    // Mai cache di Firebase, token, richieste POST o immagini private/esterne.
    if (event.request.method !== 'GET' || !urls.has(event.request.url)) return;
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(event.request)) || fetch(event.request)));
});
