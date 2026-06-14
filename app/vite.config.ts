import { execSync } from "node:child_process";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Short commit hash of the deployed build. CI passes the real source commit
// via APP_COMMIT_SHA (NOT GITHUB_SHA, which is a synthetic merge commit on
// pull_request events); locally we fall back to git, then to "dev".
function resolveCommitHash(): string {
  const ciSha = process.env.APP_COMMIT_SHA;
  if (ciSha) return ciSha.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "dev";
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(resolveCommitHash()),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "prompt",
      manifest: {
        id: "/",
        name: "Pawary",
        short_name: "Pawary",
        description: "Pet activity log & health management for the whole family",
        lang: "en",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        theme_color: "#db7434",
        background_color: "#faf3e7",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/icon-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      // Caching/update behavior lives in src/sw.ts (custom SW, injectManifest).
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
      },
    }),
  ],
  server: {
    proxy: { "/api": "http://localhost:8787" },
  },
});
