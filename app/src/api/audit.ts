import type { AuditPageResponse } from "@pawary/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "./client";
import { keys } from "./keys";

export function useAuditLog(petId: string) {
  return useInfiniteQuery({
    queryKey: keys.audit(petId),
    queryFn: ({ pageParam }) => {
      const qs = pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : "";
      return api<AuditPageResponse>(`/api/pets/${petId}/audit${qs}`);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.cursor ?? undefined,
  });
}
