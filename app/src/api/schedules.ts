import type {
  CareStatusResponse,
  CompleteScheduleInput,
  CompleteScheduleResponse,
  CreateScheduleInput,
  ScheduleResponse,
  UpdateScheduleInput,
} from "@pawlog/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deviceTzOffsetMin } from "../lib/dates";
import { api } from "./client";
import { keys } from "./keys";

export function useSchedules(petId: string) {
  return useQuery({
    queryKey: keys.schedules(petId),
    queryFn: () => api<ScheduleResponse[]>(`/api/pets/${petId}/schedules`),
  });
}

export function useCareStatus(petId: string) {
  return useQuery({
    queryKey: keys.careStatus(petId),
    queryFn: () =>
      api<CareStatusResponse>(`/api/pets/${petId}/care-status?tz=${deviceTzOffsetMin()}`),
    staleTime: 60_000,
  });
}

async function invalidateCare(
  qc: ReturnType<typeof useQueryClient>,
  petId: string,
): Promise<void> {
  await Promise.all([
    qc.invalidateQueries({ queryKey: keys.schedules(petId) }),
    qc.invalidateQueries({ queryKey: keys.careStatus(petId) }),
  ]);
}

export function useCreateSchedule(petId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateScheduleInput) =>
      api<ScheduleResponse>(`/api/pets/${petId}/schedules`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => invalidateCare(qc, petId),
  });
}

export function useUpdateSchedule(petId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateScheduleInput }) =>
      api<ScheduleResponse>(`/api/pets/${petId}/schedules/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: () => invalidateCare(qc, petId),
  });
}

export function useDeleteSchedule(petId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ ok: boolean }>(`/api/pets/${petId}/schedules/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidateCare(qc, petId),
  });
}

/** Completing also creates an activity, so lists, summaries, and the analyzer all refresh. */
export function useCompleteSchedule(petId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input?: CompleteScheduleInput }) =>
      api<CompleteScheduleResponse>(`/api/pets/${petId}/schedules/${id}/complete`, {
        method: "POST",
        body: JSON.stringify(input ?? {}),
      }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.schedules(petId) }),
        qc.invalidateQueries({ queryKey: keys.careStatus(petId) }),
        qc.invalidateQueries({ queryKey: keys.activitiesRoot(petId) }),
        qc.invalidateQueries({ queryKey: keys.summaryRoot(petId) }),
        qc.invalidateQueries({ queryKey: keys.insightsRoot(petId) }),
        qc.invalidateQueries({ queryKey: keys.anomalies(petId) }),
      ]);
    },
  });
}
