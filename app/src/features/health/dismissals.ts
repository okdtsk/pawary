import type { Anomaly } from "@pawary/shared";

/**
 * Dismissals live client-side, scoped to pet + rule (+ symptom name for
 * symptom_streak) + household day — a new day re-evaluates, which is how
 * "reappear only on new triggering data" (spec §7) works in practice.
 */
const PREFIX = "pawary:anomaly:";

function storageKey(petId: string, anomaly: Anomaly, day: string): string {
  const sub = anomaly.rule === "symptom_streak" ? anomaly.params.name : "";
  return `${PREFIX}${petId}:${anomaly.rule}:${sub}:${day}`;
}

/** Drop every dismissal not scoped to `today` — keys are day-suffixed. */
function pruneOldDismissals(today: string): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX) && !key.endsWith(`:${today}`)) stale.push(key);
    }
    for (const key of stale) localStorage.removeItem(key);
  } catch {
    // storage unavailable — nothing to prune
  }
}

export function isDismissed(petId: string, anomaly: Anomaly, day: string): boolean {
  try {
    return localStorage.getItem(storageKey(petId, anomaly, day)) !== null;
  } catch {
    return false; // storage unavailable → banner simply shows
  }
}

export function dismissAnomaly(petId: string, anomaly: Anomaly, day: string): void {
  pruneOldDismissals(day);
  try {
    localStorage.setItem(storageKey(petId, anomaly, day), "1");
  } catch {
    // private mode etc. — the banner reappears next render, acceptable
  }
}
