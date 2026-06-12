import type {
  CreatePetInput,
  PetResponse,
  PetTargetsInput,
  UpdatePetInput,
} from "@pawary/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { keys } from "./keys";

export function usePet(petId: string, enabled = true) {
  return useQuery({
    queryKey: keys.pet(petId),
    queryFn: () => api<PetResponse>(`/api/pets/${petId}`),
    enabled,
  });
}

export function useCreatePet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePetInput) =>
      api<PetResponse>("/api/pets", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.me }),
  });
}

export function useUpdatePet(petId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdatePetInput) =>
      api<PetResponse>(`/api/pets/${petId}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.me }),
        qc.invalidateQueries({ queryKey: keys.pet(petId) }),
      ]);
    },
  });
}

export function useSetPetTargets(petId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PetTargetsInput) =>
      api<PetTargetsInput>(`/api/pets/${petId}/targets`, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.pet(petId) }),
  });
}

export function useUploadPetAvatar(petId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api<{ avatarR2Key: string }>(`/api/pets/${petId}/avatar`, {
        method: "POST",
        body: form,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.me }),
        qc.invalidateQueries({ queryKey: keys.pet(petId) }),
      ]);
    },
  });
}
