import type { ActivityPhotoMeta } from "@pawlog/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { keys } from "./keys";

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTOS_PER_ACTIVITY = 6;

export function photoUrl(photoId: string, size: "thumb" | "full"): string {
  return `/api/photos/${photoId}?size=${size}`;
}

/** Plain async fn (not a hook) so the add-flow can upload sequentially. */
export function uploadActivityPhoto(
  petId: string,
  activityId: string,
  file: File,
): Promise<ActivityPhotoMeta> {
  const form = new FormData();
  form.append("file", file);
  return api<ActivityPhotoMeta>(
    `/api/pets/${petId}/activities/${activityId}/photos`,
    { method: "POST", body: form },
  );
}

export function useDeletePhoto(petId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photoId: string) =>
      api<{ ok: boolean }>(`/api/photos/${photoId}`, { method: "DELETE" }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: keys.activitiesRoot(petId) }),
  });
}
