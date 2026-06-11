import type { Anomaly } from "@pawlog/shared";

/**
 * Dismissals live client-side, scoped to pet + rule (+ symptom name for
 * symptom_streak) + household day — a new day re-evaluates, which is how
 * "reappear only on new triggering data" (spec §7) works in practice.
 */
function storageKey(petId: string, anomaly: Anomaly, day: string): string {
  const sub = anomaly.rule === "symptom_streak" ? anomaly.params.name : "";
  return `pawlog:anomaly:${petId}:${anomaly.rule}:${sub}:${day}`;
}

export function isDismissed(petId: string, anomaly: Anomaly, day: string): boolean {
  try {
    return localStorage.getItem(storageKey(petId, anomaly, day)) !== null;
  } catch {
    return false; // storage unavailable → banner simply shows
  }
}

export function dismissAnomaly(petId: string, anomaly: Anomaly, day: string): void {
  try {
    localStorage.setItem(storageKey(petId, anomaly, day), "1");
  } catch {
    // private mode etc. — the banner reappears next render, acceptable
  }
}
