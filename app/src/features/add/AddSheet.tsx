import type { Category } from "@pawlog/shared";
import { useEffect, useState } from "react";
import { IconButton } from "../../components/IconButton";
import { ArrowLeftIcon } from "../../components/icons";
import { Sheet } from "../../components/Sheet";
import { useToast } from "../../components/Toast";
import { useT } from "../../i18n";
import { useRequiredPet } from "../../state/pets";
import { ActivityForm } from "./ActivityForm";
import { CategoryGrid } from "./CategoryGrid";

export function AddSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const pet = useRequiredPet();
  const [category, setCategory] = useState<Category | null>(null);

  useEffect(() => {
    if (!open) setCategory(null);
  }, [open]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={category ? t.categories[category] : t.add.pickCategory}
      wide={category === null}
    >
      {category === null ? (
        <CategoryGrid onPick={setCategory} />
      ) : (
        <div className="flex flex-col gap-3">
          <IconButton
            label={t.common.back}
            className="-mt-1 self-start"
            onClick={() => setCategory(null)}
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </IconButton>
          <ActivityForm
            petId={pet.id}
            category={category}
            onSaved={() => {
              toast.show(t.add.saved);
              onClose();
            }}
          />
        </div>
      )}
    </Sheet>
  );
}
