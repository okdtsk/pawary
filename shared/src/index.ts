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

// ---------------------------------------------------------------------------
// Plan 4: care schedules, care status, insights, anomalies
// ---------------------------------------------------------------------------

export const SCHEDULE_TYPES = [
  "medication",
  "vaccination",
  "vet_visit",
  "deworming",
  "grooming",
  "custom",
] as const;
export type ScheduleType = (typeof SCHEDULE_TYPES)[number];

export const RECURRENCE_UNITS = ["once", "hour", "day", "week", "month"] as const;
export type RecurrenceUnit = (typeof RECURRENCE_UNITS)[number];

function refineScheduleTemplate(
  categoryLink: Category,
  detailsTemplate: unknown,
  ctx: z.RefinementCtx,
): void {
  const parsed = activityDetailsSchemas[categoryLink].safeParse(detailsTemplate ?? {});
  if (!parsed.success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["detailsTemplate"],
      message: parsed.error.issues[0]?.message ?? "Invalid details template",
    });
  }
}

export const createScheduleSchema = z
  .object({
    type: z.enum(SCHEDULE_TYPES),
    name: z.string().trim().min(1).max(100),
    categoryLink: z.enum(CATEGORIES),
    detailsTemplate: z.unknown().optional(), // omitted ⇒ {}
    recurrenceUnit: z.enum(RECURRENCE_UNITS),
    recurrenceN: z.number().int().positive().max(1000).optional(),
    nextDueAt: z.number().int().positive(),
    endAt: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    refineScheduleTemplate(val.categoryLink, val.detailsTemplate, ctx);
    if (val.recurrenceUnit !== "once" && val.recurrenceN === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recurrenceN"],
        message: "recurrenceN is required unless recurrence is once",
      });
    }
    if (val.endAt !== undefined && val.endAt <= val.nextDueAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endAt"],
        message: "endAt must be after nextDueAt",
      });
    }
  });
export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;

// `type` and `categoryLink` are immutable after creation (the template is
// typed by categoryLink, like activity details). `detailsTemplate`, when
// present, is re-validated in the handler against the STORED categoryLink;
// the recurrenceN/endAt cross-field rules are re-checked on the merged record.
export const updateScheduleSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    detailsTemplate: z.unknown().optional(),
    recurrenceUnit: z.enum(RECURRENCE_UNITS).optional(),
    recurrenceN: z.number().int().positive().max(1000).nullable().optional(),
    nextDueAt: z.number().int().positive().optional(),
    endAt: z.number().int().positive().nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict();
export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;

// POST .../schedules/:id/complete body. `occurredAt` must additionally be
// within [now − 7 days, now + 1 hour] — sanity bounds checked in the handler.
export const completeScheduleSchema = z
  .object({
    occurredAt: z.number().int().positive().optional(), // default: now
    tzOffsetMin: z.number().int().min(-840).max(840).optional(), // default: 0
    memo: z.string().trim().max(2000).optional(),
  })
  .strict();
export type CompleteScheduleInput = z.infer<typeof completeScheduleSchema>;

export type ScheduleResponse = {
  id: string;
  petId: string;
  type: ScheduleType;
  name: string;
  categoryLink: Category;
  detailsTemplate: unknown;
  recurrenceUnit: RecurrenceUnit;
  recurrenceN: number | null;
  nextDueAt: number;
  endAt: number | null;
  active: boolean;
  createdAt: number;
};

/** Disjoint buckets; active schedules only (spec §7 "Care status"). */
export type CareStatusResponse = {
  overdue: ScheduleResponse[]; // nextDueAt < now
  today: ScheduleResponse[]; // now ≤ nextDueAt < next household midnight
  upcoming: ScheduleResponse[]; // the 7 household days after today
};

export type CompleteScheduleResponse = {
  activity: ActivityResponse;
  schedule: ScheduleResponse;
};

// --- Analyzer ---

export const INSIGHTS_PERIODS = ["4w", "3m", "1y"] as const;
export type InsightsPeriod = (typeof INSIGHTS_PERIODS)[number];

