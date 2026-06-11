import { z } from "zod";

export const LOCALES = ["system", "en", "ja"] as const;
export type Locale = (typeof LOCALES)[number];

export const CATEGORIES = [
  "food",
  "water",
  "toilet",
  "weight",
  "exercise",
  "symptom",
  "medication",
  "vet_visit",
  "grooming",
  "vaccination",
  "note",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const ROLES = ["owner", "editor", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export type ApiOk<T> = { data: T };
export type ApiErr = { error: { code: string; message: string } };

export const updateMeSchema = z
  .object({
    displayName: z.string().trim().min(1).max(100).optional(),
    locale: z.enum(LOCALES).optional(),
  })
  .strict();
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

export type MeResponse = {
  user: {
    id: string;
    email: string;
    displayName: string;
    avatarUrl: string | null;
    locale: Locale;
  };
  pets: Array<{
    id: string;
    name: string;
    species: "dog" | "cat" | "other";
    avatarR2Key: string | null;
    role: Role;
  }>;
  csrfToken: string;
};
