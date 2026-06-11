import { PetAvatar } from "../components/Avatar";
import { useT } from "../i18n";
import { useRequiredPet } from "../state/pets";

export function Home() {
  const t = useT();
  const pet = useRequiredPet();
  return (
    <div className="animate-pop flex items-center gap-4">
      <PetAvatar pet={pet} size="lg" />
      <h1 className="text-2xl text-ink">{t.greeting(pet.name)}</h1>
    </div>
  );
}
