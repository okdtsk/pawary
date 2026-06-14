import type { Category } from "@pawary/shared";

const EN: Record<Category, string> = {
  food: "Food",
  water: "Water",
  toilet: "Toilet",
  weight: "Weight",
  exercise: "Exercise",
  symptom: "Symptom",
  medication: "Medication",
  vet_visit: "Vet visit",
  grooming: "Grooming",
  vaccination: "Vaccination",
  note: "Note",
};

const JA: Record<Category, string> = {
  food: "ごはん",
  water: "お水",
  toilet: "トイレ",
  weight: "体重",
  exercise: "運動",
  symptom: "症状",
  medication: "お薬",
  vet_visit: "通院",
  grooming: "お手入れ",
  vaccination: "ワクチン",
  note: "メモ",
};

/** Localized category name for push bodies. Non-"ja" locales fall back to EN. */
export function categoryLabel(category: Category, locale: string): string {
  return (locale === "ja" ? JA : EN)[category];
}
