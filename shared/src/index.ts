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

// ---------------------------------------------------------------------------
// Plan 2: pets, activities, presets, account deletion
// ---------------------------------------------------------------------------

export const SPECIES = ["dog", "cat", "other"] as const;
export type Species = (typeof SPECIES)[number];

export const SEXES = ["male", "female", "unknown"] as const;
export type Sex = (typeof SEXES)[number];

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Per-category `details` payload schemas (spec §4). All strict. */
export const activityDetailsSchemas = {
  food: z
    .object({
      name: z.string().trim().min(1).max(100).optional(),
      foodType: z.enum(["dry", "wet", "treat", "supplement"]),
      amount: z.number().positive().max(100000).optional(),
      unit: z.enum(["g", "ml", "pieces"]),
      leftoverPct: z.number().min(0).max(100).optional(),
    })
    .strict(),
  water: z.object({ amountMl: z.number().positive().max(100000) }).strict(),
  toilet: z
    .object({
      kind: z.enum(["pee", "poop"]),
      condition: z.enum(["normal", "soft", "diarrhea", "hard", "bloody"]),
      colorNote: z.string().trim().max(200).optional(),
    })
    .strict(),
  weight: z.object({ kg: z.number().positive().max(500) }).strict(),
  exercise: z
    .object({
      kind: z.enum(["walk", "play", "other"]),
      durationMin: z.number().int().positive().max(1440).optional(),
      distanceKm: z.number().positive().max(1000).optional(),
    })
    .strict(),
  symptom: z
    .object({
      name: z.string().trim().min(1).max(100),
      severity: z.enum(["mild", "moderate", "severe"]),
    })
    .strict(),
  medication: z
    .object({
      name: z.string().trim().min(1).max(100),
      dose: z.number().positive().max(100000).optional(),
      doseUnit: z.string().trim().min(1).max(20).optional(),
      scheduleId: z.string().min(1).max(40).optional(),
    })
    .strict(),
  vet_visit: z
    .object({
      clinic: z.string().trim().max(200).optional(),
      reason: z.string().trim().max(500).optional(),
      diagnosis: z.string().trim().max(500).optional(),
      nextVisitDate: z.string().regex(ISO_DATE_RE).optional(),
    })
    .strict(),
  grooming: z
    .object({ kind: z.enum(["bath", "brush", "nails", "trim", "other"]) })
    .strict(),
  vaccination: z
    .object({
      vaccineName: z.string().trim().min(1).max(100),
      nextDueDate: z.string().regex(ISO_DATE_RE).optional(),
    })
    .strict(),
  note: z.object({}).strict(),
} as const satisfies Record<Category, z.ZodTypeAny>;

function refineDetails(
  category: Category,
  details: unknown,
  ctx: z.RefinementCtx,
): void {
  const parsed = activityDetailsSchemas[category].safeParse(details ?? {});
  if (!parsed.success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["details"],
      message: parsed.error.issues[0]?.message ?? "Invalid details",
    });
  }
}

export const createActivitySchema = z
  .object({
    category: z.enum(CATEGORIES),
    occurredAt: z.number().int().positive(),
    tzOffsetMin: z.number().int().min(-840).max(840),
    memo: z.string().trim().max(2000).optional(),
    details: z.unknown().optional(), // omitted ⇒ {} (only valid for `note`)
  })
  .strict()
  .superRefine((val, ctx) => refineDetails(val.category, val.details, ctx));
export type CreateActivityInput = z.infer<typeof createActivitySchema>;

// `category` is immutable after creation (changing it would orphan the typed
// details payload). `details`, when present, is re-validated in the handler
// against the activity's EXISTING category — it cannot be checked here.
export const updateActivitySchema = z
  .object({
    occurredAt: z.number().int().positive().optional(),
    tzOffsetMin: z.number().int().min(-840).max(840).optional(),
    memo: z.string().trim().max(2000).nullable().optional(),
    details: z.unknown().optional(),
  })
  .strict();
