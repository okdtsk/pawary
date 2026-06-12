/// <reference lib="webworker" />
/**
 * Custom service worker (injectManifest). Reproduces 1:1 the behavior that
 * vite-plugin-pwa's generateSW mode used to emit:
 *  - prompt-style updates: skipWaiting() only on the SKIP_WAITING message
 *    sent by `virtual:pwa-register/react` (no clientsClaim, matching the
 *    previously generated sw.js)
 *  - precache of the build manifest + cleanupOutdatedCaches
 *  - SPA navigation fallback to /index.html, denylisting /api/
 *  - runtime caching: /api/auth/ NetworkOnly, /api/photos/ CacheFirst,
 *    other /api/ NetworkFirst (3 s network budget)
 */
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { ExpirationPlugin } from "workbox-expiration";
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
  type PrecacheEntry,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { CacheFirst, NetworkFirst, NetworkOnly } from "workbox-strategies";

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: (string | PrecacheEntry)[];
};

// Prompt-style update flow: UpdatePrompt (useRegisterSW) posts SKIP_WAITING
// when the user accepts the reload toast.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// SPA navigation fallback, never for API routes.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/index.html"), {
    denylist: [/^\/api\//],
  }),
);

// OAuth redirects, dev-login, logout: never cached.
registerRoute(
  ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/api/auth/"),
  new NetworkOnly(),
  "GET",
);

// Photo bytes are immutable per id (spec §8: photos cache-first).
registerRoute(
  ({ url, sameOrigin }) =>
    sameOrigin && url.pathname.startsWith("/api/photos/"),
  new CacheFirst({
    cacheName: "pawary-photos",
    plugins: [
      new ExpirationPlugin({
        maxEntries: 200,
        maxAgeSeconds: 30 * 24 * 3600,
        purgeOnQuotaError: true,
      }),
      new CacheableResponsePlugin({ statuses: [200] }),
    ],
  }),
  "GET",
);

// API reads: fresh when online (3 s budget), cached when offline.
// Deliberate deviation from spec §8's SWR — see plan 8 header.
registerRoute(
  ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/api/"),
  new NetworkFirst({
    cacheName: "pawary-api",
    networkTimeoutSeconds: 3,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 200,
        maxAgeSeconds: 7 * 24 * 3600,
        purgeOnQuotaError: true,
      }),
      new CacheableResponsePlugin({ statuses: [200] }),
    ],
  }),
  "GET",
);
