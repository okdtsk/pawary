import type { Category, PresetResponse } from "@pawary/shared";
import { useEffect, useState } from "react";
import {
  useCreatePreset,
  useDeletePreset,
  usePresets,
  useUpdatePreset,
} from "../../api/presets";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { CategoryIcon, categoryTone } from "../../components/CategoryIcon";
import { EmptyState } from "../../components/EmptyState";
import { Field, TextInput } from "../../components/form";
import { IconButton } from "../../components/IconButton";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  PlusIcon,
  TrashIcon,
} from "../../components/icons";
import { Sheet } from "../../components/Sheet";
import { Spinner } from "../../components/Spinner";
import { useToast } from "../../components/Toast";
import { CategoryGrid } from "../../features/add/CategoryGrid";
import {
  buildDetails,
  initialValues,
  type FormValues,
} from "../../features/add/categoryFields";
import { DetailsFields } from "../../features/add/DetailsFields";
import { useT } from "../../i18n";
import { cn } from "../../lib/cn";
import { friendlyError } from "../../lib/errors";
import { useRequiredPet } from "../../state/pets";
import { SettingsPage } from "./SettingsPage";

function PresetEditorSheet({
  petId,
  open,
  nextSortOrder,
  onClose,
}: {
  petId: string;
  open: boolean;
  nextSortOrder: number;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const create = useCreatePreset(petId);
  const [category, setCategory] = useState<Category | null>(null);
  const [label, setLabel] = useState("");
  const [values, setValues] = useState<FormValues>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setCategory(null);
      setLabel("");
      setValues({});
      setError(null);
    }
  }, [open]);

  const pick = (c: Category) => {
    setCategory(c);
    setValues(initialValues(c));
  };

  const save = () => {
    if (!category) return;
    if (label.trim() === "") {
      setError(t.add.requiredField(t.settings.presetLabel));
      return;
    }
    const built = buildDetails(category, values, t);
    if ("error" in built) {
      setError(built.error);
      return;
    }
    setError(null);
    create.mutate(
      {
        category,
        label: label.trim(),
        details: built.details,
        sortOrder: nextSortOrder,
      },
      {
        onSuccess: () => {
          toast.show(t.settings.presetCreated);
          onClose();
        },
        onError: (error) => toast.show(friendlyError(error, t), { tone: "danger" }),
      },
    );
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t.settings.newPreset}
      wide={category === null}
    >
      {category === null ? (
        <CategoryGrid onPick={pick} />
      ) : (
        <div className="flex flex-col gap-4">
          <IconButton
            label={t.common.back}
            className="-mt-1 self-start"
            onClick={() => setCategory(null)}
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </IconButton>
          <Field label={t.settings.presetLabel}>
            <TextInput
              value={label}
              maxLength={30}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
          <DetailsFields
            category={category}
            values={values}
            onChange={setValues}
          />
          {error && (
            <p role="alert" className="text-sm font-semibold text-berry-600">
              {error}
            </p>
          )}
          <Button disabled={create.isPending} onClick={save}>
            {t.common.save}
          </Button>
        </div>
      )}
    </Sheet>
  );
}

export function PresetsSettings() {
  const t = useT();
  const pet = useRequiredPet();
  const canEdit = pet.role !== "viewer";
  const presets = usePresets(pet.id);
  const update = useUpdatePreset(pet.id);
  const remove = useDeletePreset(pet.id);
  const [editorOpen, setEditorOpen] = useState(false);
  const items = presets.data ?? [];

  /** Swap with a neighbor, then re-number every drifted sortOrder to idx*10. */
  const move = async (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next: PresetResponse[] = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    for (let i = 0; i < next.length; i++) {
      const preset = next[i]!;
      if (preset.sortOrder !== i * 10) {
        await update.mutateAsync({
          id: preset.id,
          input: { sortOrder: i * 10 },
        });
      }
    }
  };

  return (
    <SettingsPage title={t.settings.presets} backTo="/settings">
      {presets.isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <EmptyState title={t.quickAdd.emptyTitle} hint={t.quickAdd.emptyHint} />
      ) : (
        <Card className="divide-y divide-cream-200 p-0">
          {items.map((preset, index) => {
            const tone = categoryTone[preset.category];
            return (
              <div key={preset.id} className="flex items-center gap-3 px-4 py-2.5">
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                    tone.soft,
                    tone.text,
                  )}
                >
                  <CategoryIcon category={preset.category} className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-ink">
                    {preset.label}
                  </span>
                  <span className="block text-xs text-ink-faint">
                    {t.categories[preset.category]}
                  </span>
                </span>
                {canEdit && (
                  <>
                    <IconButton
                      label={t.settings.moveUp}
                      disabled={index === 0 || update.isPending}
                      onClick={() => void move(index, -1)}
                    >
                      <ArrowUpIcon className="h-4 w-4" />
                    </IconButton>
                    <IconButton
                      label={t.settings.moveDown}
                      disabled={index === items.length - 1 || update.isPending}
                      onClick={() => void move(index, 1)}
                    >
                      <ArrowDownIcon className="h-4 w-4" />
                    </IconButton>
                    <IconButton
                      label={t.common.delete}
                      className="text-berry-600 hover:bg-berry-100"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(preset.id)}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </IconButton>
                  </>
                )}
              </div>
            );
          })}
        </Card>
      )}

      {canEdit && (
        <>
          <Button
            variant="soft"
            size="sm"
            className="self-start"
            onClick={() => setEditorOpen(true)}
          >
            <PlusIcon className="h-4 w-4" />
            {t.settings.newPreset}
          </Button>

          <PresetEditorSheet
            petId={pet.id}
            open={editorOpen}
            nextSortOrder={items.length * 10}
            onClose={() => setEditorOpen(false)}
          />
        </>
      )}
    </SettingsPage>
  );
}
