import type { CreatePetInput } from "@pawary/shared";
import { useCreatePet } from "../api/pets";
import { Card } from "../components/Card";
import { PawIcon } from "../components/icons";
import { PetForm, type PetFormValues } from "../features/pets/PetForm";
import { useT } from "../i18n";
import { usePets } from "../state/pets";

export function Onboarding() {
  const t = useT();
  const { selectPet } = usePets();
  const createPet = useCreatePet();

  const submit = (values: PetFormValues) => {
    const input: CreatePetInput = {
      name: values.name,
      species: values.species,
      ...(values.breed.trim() ? { breed: values.breed.trim() } : {}),
      ...(values.sex ? { sex: values.sex } : {}),
      ...(values.birthday ? { birthday: values.birthday } : {}),
    };
    createPet.mutate(input, { onSuccess: (pet) => selectPet(pet.id) });
  };

  return (
    <main className="relative min-h-dvh overflow-hidden bg-cream-100 px-4 py-10">
      <div
        aria-hidden="true"
        className="blob absolute -right-20 -top-16 h-64 w-64 bg-clay-100"
      />
      <div className="relative mx-auto flex max-w-md flex-col gap-5">
        <div className="animate-pop flex flex-col items-center gap-3 text-center">
          <span className="blob flex h-20 w-20 items-center justify-center bg-clay-500 text-white shadow-float">
            <PawIcon className="h-10 w-10" />
          </span>
          <h1 className="text-3xl text-ink">{t.onboarding.title}</h1>
          <p className="text-ink-soft">{t.onboarding.intro}</p>
        </div>
        <Card className="animate-pop p-5" style={{ animationDelay: "120ms" }}>
          <PetForm
            submitting={createPet.isPending}
            submitLabel={t.onboarding.cta}
            onSubmit={submit}
          />
        </Card>
      </div>
    </main>
  );
}
