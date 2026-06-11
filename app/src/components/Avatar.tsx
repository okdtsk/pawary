import { cn } from "../lib/cn";
import { CatIcon, DogIcon, PawIcon } from "./icons";

type PetLike = {
  id: string;
  name: string;
  species: "dog" | "cat" | "other";
  avatarR2Key: string | null;
};

const FALLBACK_TINTS = [
  { bg: "bg-cat-food-soft", text: "text-cat-food" },
  { bg: "bg-cat-water-soft", text: "text-cat-water" },
  { bg: "bg-cat-exercise-soft", text: "text-cat-exercise" },
  { bg: "bg-cat-weight-soft", text: "text-cat-weight" },
  { bg: "bg-cat-grooming-soft", text: "text-cat-grooming" },
  { bg: "bg-cat-medication-soft", text: "text-cat-medication" },
] as const;

function tintFor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return FALLBACK_TINTS[Math.abs(hash) % FALLBACK_TINTS.length]!;
}

const sizeClasses = {
  sm: "h-8 w-8",
  md: "h-11 w-11",
  lg: "h-16 w-16",
  xl: "h-24 w-24",
} as const;
const iconSize = { sm: "h-5 w-5", md: "h-6 w-6", lg: "h-9 w-9", xl: "h-12 w-12" } as const;

export function PetAvatar({
  pet,
  size = "md",
  className,
}: {
  pet: PetLike;
  size?: keyof typeof sizeClasses;
  className?: string;
}) {
  const tint = tintFor(pet.id);
  if (pet.avatarR2Key) {
    return (
      <img
        src={`/api/pets/${pet.id}/avatar`}
        alt={pet.name}
        className={cn("blob object-cover", sizeClasses[size], className)}
      />
    );
  }
  const Icon =
    pet.species === "dog" ? DogIcon : pet.species === "cat" ? CatIcon : PawIcon;
  return (
    <span
      role="img"
      aria-label={pet.name}
      className={cn(
        "blob inline-flex shrink-0 items-center justify-center",
        tint.bg,
        tint.text,
        sizeClasses[size],
        className,
      )}
    >
      <Icon className={iconSize[size]} />
    </span>
  );
}

export function UserAvatar({
  name,
  avatarUrl,
  size = "sm",
  className,
}: {
  name: string;
  avatarUrl: string | null;
  size?: keyof typeof sizeClasses;
  className?: string;
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className={cn("rounded-full object-cover", sizeClasses[size], className)}
      />
    );
  }
  return (
    <span
      role="img"
      aria-label={name}
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-clay-100 font-display text-clay-700",
        sizeClasses[size],
        className,
      )}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
