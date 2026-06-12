import type { ActivityResponse, Category } from "@pawary/shared";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateActivity,
  useUpdateActivity,
} from "../../api/activities";
import { ApiError } from "../../api/client";
import { keys } from "../../api/keys";
import {
  MAX_PHOTO_BYTES,
  MAX_PHOTOS_PER_ACTIVITY,
  photoUrl,
  uploadActivityPhoto,
  useDeletePhoto,
} from "../../api/photos";
import { Button } from "../../components/Button";
import { DateTimeInput, Field, Textarea } from "../../components/form";
import { IconButton } from "../../components/IconButton";
import { CameraIcon, XIcon } from "../../components/icons";
import { Spinner } from "../../components/Spinner";
import { useToast } from "../../components/Toast";
import { useT } from "../../i18n";
import { deviceTzOffsetMin } from "../../lib/dates";
import { buildDetails, initialValues, type FormValues } from "./categoryFields";
import { DetailsFields } from "./DetailsFields";

export function ActivityForm({
  petId,
  category,
  existing,
  presetDetails,
  onSaved,
}: {
  petId: string;
  category: Category;
  /** edit mode: pre-fills everything and switches to PATCH */
  existing?: ActivityResponse;
  /** quick-add prefill for create mode */
  presetDetails?: unknown;
  onSaved: (activity: ActivityResponse) => void;
}) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const create = useCreateActivity(petId);
  // Survives a photo-upload failure: a re-submit must NOT create a second
  // activity. Holds the created id until the whole submit completes.
  const createdIdRef = useRef<string | null>(null);
  const update = useUpdateActivity(
    petId,
    existing?.id ?? createdIdRef.current ?? "",
    existing,
  );
  const deletePhoto = useDeletePhoto(petId);

  const [occurredAtMs, setOccurredAtMs] = useState(
    existing?.occurredAt ?? Date.now(),
  );
  const [values, setValues] = useState<FormValues>(() =>
    initialValues(category, existing?.details ?? presetDetails),
  );
  const [memo, setMemo] = useState(existing?.memo ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const previews = useMemo(
    () => files.map((f) => URL.createObjectURL(f)),
    [files],
  );
  useEffect(
    () => () => previews.forEach(URL.revokeObjectURL),
    [previews],
  );

  const existingPhotos = (existing?.photos ?? []).filter(
    (p) => !deletedIds.has(p.id),
  );
  const photoCount = existingPhotos.length + files.length;
  const busy = create.isPending || update.isPending || progress !== null;

  const addFiles = (picked: FileList | null) => {
    if (!picked) return;
    const next = [...files];
    for (const file of Array.from(picked)) {
      if (existingPhotos.length + next.length >= MAX_PHOTOS_PER_ACTIVITY) {
        toast.show(t.add.photoLimit, { tone: "danger" });
        break;
      }
      if (file.size > MAX_PHOTO_BYTES) {
        toast.show(t.add.photoTooLarge(file.name), { tone: "danger" });
        continue;
      }
      next.push(file);
    }
    setFiles(next);
    if (fileRef.current) fileRef.current.value = "";
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const built = buildDetails(category, values, t);
    if ("error" in built) {
      setDetailsError(built.error);
      return;
    }
    setDetailsError(null);
    try {
      const trimmedMemo = memo.trim();
      let saved: ActivityResponse;
      if (existing || createdIdRef.current) {
        // edit mode — or resuming after create succeeded but a photo failed
        saved = await update.mutateAsync({
          occurredAt: occurredAtMs,
          tzOffsetMin: deviceTzOffsetMin(),
          memo: trimmedMemo === "" ? null : trimmedMemo,
          details: built.details,
        });
      } else {
        saved = await create.mutateAsync({
          category,
          occurredAt: occurredAtMs,
          tzOffsetMin: deviceTzOffsetMin(),
          ...(trimmedMemo !== "" ? { memo: trimmedMemo } : {}),
          details: built.details,
        });
        createdIdRef.current = saved.id;
      }
      if (files.length > 0) {
        const pending = [...files];
        setProgress({ done: 0, total: pending.length });
        for (let i = 0; i < pending.length; i++) {
          const file = pending[i]!;
          await uploadActivityPhoto(petId, saved.id, file);
          // uploaded — remove from state so a retry never re-sends it
          setFiles((prev) => prev.filter((f) => f !== file));
          setProgress({ done: i + 1, total: pending.length });
        }
        await qc.invalidateQueries({ queryKey: keys.activitiesRoot(petId) });
      }
      createdIdRef.current = null; // fully saved
      onSaved(saved);
    } catch (error) {
      toast.show(
        error instanceof ApiError ? error.message : t.errors.title,
        { tone: "danger" },
      );
    } finally {
      setProgress(null);
    }
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
      <Field label={t.add.time}>
        <DateTimeInput valueMs={occurredAtMs} onChangeMs={setOccurredAtMs} />
      </Field>

      <DetailsFields category={category} values={values} onChange={setValues} />
      {detailsError && (
        <p role="alert" className="text-sm font-semibold text-berry-600">
          {detailsError}
        </p>
      )}

      <Field label={`${t.add.memo} (${t.common.optional})`}>
        <Textarea
          value={memo}
          maxLength={2000}
          onChange={(e) => setMemo(e.target.value)}
        />
      </Field>

      <div>
        <span className="mb-1.5 block text-sm font-semibold text-ink-soft">
          {t.add.photos}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {existingPhotos.map((photo) => (
            <span key={photo.id} className="relative">
              <img
                src={photoUrl(photo.id, "thumb")}
                alt=""
                className="h-16 w-16 rounded-2xl object-cover"
              />
              <IconButton
                label={t.common.delete}
                className="absolute -right-2 -top-2 h-7 w-7 bg-paper shadow-card"
                disabled={deletePhoto.isPending}
                onClick={() =>
                  deletePhoto.mutate(photo.id, {
                    onSuccess: () =>
                      setDeletedIds((prev) => new Set(prev).add(photo.id)),
                  })
                }
              >
                <XIcon className="h-3.5 w-3.5" />
              </IconButton>
            </span>
          ))}
          {files.map((file, i) => (
            <span key={`${file.name}-${i}`} className="relative">
              <img
                src={previews[i]}
                alt=""
                className="h-16 w-16 rounded-2xl object-cover"
              />
              <IconButton
                label={t.common.delete}
                className="absolute -right-2 -top-2 h-7 w-7 bg-paper shadow-card"
                onClick={() => setFiles(files.filter((_, j) => j !== i))}
              >
                <XIcon className="h-3.5 w-3.5" />
              </IconButton>
            </span>
          ))}
          {photoCount < MAX_PHOTOS_PER_ACTIVITY && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => addFiles(e.target.files)}
              />
              <button
                type="button"
                aria-label={t.add.addPhotos}
                onClick={() => fileRef.current?.click()}
                className="flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-dashed border-cream-300 text-ink-faint transition hover:border-clay-300 hover:text-clay-500"
              >
                <CameraIcon className="h-6 w-6" />
              </button>
            </>
          )}
        </div>
      </div>

      <Button type="submit" disabled={busy} className="mt-1">
        {progress ? (
          <>
            <Spinner className="h-4 w-4 text-white" />
            {t.add.uploadingPhoto(progress.done + 1, progress.total)}
          </>
        ) : busy ? (
          <Spinner className="h-4 w-4 text-white" />
        ) : (
          t.common.save
        )}
      </Button>
    </form>
  );
}