/**
 * Chart buckets are day keys "YYYY-MM-DD" for 4w/3m and ISO-week keys
 * "YYYY-Www" for 1y. Sparse by design: a bucket with no data is simply
 * absent (charts render gaps / hollow markers, never fake zeros — spec §7).
 */
export type WeightPoint = { bucket: string; kg: number; avg7: number };
export type WeightSeries = {
  /** sorted by bucket; latest weighing per bucket; avg7 = trailing mean of up to 7 points */
  points: WeightPoint[];
  min: number | null;
  max: number | null;
  /** last point vs first point, percent, 1 decimal; null with <2 points */
  pctChange: number | null;
};

/** Worst-last severity order; index = rank (matrix coloring + anomaly rule). */
export const TOILET_SEVERITY = ["normal", "soft", "hard", "diarrhea", "bloody"] as const;
export type ToiletSeverity = (typeof TOILET_SEVERITY)[number];

export type ToiletCell = { count: number; worst: ToiletSeverity };
export type ToiletMatrixRow = {
  bucket: string;
  pee: ToiletCell | null;
  poop: ToiletCell | null;
};

export type CareSpan = {
  name: string;
  /** household-naive epoch ms — same axis space as windowStart/windowEnd */
  firstAt: number;
  lastAt: number;
  count: number;
};
export type SymptomSpan = CareSpan & {
  maxSeverity: "mild" | "moderate" | "severe";
};
export type VetMarker = { at: number; clinic: string | null };

export type AnomalySeverity = "info" | "warning";
/**
 * Anomalies are STRUCTURED (rule id + params), never prose — the frontend
 * catalog renders localized advisory copy (spec §7 tone lives client-side).
 */
export type Anomaly =
  | { rule: "weight_drift"; severity: "warning"; params: { pctChange: number } }
  | { rule: "toilet_trouble"; severity: "warning"; params: { count: number } }
  | { rule: "quiet_day"; severity: "info"; params: Record<string, never> }
  | { rule: "symptom_streak"; severity: "warning"; params: { name: string; days: number } };
export type AnomalyRule = Anomaly["rule"];

export type InsightsResponse = {
  period: InsightsPeriod;
  bucket: "day" | "week";
  /** every bucket key in the window, oldest → the bucket containing today */
  buckets: string[];
  /** household-naive epoch ms window (the timeline x-axis space) */
  windowStart: number;
  windowEnd: number;
  weight: WeightSeries;
  intake: {
    /** bucket → grams (food entries with unit='g' only); absent = not logged */
    food: Record<string, number>;
    /** bucket → ml; absent = not logged */
    water: Record<string, number>;
    targets: PetTargets | null;
  };
  toilet: ToiletMatrixRow[];
  timeline: {
    medications: CareSpan[];
    symptoms: SymptomSpan[];
    vetVisits: VetMarker[];
  };
  anomalies: Anomaly[];
};

export type AnomaliesResponse = { anomalies: Anomaly[] };

// --- ISO week math (shared by worker bucketing and app axis labels) ---

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

function isoWeek1Monday(isoYear: number): number {
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  return jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * DAY_MS;
}

/** ISO-8601 week key ("2026-W24") of a "YYYY-MM-DD" day key. */
export function isoWeekKey(dayKey: string): string {
  const date = new Date(
    Date.UTC(
      Number(dayKey.slice(0, 4)),
      Number(dayKey.slice(5, 7)) - 1,
      Number(dayKey.slice(8, 10)),
    ),
  );
  const mondayIndex = (date.getUTCDay() + 6) % 7; // 0 = Monday
  // The Thursday of the week decides the ISO year (ISO-8601).
  const thursday = date.getTime() + (3 - mondayIndex) * DAY_MS;
  const isoYear = new Date(thursday).getUTCFullYear();
  const week = Math.floor((thursday - isoWeek1Monday(isoYear)) / WEEK_MS) + 1;
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** Monday of an ISO week key, as a "YYYY-MM-DD" day key. */
export function isoWeekStartDay(weekKey: string): string {
  const isoYear = Number(weekKey.slice(0, 4));
  const week = Number(weekKey.slice(6, 8));
  const monday = new Date(isoWeek1Monday(isoYear) + (week - 1) * WEEK_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`;
}
