import type { ActivityResponse } from "@pawlog/shared";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router";
import { useActivity, useDeleteActivity } from "../api/activities";
import { photoUrl } from "../api/photos";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { CategoryIcon, categoryTone } from "../components/CategoryIcon";
import { EmptyState } from "../components/EmptyState";
import { IconButton } from "../components/IconButton";
import { ArrowLeftIcon, PencilIcon, TrashIcon, XIcon } from "../components/icons";
import { Sheet } from "../components/Sheet";
import { Spinner } from "../components/Spinner";
import { useToast } from "../components/Toast";
import { ActivityForm } from "../features/add/ActivityForm";
import { CATEGORY_FIELDS } from "../features/add/categoryFields";
import { useLocaleTag, useT } from "../i18n";
import type { Messages } from "../i18n/messages";
import { cn } from "../lib/cn";
import { friendlyError } from "../lib/errors";
import { formatDateTime } from "../lib/dates";
import { usePets } from "../state/pets";

function detailRows(
  activity: ActivityResponse,
  t: Messages,
): { label: string; value: string }[] {
  const details = (activity.details ?? {}) as Record<string, unknown>;
  const rows: { label: string; value: string }[] = [];
  for (const spec of CATEGORY_FIELDS[activity.category]) {
    const raw = details[spec.key];
    if (raw === undefined || raw === null || raw === "") continue;
    const value =
      spec.control === "select" && spec.optionGroup
        ? ((t.options[spec.optionGroup] as Record<string, string>)[
            String(raw)
          ] ?? String(raw))
        : String(raw);
    rows.push({ label: t.fields[spec.label], value });
  }
  return rows;
}

function Lightbox({
  photoId,
  onClose,
  closeLabel,
}: {
  photoId: string;
  onClose: () => void;
  closeLabel: string;
}) {
  // The lightbox never holds focus, so a React onKeyDown would not fire —
  // listen at the document level for Escape instead.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="animate-fade fixed inset-0 z-[70] flex items-center justify-center bg-ink/90 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={closeLabel}
      onClick={onClose}
    >
      <IconButton
        label={closeLabel}
        className="absolute right-3 top-3 bg-paper"
        onClick={onClose}
      >
        <XIcon className="h-5 w-5" />
      </IconButton>
      <img
        src={photoUrl(photoId, "full")}
        alt=""
        className="max-h-full max-w-full rounded-card object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body,
  );
}

export function ActivityDetail() {
  const t = useT();
  const tag = useLocaleTag();
  const toast = useToast();
  const navigate = useNavigate();
  const { roleFor } = usePets();
  const params = useParams<{ petId: string; id: string }>();
  const petId = params.petId ?? "";
  const id = params.id ?? "";

  const activityQuery = useActivity(petId, id);
  const deleteActivity = useDeleteActivity(petId);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lightboxId, setLightboxId] = useState<string | null>(null);

  if (activityQuery.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }
  const activity = activityQuery.data;
  if (!activity) {
    return (
      <EmptyState
        title={t.errors.notFound}
        action={
          <Button variant="soft" size="sm" onClick={() => navigate(-1)}>
            {t.common.back}
          </Button>
        }
      />
    );
  }

  const tone = categoryTone[activity.category];
  const rows = detailRows(activity, t);
  const canEdit = roleFor(petId) !== "viewer";

  const onDelete = () =>
    deleteActivity.mutate(activity.id, {
      onSuccess: () => {
        toast.show(t.detail.deleted);
        navigate(-1);
      },
      onError: (error) => toast.show(friendlyError(error, t), { tone: "danger" }),
    });

  return (
    <div className="animate-pop flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <IconButton label={t.common.back} onClick={() => navigate(-1)}>
          <ArrowLeftIcon className="h-5 w-5" />
        </IconButton>
        {canEdit && (
          <div className="flex gap-1">
            <IconButton label={t.common.edit} onClick={() => setEditOpen(true)}>
              <PencilIcon className="h-5 w-5" />
            </IconButton>
            <IconButton
              label={t.common.delete}
              className="text-berry-600 hover:bg-berry-100"
              onClick={() => setConfirmOpen(true)}
            >
              <TrashIcon className="h-5 w-5" />
            </IconButton>
          </div>
        )}
      </div>

      {/* category banner */}
      <Card className={cn("flex items-center gap-4 border-l-8 p-5", tone.soft, tone.border)}>
        <span
          className={cn(
            "blob flex h-14 w-14 shrink-0 items-center justify-center bg-paper",
            tone.text,
          )}
        >
          <CategoryIcon category={activity.category} className="h-7 w-7" />
        </span>
        <div>
          <h1 className="text-2xl text-ink">
            {t.categories[activity.category]}
          </h1>
          <p className="text-sm text-ink-soft">
            {formatDateTime(activity.occurredAt, activity.tzOffsetMin, tag)}
          </p>
        </div>
      </Card>

      {rows.length > 0 && (
        <Card className="p-0">
          <dl className="divide-y divide-cream-100">
            {rows.map((row) => (
              <div
                key={row.label}
                className="flex items-baseline justify-between gap-4 px-4 py-2.5"
              >
                <dt className="text-sm font-semibold text-ink-faint">
                  {row.label}
                </dt>
                <dd className="text-right font-semibold text-ink">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      )}

      {activity.memo && (
        <Card>
          <h2 className="mb-1 text-sm font-semibold text-ink-faint">
            {t.add.memo}
          </h2>
          <p className="whitespace-pre-wrap text-ink">{activity.memo}</p>
        </Card>
      )}

      {activity.photos.length > 0 && (
        <Card>
          <h2 className="mb-2 text-sm font-semibold text-ink-faint">
            {t.add.photos}
          </h2>
          <div className="grid grid-cols-3 gap-2">
            {activity.photos.map((photo) => (
              <button
                key={photo.id}
                type="button"
                aria-label={t.detail.viewPhoto}
                onClick={() => setLightboxId(photo.id)}
                className="overflow-hidden rounded-2xl transition active:scale-95"
              >
                <img
                  src={photoUrl(photo.id, "thumb")}
                  alt=""
                  className="aspect-square w-full object-cover"
                />
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* edit sheet: same form, pre-filled */}
      <Sheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={t.categories[activity.category]}
      >
        <ActivityForm
          petId={petId}
          category={activity.category}
          existing={activity}
          onSaved={() => {
            toast.show(t.detail.updated);
            setEditOpen(false);
          }}
        />
      </Sheet>

      {/* delete confirmation */}
      <Sheet
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t.detail.deleteTitle}
      >
        <p className="mb-4 text-ink-soft">{t.detail.deleteBody}</p>
        <div className="flex gap-2">
          <Button
            variant="danger"
            className="flex-1"
            disabled={deleteActivity.isPending}
            onClick={onDelete}
          >
            {t.common.delete}
          </Button>
          <Button
            variant="soft"
            className="flex-1"
            onClick={() => setConfirmOpen(false)}
          >
            {t.common.cancel}
          </Button>
        </div>
      </Sheet>

      {lightboxId && (
        <Lightbox
          photoId={lightboxId}
          closeLabel={t.common.close}
          onClose={() => setLightboxId(null)}
        />
      )}
    </div>
  );
}
