import {
  activityDetailsSchemas,
  type Category,
} from "@pawlog/shared";
import type { Messages } from "../../i18n/messages";

export type OptionGroup = keyof Messages["options"];
export type FieldName = keyof Messages["fields"];

export type FieldSpec = {
  /** key inside the category's details payload */
  key: string;
  label: FieldName;
  control: "select" | "number" | "text" | "date";
  /** for selects: allowed values + the option-label group in the catalog */
  options?: readonly string[];
  optionGroup?: OptionGroup;
  required?: boolean;
  /** for selects with required values: pre-selected value */
  defaultValue?: string;
  maxLength?: number;
};

/**
 * Field specs per category. Order matters: the first 2–3 fields are the
 * above-the-fold essentials (spec §3). Keys/values mirror
 * `activityDetailsSchemas` in shared/ exactly — buildDetails() proves it.
 */
export const CATEGORY_FIELDS: Record<Category, FieldSpec[]> = {
  food: [
    { key: "foodType", label: "foodType", control: "select", options: ["dry", "wet", "treat", "supplement"], optionGroup: "foodType", required: true, defaultValue: "dry" },
    { key: "amount", label: "amount", control: "number" },
    { key: "unit", label: "unit", control: "select", options: ["g", "ml", "pieces"], optionGroup: "unit", required: true, defaultValue: "g" },
    { key: "name", label: "name", control: "text", maxLength: 100 },
    { key: "leftoverPct", label: "leftoverPct", control: "number" },
  ],
  water: [{ key: "amountMl", label: "amountMl", control: "number", required: true }],
  toilet: [
    { key: "kind", label: "kind", control: "select", options: ["pee", "poop"], optionGroup: "toiletKind", required: true, defaultValue: "pee" },
    { key: "condition", label: "condition", control: "select", options: ["normal", "soft", "diarrhea", "hard", "bloody"], optionGroup: "condition", required: true, defaultValue: "normal" },
    { key: "colorNote", label: "colorNote", control: "text", maxLength: 200 },
  ],
  weight: [{ key: "kg", label: "kg", control: "number", required: true }],
  exercise: [
    { key: "kind", label: "kind", control: "select", options: ["walk", "play", "other"], optionGroup: "exerciseKind", required: true, defaultValue: "walk" },
    { key: "durationMin", label: "durationMin", control: "number" },
    { key: "distanceKm", label: "distanceKm", control: "number" },
  ],
  symptom: [
    { key: "name", label: "name", control: "text", required: true, maxLength: 100 },
    { key: "severity", label: "severity", control: "select", options: ["mild", "moderate", "severe"], optionGroup: "severity", required: true, defaultValue: "mild" },
  ],
  medication: [
    { key: "name", label: "name", control: "text", required: true, maxLength: 100 },
    { key: "dose", label: "dose", control: "number" },
    { key: "doseUnit", label: "doseUnit", control: "text", maxLength: 20 },
  ],
  vet_visit: [
    { key: "clinic", label: "clinic", control: "text", maxLength: 200 },
    { key: "reason", label: "reason", control: "text", maxLength: 500 },
    { key: "diagnosis", label: "diagnosis", control: "text", maxLength: 500 },
    { key: "nextVisitDate", label: "nextVisitDate", control: "date" },
  ],
  grooming: [
    { key: "kind", label: "kind", control: "select", options: ["bath", "brush", "nails", "trim", "other"], optionGroup: "groomingKind", required: true, defaultValue: "bath" },
  ],
  vaccination: [
    { key: "vaccineName", label: "vaccineName", control: "text", required: true, maxLength: 100 },
    { key: "nextDueDate", label: "nextDueDate", control: "date" },
  ],
  note: [],
};

export type FormValues = Record<string, string>;

/**
 * Builds the details payload from form strings, then validates it with the
 * SAME shared Zod schema the server uses. Returns either `{ details }` or a
 * localized `{ error }`.
 */
export function buildDetails(
  category: Category,
  values: FormValues,
  t: Messages,
): { details: unknown } | { error: string } {
  for (const spec of CATEGORY_FIELDS[category]) {
    if (spec.required && (values[spec.key] ?? "").trim() === "") {
      return { error: t.add.requiredField(t.fields[spec.label]) };
    }
  }
  const raw: Record<string, unknown> = {};
  for (const spec of CATEGORY_FIELDS[category]) {
    const v = (values[spec.key] ?? "").trim();
    if (v === "") continue;
    raw[spec.key] = spec.control === "number" ? Number(v) : v;
  }
  const parsed = activityDetailsSchemas[category].safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const key = issue?.path[0];
    const spec = CATEGORY_FIELDS[category].find((s) => s.key === key);
    return {
      error: spec
        ? `${t.fields[spec.label]}: ${issue?.message ?? ""}`
        : (issue?.message ?? t.add.detailsInvalid),
    };
  }
  return { details: parsed.data };
}

/** Initial form strings for create (defaults), edit, or preset prefill. */
export function initialValues(
  category: Category,
  details?: unknown,
): FormValues {
  const parsed =
    details === undefined
      ? null
      : activityDetailsSchemas[category].safeParse(details);
  const src: Record<string, unknown> =
    parsed?.success ? (parsed.data as Record<string, unknown>) : {};
  const out: FormValues = {};
  for (const spec of CATEGORY_FIELDS[category]) {
    const v = src[spec.key];
    out[spec.key] =
      v === undefined || v === null ? (spec.defaultValue ?? "") : String(v);
  }
  return out;
}
