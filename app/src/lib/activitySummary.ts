import type { ActivityResponse } from "@pawary/shared";
import type { Messages } from "../i18n/messages";
import { parseDetails } from "./details";

/** "Dry · 60 g" / "250 ml" / "Pee · Normal" / "4.2 kg" … */
export function summarizeActivity(a: ActivityResponse, t: Messages): string {
  switch (a.category) {
    case "food": {
      const d = parseDetails("food", a.details);
      if (!d) return "";
      const parts = [t.options.foodType[d.foodType]];
      if (d.amount !== undefined)
        parts.push(`${d.amount} ${t.options.unit[d.unit]}`);
      if (d.name) parts.push(d.name);
      return parts.join(" · ");
    }
    case "water": {
      const d = parseDetails("water", a.details);
      return d ? `${d.amountMl} ml` : "";
    }
    case "toilet": {
      const d = parseDetails("toilet", a.details);
      return d
        ? `${t.options.toiletKind[d.kind]} · ${t.options.condition[d.condition]}`
        : "";
    }
    case "weight": {
      const d = parseDetails("weight", a.details);
      return d ? `${d.kg} kg` : "";
    }
    case "exercise": {
      const d = parseDetails("exercise", a.details);
      if (!d) return "";
      const parts = [t.options.exerciseKind[d.kind]];
      if (d.durationMin !== undefined) parts.push(`${d.durationMin} min`);
      if (d.distanceKm !== undefined) parts.push(`${d.distanceKm} km`);
      return parts.join(" · ");
    }
    case "symptom": {
      const d = parseDetails("symptom", a.details);
      return d ? `${d.name} · ${t.options.severity[d.severity]}` : "";
    }
    case "medication": {
      const d = parseDetails("medication", a.details);
      if (!d) return "";
      const parts = [d.name];
      if (d.dose !== undefined) parts.push(`${d.dose}${d.doseUnit ?? ""}`);
      return parts.join(" · ");
    }
    case "vet_visit": {
      const d = parseDetails("vet_visit", a.details);
      return d?.clinic ?? d?.reason ?? "";
    }
    case "grooming": {
      const d = parseDetails("grooming", a.details);
      return d ? t.options.groomingKind[d.kind] : "";
    }
    case "vaccination": {
      const d = parseDetails("vaccination", a.details);
      return d?.vaccineName ?? "";
    }
    case "note":
      return "";
  }
}
