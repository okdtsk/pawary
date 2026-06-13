import { readFileSync } from "node:fs";
import path from "node:path";
import {
  defineWorkersConfig,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers/config";

/**
 * vitest-pool-workers bundles wrangler 4.35.0, which predates the GA
 * `ratelimits` wrangler config key, so the bindings declared in wrangler.jsonc
 * are dropped (with a warning) when the pool parses the config. Derive the
 * miniflare worker options from wrangler.jsonc instead of duplicating them, so
 * the test bindings can never drift from production.
 */
function ratelimitsFromWranglerConfig(): Record<
  string,
  { simple: { limit: number; period: number } }
> {
  const jsonc = readFileSync(path.join(__dirname, "wrangler.jsonc"), "utf8");
  // strip // line comments (none appear inside strings in this file)
  const config = JSON.parse(jsonc.replace(/^\s*\/\/.*$/gm, "")) as {
    ratelimits?: Array<{ name: string; simple: { limit: number; period: number } }>;
  };
  if (!config.ratelimits?.length) {
    throw new Error("wrangler.jsonc has no top-level ratelimits — tests would silently lose enforcement");
  }
  return Object.fromEntries(
    config.ratelimits.map((r) => [r.name, { simple: r.simple }]),
  );
}

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, "drizzle"));
  return {
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
      poolOptions: {
        workers: {
          wrangler: { configPath: "./wrangler.jsonc" },
          miniflare: {
            ratelimits: ratelimitsFromWranglerConfig(),
            bindings: {
              TEST_MIGRATIONS: migrations,
              GOOGLE_CLIENT_ID: "test-client-id",
              GOOGLE_CLIENT_SECRET: "test-client-secret",
              ADVISOR_KEK: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
              // fixed test-only keypair (generated once with WebCrypto P-256)
              VAPID_PUBLIC_KEY:
                "BNGHLGFBSaLCJKkxF0F90WH-Owy-Fu-rQAESHwvM1f-3TJdNTk4ptFT8ccSrQ3OBoTumEmsEMY9VHsTVpTkGfhc",
              VAPID_PRIVATE_KEY: "QfpxMhtfrV8KQFnl8K5kYTvPk2VyurzuZnq4jDPGKAc",
            },
          },
        },
      },
    },
  };
});
