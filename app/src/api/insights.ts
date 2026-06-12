import type { AnomaliesResponse, InsightsPeriod, InsightsResponse } from "@pawary/shared";
import { useQuery } from "@tanstack/react-query";
import { deviceTzOffsetMin } from "../lib/dates";
import { api } from "./client";
import { keys } from "./keys";

export function useInsights(petId: string, period: InsightsPeriod) {
  return useQuery({
    queryKey: keys.insights(petId, period),
    queryFn: () =>
      api<InsightsResponse>(
        `/api/pets/${petId}/insights?period=${period}&tz=${deviceTzOffsetMin()}`,
      ),
    staleTime: 5 * 60_000,
  });
}

/** Lightweight Home-banner query (4 rules only — no chart datasets). */
export function useAnomalies(petId: string) {
  return useQuery({
    queryKey: keys.anomalies(petId),
    queryFn: () =>
      api<AnomaliesResponse>(`/api/pets/${petId}/anomalies?tz=${deviceTzOffsetMin()}`),
    staleTime: 60_000,
  });
}
