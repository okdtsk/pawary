import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { LogView } from "../features/log/LogView";
import { usePets, useRequiredPet } from "../state/pets";

/**
 * `/log` route — kept for push-notification deep links (`/log?pet=<id>`).
 * The log itself is also reachable as the "Log" view type in the Calendar tab.
 */
export function LogTab() {
  const { selectPet, pets } = usePets();
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const petParam = searchParams.get("pet");
    if (petParam && pets.some((p) => p.id === petParam)) {
      selectPet(petParam);
      searchParams.delete("pet");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, pets, selectPet, setSearchParams]);

  const pet = useRequiredPet();
  return (
    <div className="animate-pop">
      <LogView petId={pet.id} />
    </div>
  );
}
