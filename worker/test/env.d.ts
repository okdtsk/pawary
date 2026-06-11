import type { D1Migration } from "@cloudflare/vitest-pool-workers/config";
import type { Env } from "../src/env";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}

// workerd extends Headers with getSetCookie() per the Fetch spec
declare global {
  interface Headers {
    getSetCookie(): string[];
  }
}
