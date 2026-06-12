import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { MeResponse, Role } from "@pawary/shared";

export type MePet = MeResponse["pets"][number];

const STORAGE_KEY = "pawary:selectedPetId";

type PetContextValue = {
  pets: MePet[];
  selectedPet: MePet | null;
  selectPet: (id: string) => void;
  roleFor: (petId: string) => Role | null;
};

const PetContext = createContext<PetContextValue | null>(null);

export function PetProvider({
  me,
  children,
}: {
  me: MeResponse;
  children: ReactNode;
}) {
  const [storedId, setStoredId] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY),
  );
  const pets = me.pets;
  const value = useMemo<PetContextValue>(() => {
    const selectedPet = pets.find((p) => p.id === storedId) ?? pets[0] ?? null;
    return {
      pets,
      selectedPet,
      selectPet: (id: string) => {
        localStorage.setItem(STORAGE_KEY, id);
        setStoredId(id);
      },
      roleFor: (petId: string) =>
        pets.find((p) => p.id === petId)?.role ?? null,
    };
  }, [pets, storedId]);
  return <PetContext.Provider value={value}>{children}</PetContext.Provider>;
}

export function usePets(): PetContextValue {
  const ctx = useContext(PetContext);
  if (!ctx) throw new Error("usePets must be used inside PetProvider");
  return ctx;
}

/** For screens only reachable when ≥1 pet exists (Shell guards zero-pet). */
export function useRequiredPet(): MePet {
  const { selectedPet } = usePets();
  if (!selectedPet) throw new Error("useRequiredPet with no pets");
  return selectedPet;
}
