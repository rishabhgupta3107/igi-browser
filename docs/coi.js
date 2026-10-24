// Cross-origin isolation for hosts that can't send headers (GitHub Pages). The game's threads need
// SharedArrayBuffer, which browsers only allow on pages served with COOP/COEP. On such a host this script
// installs itself as a service worker that adds those headers to every response from the site, then reloads
// the page once; from then on the page is isolated. Where the server already sends them (web/serve.py,
// Cloudflare Pages or Netlify with _headers, the desktop app) it does nothing.
/* global self, clients */
if (typeof window === 'undefined') {
  // the service worker
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));
  self.addEventListener('fetch', (e) => {
    const r = e.request;
    if (r.cache === 'only-if-cached' && r.mode !== 'same-origin') return;
    if (new URL(r.url).origin !== self.location.origin) return;
    e.respondWith(fetch(r).then((res) => {
      if (res.status === 0) return res;
      const headers = new Headers(res.headers);
      headers.set('Cross-Origin-Opener-Policy', 'same-origin');
      headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
      headers.set('Cross-Origin-Resource-Policy', 'same-origin');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }));
  });
} else if (!window.crossOriginIsolated && window.isSecureContext && navigator.serviceWorker) {
  // the page: install the worker, then reload once under it (not again if that didn't help)
  const KEY = 'rc-coi-reloaded';
  let reloaded = false;
  try { reloaded = sessionStorage.getItem(KEY) === '1'; } catch {}
  const src = document.currentScript && document.currentScript.src;
  if (src && !reloaded) {
    navigator.serviceWorker.register(src).then((reg) => {
      const reload = () => {
        try { sessionStorage.setItem(KEY, '1'); sessionStorage.setItem('rc-referrer', document.referrer); } catch {}
        location.reload();
      };
      if (navigator.serviceWorker.controller) reload();   // a worker runs, but this page loaded before it
      else navigator.serviceWorker.ready.then(reload);    // once it's active (it claims open pages)
    }).catch((err) => console.warn('cross-origin isolation worker:', err));
  }
} else if (window.crossOriginIsolated) {
  try { sessionStorage.removeItem('rc-coi-reloaded'); } catch {}
}
