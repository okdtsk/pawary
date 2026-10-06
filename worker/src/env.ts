import type { Role } from "@pawary/shared";
import type { Pet, Session, User } from "./db/schema";
export type Env = {
  ALLOWED_EMAILS?: string;
  DB: D1Database;
  PHOTOS: R2Bucket;
  // Workers rate-limiting bindings (wrangler.jsonc `ratelimits`); the suffix
  // is the per-60s limit. See worker/src/lib/rate-limit.ts for the prefix map.
  RL_5: RateLimit;
  RL_10: RateLimit;
  RL_30: RateLimit;
  ENVIRONMENT: "development" | "preview" | "production";
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  ADVISOR_KEK: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  PREVIEW_LOGIN_SECRET: string;
};

export type AppEnv = {
  Bindings: Env;
  Variables: {
    user: User;
    session: Session;
    // Set by requirePetRole (worker/src/middleware/pet-access.ts):
    pet: Pet;
    petId: string;
    petRole: Role;
  };
};
