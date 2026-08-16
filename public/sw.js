const CACHE = 'cra-coquille-v2'

// Uniquement des fichiers statiques servis tels quels. `/saisie` en faisait
// partie : c'est un `redirect()` vers `/saisie/AAAA-MM`, et `cache.addAll` ne
// met en cache que ce que le serveur rend. Une réponse redirigée ne peut pas
// servir une requête de navigation (mode `manual`) — au mieux l'entrée était
// inutilisable, au pire l'installation entière échouait et le service worker
// ne s'activait jamais. Aucune page authentifiée ici non plus : une page mise
// en cache serait servie à la session suivante.
const COQUILLE = ['/manifest.webmanifest', '/icon.svg', '/apple-touch-icon.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(COQUILLE)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((noms) => Promise.all(noms.filter((n) => n !== CACHE).map((n) => caches.delete(n)))),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request

  // Le fonctionnement hors ligne relève du lot 5 : il demande une file locale
  // et un arbitrage au retour du réseau. Tant qu'ils n'existent pas, ce
  // service worker ne touche à aucune écriture ni à aucune route d'API — une
  // saisie mise en cache et jamais rejouée serait une perte silencieuse.
  if (request.method !== 'GET') return
  if (new URL(request.url).pathname.startsWith('/api/')) return

  // Réseau d'abord : la coquille en cache ne sert qu'au démarrage instantané,
  // jamais à servir des données périmées.
  event.respondWith(
    fetch(request).catch(() =>
      caches.match(request).then((reponse) => reponse ?? Response.error()),
    ),
  )
})
