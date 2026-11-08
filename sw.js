// Service worker : l'appli fonctionne même sans connexion (sauf dictée et envoi des mails).
const CACHE = 'izinote-v16';
const ASSETS = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest',
  'js/app.js', 'js/db.js', 'js/util.js', 'js/editor.js', 'js/pdfexport.js', 'js/gmail.js', 'js/reports.js', 'js/gridimport.js', 'js/convert.js', 'js/stamps.js', 'js/schedule.js', 'js/relayscript.js', 'js/distribute.js', 'js/sync.js',
  'lib/pdf.min.js', 'lib/pdf.worker.min.js', 'lib/pdf-lib.min.js', 'lib/xlsx.full.min.js', 'lib/word/jszip.min.js', 'lib/word/docx-preview.min.js', 'lib/word/html2canvas.min.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon-64.png',
  'assets/logo-simplifie.png', 'assets/logo-complet.png', 'assets/icone.png',
  'assets/chargement.gif',
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});
// Réseau d'abord pour avoir les mises à jour, cache si hors ligne.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    // no-cache : on revalide auprès du serveur au lieu d'utiliser le cache HTTP (10 min sur GitHub Pages)
    fetch(e.request, { cache: 'no-cache' })
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
