import type {
  AcceptInviteResponse,
  CreateInviteInput,
  CreateInviteResponse,
  InvitePreviewResponse,
  MembersResponse,
  Role,
} from "@pawary/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { keys } from "./keys";

export function useMembers(petId: string) {
  return useQuery({
    queryKey: keys.members(petId),
    queryFn: () => api<MembersResponse>(`/api/pets/${petId}/members`),
  });
}

export function useCreateInvite(petId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInviteInput) =>
      api<CreateInviteResponse>(`/api/pets/${petId}/invites`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.members(petId) }),
  });
}

export function useRevokeInvite(petId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) =>
      api<{ ok: true }>(`/api/pets/${petId}/invites/${inviteId}`, {
        method: "DELETE",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.members(petId) }),
  });
}

export function useUpdateMemberRole(petId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) =>
      api<{ ok: true }>(`/api/pets/${petId}/members/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      }),
    onSuccess: async () => {
      // own role may have changed (self-demotion) — refresh me too
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.members(petId) }),
        qc.invalidateQueries({ queryKey: keys.me }),
      ]);
    },
  });
}

export function useRemoveMember(petId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      api<{ ok: true }>(`/api/pets/${petId}/members/${userId}`, {
        method: "DELETE",
      }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.members(petId) }),
        qc.invalidateQueries({ queryKey: keys.me }),
      ]);
    },
  });
}

export function useInvitePreview(token: string) {
  return useQuery({
    queryKey: keys.invitePreview(token),
    queryFn: () => api<InvitePreviewResponse>(`/api/invites/${token}`),
    retry: false, // a 404 is a final answer, not a flake
  });
}

export function useAcceptInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      api<AcceptInviteResponse>(`/api/invites/${token}/accept`, {
        method: "POST",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.me }),
  });
}
