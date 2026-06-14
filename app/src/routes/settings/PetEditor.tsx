import type { PetResponse, UpdatePetInput } from "@pawary/shared";
import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { MAX_PHOTO_BYTES } from "../../api/photos";
import {
  useCreatePet,
  useDeletePetAvatar,
  usePet,
  useSetPetTargets,
  useUpdatePet,
  useUploadPetAvatar,
} from "../../api/pets";
import { PetAvatar } from "../../components/Avatar";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { Field, NumberInput } from "../../components/form";
import { Spinner } from "../../components/Spinner";
import { normalizeImageForUpload } from "../../lib/image";
import { MembersSection } from "../../features/pets/MembersSection";
import { PetForm, type PetFormValues } from "../../features/pets/PetForm";
import { useT } from "../../i18n";
import { SettingsPage } from "./SettingsPage";

function EditExisting({ pet }: { pet: PetResponse }) {
  const t = useT();
  const navigate = useNavigate();
  const updatePet = useUpdatePet(pet.id);
  const setTargets = useSetPetTargets(pet.id);
  const uploadAvatar = useUploadPetAvatar(pet.id);
  const deleteAvatar = useDeletePetAvatar(pet.id);
  const fileRef = useRef<HTMLInputElement>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [food, setFood] = useState(
    pet.targets?.foodGPerDay != null ? String(pet.targets.foodGPerDay) : "",
  );
  const [water, setWater] = useState(
    pet.targets?.waterMlPerDay != null ? String(pet.targets.waterMlPerDay) : "",
  );
  const [saved, setSaved] = useState(false);
  const canEdit = pet.role !== "viewer";

  const onPickAvatar = async (file: File | undefined) => {
    // Reset the input so re-picking the same file fires onChange again.
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    if (file.size > MAX_PHOTO_BYTES) {
      setAvatarError(t.pets.photoTooLarge);
      return;
    }
    setAvatarError(null);
    // Normalize orientation (iPhone portrait photos) and downscale before upload.
    const normalized = await normalizeImageForUpload(file);
    uploadAvatar.mutate(normalized, {
      onError: () => setAvatarError(t.errors.title),
    });
  };

  const onRemoveAvatar = () => {
    setAvatarError(null);
    deleteAvatar.mutate(undefined, {
      onError: () => setAvatarError(t.errors.title),
    });
  };

  const submit = async (values: PetFormValues) => {
    const input: UpdatePetInput = {
      name: values.name,
      species: values.species,
      breed: values.breed.trim() === "" ? null : values.breed.trim(),
      sex: values.sex === "" ? null : values.sex,
      birthday: values.birthday === "" ? null : values.birthday,
    };
    await updatePet.mutateAsync(input);
    const foodN = food.trim() === "" ? null : Number(food);
    const waterN = water.trim() === "" ? null : Number(water);
    if (
      (foodN === null || (Number.isFinite(foodN) && foodN > 0)) &&
      (waterN === null || (Number.isFinite(waterN) && waterN > 0))
    ) {
      await setTargets.mutateAsync({
        foodGPerDay: foodN,
        waterMlPerDay: waterN,
      });
    }
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  };

  return (
    <SettingsPage title={pet.name} backTo="/settings/pets">
      <Card className="flex items-center gap-4 p-5">
        <PetAvatar pet={pet} size="xl" />
        <div className="flex flex-col items-start gap-1.5">
          {canEdit && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => void onPickAvatar(e.target.files?.[0])}
              />
              <div className="flex items-center gap-2">
                <Button
                  variant="soft"
                  size="sm"
                  disabled={uploadAvatar.isPending || deleteAvatar.isPending}
                  onClick={() => fileRef.current?.click()}
                >
                  {uploadAvatar.isPending ? (
                    <Spinner className="h-4 w-4" />
                  ) : null}
                  {t.pets.changePhoto}
                </Button>
                {pet.avatarR2Key && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-ink-faint"
                    disabled={uploadAvatar.isPending || deleteAvatar.isPending}
                    onClick={onRemoveAvatar}
                  >
                    {deleteAvatar.isPending ? (
                      <Spinner className="h-4 w-4" />
                    ) : null}
                    {t.pets.removePhoto}
                  </Button>
                )}
              </div>
            </>
          )}
          {avatarError && (
            <span role="alert" className="text-xs font-semibold text-berry-600">
              {avatarError}
            </span>
          )}
          {pet.archived && (
            <span className="rounded-full bg-cream-200 px-2.5 py-0.5 text-xs font-semibold text-ink-soft">
              {t.pets.archivedBadge}
            </span>
          )}
        </div>
      </Card>

      {canEdit ? (
        <Card className="p-5">
          <PetForm
            initial={{
              name: pet.name,
              species: pet.species,
              breed: pet.breed ?? "",
              sex: pet.sex ?? "",
              birthday: pet.birthday ?? "",
            }}
            submitting={updatePet.isPending || setTargets.isPending}
            submitLabel={saved ? t.pets.saved : t.common.save}
            onSubmit={(values) => void submit(values)}
          />
          <div className="mt-5 border-t border-cream-200 pt-4">
            <h2 className="mb-1 font-display text-lg text-ink">
              {t.pets.targetsTitle}
            </h2>
            <p className="mb-3 text-sm text-ink-faint">{t.pets.targetsHint}</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t.pets.foodTarget}>
                <NumberInput
                  value={food}
                  min={0}
                  onChange={(e) => setFood(e.target.value)}
                />
              </Field>
              <Field label={t.pets.waterTarget}>
                <NumberInput
                  value={water}
                  min={0}
                  onChange={(e) => setWater(e.target.value)}
                />
              </Field>
            </div>
          </div>
        </Card>
      ) : null}

      <MembersSection pet={pet} />

      {pet.role === "owner" && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => navigate(`/settings/pets/${pet.id}/audit`)}
        >
          {t.audit.history}
        </Button>
      )}

      {canEdit && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start text-ink-faint"
          disabled={updatePet.isPending}
          onClick={() =>
            updatePet.mutate(
              { archived: !pet.archived },
              { onSuccess: () => navigate("/settings/pets") },
            )
          }
        >
          {pet.archived ? t.pets.unarchive : t.pets.archive}
        </Button>
      )}
    </SettingsPage>
  );
}

export function PetEditor() {
  const t = useT();
  const navigate = useNavigate();
  const { petId } = useParams<{ petId: string }>();
  const isNew = petId === undefined;
  const createPet = useCreatePet();
  // hook stays unconditional; the query is disabled in "new" mode
  const petQuery = usePet(petId ?? "", !isNew);

  if (isNew) {
    return (
      <SettingsPage title={t.pets.addPet} backTo="/settings/pets">
        <Card className="p-5">
          <PetForm
            submitting={createPet.isPending}
            submitLabel={t.common.add}
            onSubmit={(values) =>
              createPet.mutate(
                {
                  name: values.name,
                  species: values.species,
                  ...(values.breed.trim() ? { breed: values.breed.trim() } : {}),
                  ...(values.sex ? { sex: values.sex } : {}),
                  ...(values.birthday ? { birthday: values.birthday } : {}),
                },
                { onSuccess: () => navigate("/settings/pets") },
              )
            }
          />
        </Card>
      </SettingsPage>
    );
  }

  if (petQuery.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }
  if (!petQuery.data) {
    return (
      <SettingsPage title={t.errors.notFound} backTo="/settings/pets">
        <p className="text-ink-faint">{t.errors.notFound}</p>
      </SettingsPage>
    );
  }
  return <EditExisting pet={petQuery.data} />;
}
