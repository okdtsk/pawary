import type { Role } from "@pawary/shared";
import type { Pet, Session, User } from "./db/schema";

export type Env = {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ENVIRONMENT: "development" | "production";
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  ADVISOR_KEK: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
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
