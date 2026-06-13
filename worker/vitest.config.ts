import path from "node:path";
import {
  defineWorkersConfig,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, "drizzle"));
  return {
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
      poolOptions: {
        workers: {
          wrangler: { configPath: "./wrangler.jsonc" },
          miniflare: {
            // vitest-pool-workers bundles wrangler 4.35.0, which predates the
            // GA `ratelimits` wrangler config key, so the bindings declared in
            // wrangler.jsonc are dropped (with a warning) when the pool parses
            // the config. Mirror them here as raw miniflare worker options.
            ratelimits: {
              RL_5: { simple: { limit: 5, period: 60 } },
              RL_10: { simple: { limit: 10, period: 60 } },
              RL_30: { simple: { limit: 30, period: 60 } },
            },
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
