import type {
  ActivityListResponse,
  ActivityResponse,
  Category,
  CreateActivityInput,
  DaySummaryResponse,
  UpdateActivityInput,
} from "@pawlog/shared";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { dayKeyOf, monthKeyOf } from "../lib/dates";
import { api } from "./client";
import { keys } from "./keys";

function listPath(
  petId: string,
  params: {
    from?: number;
    to?: number;
    categories?: Category[];
    q?: string;
    cursor?: string;
    limit?: number;
  },
): string {
  const search = new URLSearchParams();
  if (params.from !== undefined) search.set("from", String(params.from));
  if (params.to !== undefined) search.set("to", String(params.to));
  for (const cat of params.categories ?? []) search.append("category", cat);
  if (params.q) search.set("q", params.q);
  if (params.cursor) search.set("cursor", params.cursor);
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  const qs = search.toString();
  return `/api/pets/${petId}/activities${qs ? `?${qs}` : ""}`;
}

/** All activities in [from, to] (inclusive) — calendar ranges, "today so far". */
export function useActivitiesRange(petId: string, from: number, to: number) {
  return useQuery({
    queryKey: keys.activitiesRange(petId, from, to),
    queryFn: async () => {
      const res = await api<ActivityListResponse>(
        listPath(petId, { from, to, limit: 200 }),
      );
      return res.items;
    },
  });
}

/** Infinite reverse-chronological log with filters. */
export function useLogActivities(
  petId: string,
  filters: { categories: Category[]; q: string },
) {
  return useInfiniteQuery({
    queryKey: keys.activitiesLog(petId, filters.categories, filters.q),
    queryFn: ({ pageParam }) =>
      api<ActivityListResponse>(
        listPath(petId, {
          categories: filters.categories,
          q: filters.q || undefined,
          cursor: pageParam,
          limit: 50,
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useActivity(petId: string, id: string) {
  return useQuery({
    queryKey: keys.activity(petId, id),
    queryFn: () => api<ActivityResponse>(`/api/pets/${petId}/activities/${id}`),
  });
}

export function useDaySummary(petId: string, month: string) {
  return useQuery({
    queryKey: keys.summary(petId, month),
    queryFn: () =>
      api<DaySummaryResponse>(`/api/pets/${petId}/summary?month=${month}`),
  });
}

async function invalidateActivityData(
  qc: ReturnType<typeof useQueryClient>,
  petId: string,
  occurredAt: number,
  tzOffsetMin: number,
): Promise<void> {
  const month = monthKeyOf(dayKeyOf(occurredAt, tzOffsetMin));
  await Promise.all([
    qc.invalidateQueries({ queryKey: keys.activitiesRoot(petId) }),
    qc.invalidateQueries({ queryKey: keys.summary(petId, month) }),
    qc.invalidateQueries({ queryKey: keys.insightsRoot(petId) }),
    qc.invalidateQueries({ queryKey: keys.anomalies(petId) }),
  ]);
}

export function useCreateActivity(petId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateActivityInput) =>
      api<ActivityResponse>(`/api/pets/${petId}/activities`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (created) =>
      invalidateActivityData(qc, petId, created.occurredAt, created.tzOffsetMin),
  });
}

export function useUpdateActivity(petId: string, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateActivityInput) =>
      api<ActivityResponse>(`/api/pets/${petId}/activities/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: (updated) =>
      invalidateActivityData(qc, petId, updated.occurredAt, updated.tzOffsetMin),
  });
}

export function useDeleteActivity(petId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ ok: boolean }>(`/api/pets/${petId}/activities/${id}`, {
        method: "DELETE",
      }),
    onSuccess: async () => {
      // occurredAt is unknown here; invalidate all months for this pet
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.activitiesRoot(petId) }),
        qc.invalidateQueries({ queryKey: keys.summaryRoot(petId) }),
        qc.invalidateQueries({ queryKey: keys.insightsRoot(petId) }),
        qc.invalidateQueries({ queryKey: keys.anomalies(petId) }),
      ]);
    },
  });
}
