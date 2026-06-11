import type {
  PresetInput,
  PresetResponse,
  UpdatePresetInput,
} from "@pawlog/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { keys } from "./keys";

export function usePresets(petId: string) {
  return useQuery({
    queryKey: keys.presets(petId),
    queryFn: () => api<PresetResponse[]>(`/api/pets/${petId}/presets`),
  });
}

export function useCreatePreset(petId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PresetInput) =>
      api<PresetResponse>(`/api/pets/${petId}/presets`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.presets(petId) }),
  });
}

export function useUpdatePreset(petId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdatePresetInput }) =>
      api<PresetResponse>(`/api/pets/${petId}/presets/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.presets(petId) }),
  });
}

export function useDeletePreset(petId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ ok: boolean }>(`/api/pets/${petId}/presets/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.presets(petId) }),
  });
}
