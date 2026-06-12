import type { MeResponse, UpdateMeInput, UpdateMeResponse } from "@pawary/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, setCsrfToken } from "./client";
import { keys } from "./keys";

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      const me = await api<MeResponse>("/api/me");
      setCsrfToken(me.csrfToken);
      return me;
    },
    retry: (count, error) =>
      !(error instanceof ApiError && error.status === 401) && count < 2,
    staleTime: 5 * 60 * 1000,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return async () => {
    await api("/api/auth/logout", { method: "POST" });
    await qc.invalidateQueries({ queryKey: keys.me });
  };
}

export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateMeInput) =>
      api<UpdateMeResponse>("/api/me", {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: (res) => {
      qc.setQueryData<MeResponse>(keys.me, (old) =>
        old ? { ...old, user: res.user } : old,
      );
    },
  });
}

export function useDeleteAccount() {
  return useMutation({
    mutationFn: (confirmEmail: string) =>
      api<{ ok: boolean }>("/api/me", {
        method: "DELETE",
        body: JSON.stringify({ confirmEmail }),
      }),
  });
}
