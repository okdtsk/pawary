import { Link } from "react-router";
import { PetAvatar } from "../../components/Avatar";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { ChevronRightIcon, PlusIcon } from "../../components/icons";
import { useT } from "../../i18n";
import { usePets } from "../../state/pets";
import { SettingsPage } from "./SettingsPage";

export function PetsSettings() {
  const t = useT();
  const { pets } = usePets();

  return (
    <SettingsPage title={t.pets.yourPets} backTo="/settings">
      <Card className="divide-y divide-cream-200 p-0">
        {pets.map((pet) => (
          <Link
            key={pet.id}
            to={`/settings/pets/${pet.id}`}
            className="flex items-center gap-3 px-4 py-3 transition hover:bg-cream-50"
          >
            <PetAvatar pet={pet} size="md" />
            <span className="flex-1 font-semibold text-ink">{pet.name}</span>
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
              {t.pets.role[pet.role]}
            </span>
            <ChevronRightIcon className="h-4 w-4 text-ink-faint" />
          </Link>
        ))}
      </Card>
      <Link to="/settings/pets/new" className="self-start">
        <Button variant="soft" size="sm">
          <PlusIcon className="h-4 w-4" />
          {t.pets.addPet}
        </Button>
      </Link>
    </SettingsPage>
  );
}
