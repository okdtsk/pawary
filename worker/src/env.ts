import type { Session, User } from "./db/schema";

export type Env = {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ENVIRONMENT: "development" | "production";
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
};

export type AppEnv = {
  Bindings: Env;
  Variables: {
    user: User;
    session: Session;
  };
};