export type UpdateActivityInput = z.infer<typeof updateActivitySchema>;

export const createPetSchema = z
  .object({
    name: z.string().trim().min(1).max(50),
    species: z.enum(SPECIES),
    breed: z.string().trim().min(1).max(100).optional(),
    sex: z.enum(SEXES).optional(),
    birthday: z.string().regex(ISO_DATE_RE).optional(),
  })
  .strict();
export type CreatePetInput = z.infer<typeof createPetSchema>;

// `archived: true|false` maps to pets.archived_at (set now / clear).
// breed/sex/birthday accept null to clear.
export const updatePetSchema = z
  .object({
    name: z.string().trim().min(1).max(50).optional(),
    species: z.enum(SPECIES).optional(),
    breed: z.string().trim().min(1).max(100).nullable().optional(),
    sex: z.enum(SEXES).nullable().optional(),
    birthday: z.string().regex(ISO_DATE_RE).nullable().optional(),
    archived: z.boolean().optional(),
  })
  .strict();
export type UpdatePetInput = z.infer<typeof updatePetSchema>;

// PUT semantics: full replace; null clears a target.
export const petTargetsSchema = z
  .object({
    foodGPerDay: z.number().positive().max(100000).nullable(),
    waterMlPerDay: z.number().positive().max(100000).nullable(),
  })
  .strict();
export type PetTargetsInput = z.infer<typeof petTargetsSchema>;

export const presetSchema = z
  .object({
    category: z.enum(CATEGORIES),
    label: z.string().trim().min(1).max(30),
    details: z.unknown().optional(),
    sortOrder: z.number().int().min(0).max(10000).optional(),
  })
  .strict()
  .superRefine((val, ctx) => refineDetails(val.category, val.details, ctx));
export type PresetInput = z.infer<typeof presetSchema>;

// `category` immutable, like activities; details re-validated in the handler.
export const updatePresetSchema = z
  .object({
    label: z.string().trim().min(1).max(30).optional(),
    details: z.unknown().optional(),
    sortOrder: z.number().int().min(0).max(10000).optional(),
  })
  .strict();
export type UpdatePresetInput = z.infer<typeof updatePresetSchema>;

export const deleteMeSchema = z
  .object({ confirmEmail: z.string().min(1).max(320) })
  .strict();
export type DeleteMeInput = z.infer<typeof deleteMeSchema>;

export type PetTargets = {
  foodGPerDay: number | null;
  waterMlPerDay: number | null;
};

export type PetResponse = {
  id: string;
  name: string;
  species: Species;
  breed: string | null;
  sex: Sex | null;
  birthday: string | null;
  avatarR2Key: string | null;
  archived: boolean;
  createdAt: number;
  role: Role;
  targets: PetTargets | null;
};

export type ActivityPhotoMeta = {
  id: string;
  width: number | null;
  height: number | null;
  contentType: string;
};

export type ActivityResponse = {
  id: string;
  petId: string;
  category: Category;
  occurredAt: number;
  tzOffsetMin: number;
  memo: string | null;
  details: unknown;
  createdBy: string;
  updatedBy: string | null;
  createdAt: number;
  updatedAt: number;
  photos: ActivityPhotoMeta[];
};

export type ActivityListResponse = {
  items: ActivityResponse[];
  nextCursor: string | null;
};

/** days: "YYYY-MM-DD" (household time) → category → count */
export type DaySummaryResponse = {
  month: string;
  days: Record<string, Partial<Record<Category, number>>>;
};

export type PresetResponse = {
  id: string;
  category: Category;
  label: string;
  details: unknown;
  sortOrder: number;
};

// ---------------------------------------------------------------------------
// Plan 3: frontend
// ---------------------------------------------------------------------------

/** Response shape of PATCH /api/me (already produced by the worker). */
export type UpdateMeResponse = {
  user: MeResponse["user"];
};
