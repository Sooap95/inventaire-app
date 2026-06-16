// ================================================================
// Service Worker — Inventaire Maison
// Met l'app shell en cache pour qu'elle s'ouvre hors-ligne (ex. au fond
// du magasin sans réseau). Les données, elles, sont gérées en temps réel
// par Firestore (avec sa propre persistance hors-ligne) — on ne touche pas
// à son trafic réseau.
// ⚠️ Incrémente CACHE (v1 → v2…) à chaque mise à jour de l'appli pour
//    forcer le rafraîchissement chez les utilisateurs.
// ================================================================
const CACHE = 'inventaire-maison-v3';

// Ressources de base mises en cache à l'installation
const CORE = [
  './',
  './index.html',
  './manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      // addAll est atomique : on tolère un échec (le cache se remplira à l'usage)
      .then(c => Promise.allSettled(CORE.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // Ne JAMAIS intercepter les API tierces : Firestore/Google APIs (gérées par le
  // SDK) ET Open Food Facts (lookup produit en direct). Les laisser passer évite
  // que le cache du SW interfère avec ces requêtes réseau.
  if (/firestore\.googleapis\.com|googleapis\.com|firebaseio\.com|google\.firestore|openfoodfacts\.org/.test(req.url)) {
    return;
  }

  // App shell + librairies CDN : "stale-while-revalidate"
  // (réponse immédiate depuis le cache, mise à jour en arrière-plan).
  e.respondWith(
    caches.match(req).then(cached => {
      const fromNet = fetch(req).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || fromNet;
    })
  );
});
