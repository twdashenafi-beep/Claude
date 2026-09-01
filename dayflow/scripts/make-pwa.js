// Turns the Expo web export into an installable web app.
//
// Expo's web template has no PWA metadata, so "Add to Home Screen" on iPhone
// or iPad produces a plain Safari bookmark rather than a standalone app. This
// runs after `expo export` and adds the manifest, the iOS-specific meta tags,
// the icons and a cache-first service worker so DayFlow opens full-screen and
// works offline.
//
// Usage: node scripts/make-pwa.js <outDir> [baseUrl]

const fs = require('fs');
const path = require('path');

const outDir = process.argv[2] || 'web-build';
// Normalised to always start with / and end with / — every URL below is built
// from it, and getting the trailing slash wrong silently breaks the scope.
const rawBase = process.argv[3] || '/';
const base = `/${rawBase.replace(/^\/+|\/+$/g, '')}/`.replace('//', '/');

const THEME = '#007AFF';
const BACKGROUND = '#FFFFFF';

function fail(message) {
  console.error(`make-pwa: ${message}`);
  process.exit(1);
}

const indexPath = path.join(outDir, 'index.html');
if (!fs.existsSync(indexPath)) fail(`${indexPath} not found — run the export first.`);

// ── Icons ───────────────────────────────────────────────────────────────────
const iconSrc = path.join(__dirname, '..', 'web');
for (const file of ['icon-180.png', 'icon-192.png', 'icon-512.png']) {
  const from = path.join(iconSrc, file);
  if (!fs.existsSync(from)) fail(`missing icon ${from}`);
  fs.copyFileSync(from, path.join(outDir, file));
}

// ── Manifest ────────────────────────────────────────────────────────────────
const manifest = {
  name: 'DayFlow',
  short_name: 'DayFlow',
  description: 'AI-powered task manager with end-to-end encryption',
  start_url: base,
  scope: base,
  display: 'standalone',
  orientation: 'any',
  background_color: BACKGROUND,
  theme_color: THEME,
  icons: [
    { src: `${base}icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: `${base}icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
  ],
};
fs.writeFileSync(path.join(outDir, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));

// ── Service worker ──────────────────────────────────────────────────────────
// Cache-first for the app shell so DayFlow opens with no network. Task data is
// never cached here — it lives in localStorage, encrypted.
const assets = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else assets.push('/' + path.relative(outDir, full).split(path.sep).join('/'));
  }
}
walk(outDir);

const precache = [base, ...assets.map(a => (base + a.replace(/^\//, '')))]
  .filter(url => !url.endsWith('.map'));

// CACHE_VERSION is derived from the bundle list, so a new export produces a new
// cache name and the old one is evicted on activate.
const version = require('crypto')
  .createHash('sha1')
  .update(precache.join('|'))
  .digest('hex')
  .slice(0, 12);

fs.writeFileSync(
  path.join(outDir, 'sw.js'),
  `const CACHE = 'dayflow-${version}';
const PRECACHE = ${JSON.stringify(precache, null, 2)};

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const SHELL = '${base}';

function save(request, response) {
  if (response && response.ok) {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(request, copy));
  }
  return response;
}

// Content-hashed bundles cannot change under a given name, so cache-first is
// both safe and fastest for them. Everything else — the shell above all — has
// to be network-first: serving a cached index.html means a device that has
// installed the app never sees another deploy, which is a very quiet way to
// ship nothing.
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Not ours. API calls and anything else cross-origin go straight to the
  // network without passing through here at all.
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes('/_expo/static/')) {
    event.respondWith(
      caches.match(request).then(hit => hit || fetch(request).then(res => save(request, res)))
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then(res => save(request, res))
      .catch(() => caches.match(request).then(hit => {
        if (hit) return hit;
        // A navigation that misses the cache still needs the app shell back,
        // otherwise a deep link offline shows the browser error page.
        if (request.mode === 'navigate') return caches.match(SHELL);
        throw new Error('offline');
      }))
  );
});
`
);

// ── HTML head + registration ────────────────────────────────────────────────
let html = fs.readFileSync(indexPath, 'utf8');
if (html.includes('manifest.webmanifest')) {
  console.log('make-pwa: already processed, skipping');
  process.exit(0);
}

const head = `
    <meta name="theme-color" content="${THEME}" />
    <meta name="description" content="AI-powered task manager with end-to-end encryption" />
    <link rel="manifest" href="${base}manifest.webmanifest" />
    <link rel="apple-touch-icon" href="${base}icon-180.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="apple-mobile-web-app-title" content="DayFlow" />
  `;

// viewport-fit=cover lets the app paint under the iPhone status bar and home
// indicator once it is running standalone from the home screen.
html = html.replace(
  /(<meta name="viewport"[^>]*content=")([^"]*)(")/,
  (_, pre, content, post) => `${pre}${content}, viewport-fit=cover${post}`
);

html = html.replace('</head>', `${head}</head>`);
html = html.replace(
  '</body>',
  `  <script>
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('${base}sw.js', { scope: '${base}' }).catch(function () {});
      });
    }
  </script>
</body>`
);

fs.writeFileSync(indexPath, html);
console.log(`make-pwa: wrote manifest, icons and service worker to ${outDir} (base ${base})`);
console.log(`make-pwa: precached ${precache.length} files`);
