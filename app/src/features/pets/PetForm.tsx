import type { Sex, Species } from "@pawary/shared";
import { useState, type ReactNode } from "react";
import { Button } from "../../components/Button";
import { DateInput, Field, Select, TextInput } from "../../components/form";
import { CatIcon, DogIcon, PawIcon } from "../../components/icons";
import { useT } from "../../i18n";
import { cn } from "../../lib/cn";

export type PetFormValues = {
  name: string;
  species: Species;
  breed: string;
  sex: "" | Sex;
  birthday: string; // "" or YYYY-MM-DD
};

function SpeciesButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex flex-1 flex-col items-center gap-1.5 rounded-card border-2 px-2 py-3 font-semibold transition active:scale-95",
        active
          ? "border-clay-400 bg-clay-50 text-clay-800"
          : "border-cream-200 bg-paper text-ink-faint hover:border-cream-300",
      )}
    >
      {children}
      <span className="text-sm">{label}</span>
    </button>
  );
}

export function PetForm({
  initial,
  submitting,
  submitLabel,
  onSubmit,
}: {
  initial?: PetFormValues;
  submitting: boolean;
  submitLabel: string;
  onSubmit: (values: PetFormValues) => void;
}) {
  const t = useT();
  const [values, setValues] = useState<PetFormValues>(
    initial ?? { name: "", species: "dog", breed: "", sex: "", birthday: "" },
  );
  const [nameError, setNameError] = useState<string | null>(null);

  const set = <K extends keyof PetFormValues>(key: K, v: PetFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: v }));

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (values.name.trim() === "") {
          setNameError(t.pets.nameRequired);
          return;
        }
        setNameError(null);
        onSubmit({ ...values, name: values.name.trim() });
      }}
    >
      <div className="flex gap-2" role="group" aria-label={t.pets.species}>
        <SpeciesButton
          active={values.species === "dog"}
          label={t.pets.speciesDog}
          onClick={() => set("species", "dog")}
        >
          <DogIcon className="h-9 w-9" />
        </SpeciesButton>
        <SpeciesButton
          active={values.species === "cat"}
          label={t.pets.speciesCat}
          onClick={() => set("species", "cat")}
        >
          <CatIcon className="h-9 w-9" />
        </SpeciesButton>
        <SpeciesButton
          active={values.species === "other"}
          label={t.pets.speciesOther}
          onClick={() => set("species", "other")}
        >
          <PawIcon className="h-9 w-9" />
        </SpeciesButton>
      </div>

      <Field label={t.pets.name} error={nameError}>
        <TextInput
          value={values.name}
          maxLength={50}
          onChange={(e) => set("name", e.target.value)}
        />
      </Field>
      <Field label={`${t.pets.breed} (${t.common.optional})`}>
        <TextInput
          value={values.breed}
          maxLength={100}
          onChange={(e) => set("breed", e.target.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`${t.pets.sex} (${t.common.optional})`}>
          <Select
            value={values.sex}
            onChange={(e) => set("sex", e.target.value as PetFormValues["sex"])}
          >
            <option value="">—</option>
            <option value="male">{t.pets.sexMale}</option>
            <option value="female">{t.pets.sexFemale}</option>
            <option value="unknown">{t.pets.sexUnknown}</option>
          </Select>
        </Field>
        <Field label={`${t.pets.birthday} (${t.common.optional})`}>
          <DateInput
            value={values.birthday}
            onChange={(e) => set("birthday", e.target.value)}
          />
        </Field>
      </div>

      <Button type="submit" disabled={submitting} className="mt-2">
        {submitLabel}
      </Button>
    </form>
  );
}
