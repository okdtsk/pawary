import type { Category } from "@pawary/shared";
import type { ReactElement, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

/** Literal utility classes per category (Tailwind extracts literals only). */
export const categoryTone: Record<
  Category,
  { text: string; bg: string; soft: string; border: string }
> = {
  food: { text: "text-cat-food", bg: "bg-cat-food", soft: "bg-cat-food-soft", border: "border-cat-food" },
  water: { text: "text-cat-water", bg: "bg-cat-water", soft: "bg-cat-water-soft", border: "border-cat-water" },
  toilet: { text: "text-cat-toilet", bg: "bg-cat-toilet", soft: "bg-cat-toilet-soft", border: "border-cat-toilet" },
  weight: { text: "text-cat-weight", bg: "bg-cat-weight", soft: "bg-cat-weight-soft", border: "border-cat-weight" },
  exercise: { text: "text-cat-exercise", bg: "bg-cat-exercise", soft: "bg-cat-exercise-soft", border: "border-cat-exercise" },
  symptom: { text: "text-cat-symptom", bg: "bg-cat-symptom", soft: "bg-cat-symptom-soft", border: "border-cat-symptom" },
  medication: { text: "text-cat-medication", bg: "bg-cat-medication", soft: "bg-cat-medication-soft", border: "border-cat-medication" },
  vet_visit: { text: "text-cat-vet", bg: "bg-cat-vet", soft: "bg-cat-vet-soft", border: "border-cat-vet" },
  grooming: { text: "text-cat-grooming", bg: "bg-cat-grooming", soft: "bg-cat-grooming-soft", border: "border-cat-grooming" },
  vaccination: { text: "text-cat-vaccine", bg: "bg-cat-vaccine", soft: "bg-cat-vaccine-soft", border: "border-cat-vaccine" },
  note: { text: "text-cat-note", bg: "bg-cat-note", soft: "bg-cat-note-soft", border: "border-cat-note" },
};

function Base({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

const icons: Record<Category, (props: IconProps) => ReactElement> = {
  food: (p) => (
    <Base {...p}>
      <path d="M3.5 13a8.5 8.5 0 0 0 17 0Z" />
      <circle cx="8.5" cy="9.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="9.5" r="1" fill="currentColor" stroke="none" />
    </Base>
  ),
  water: (p) => (
    <Base {...p}>
      <path d="M12 3.5c3.6 4.3 6 7.3 6 10.3a6 6 0 0 1-12 0c0-3 2.4-6 6-10.3Z" />
      <path d="M9.5 14a2.6 2.6 0 0 0 2 2.4" />
    </Base>
  ),
  toilet: (p) => (
    <Base {...p}>
      <path d="M4 18.5h16" />
      <path d="M7.5 18.5a4.5 4.5 0 0 1 9 0" />
      <path d="M10 10.5 9 12.8M14 10.5l1 2.3M12 9.5v2.3" />
    </Base>
  ),
  weight: (p) => (
    <Base {...p}>
      <rect x="4" y="4.5" width="16" height="15" rx="4" />
      <path d="M8.8 10.5a4 4 0 0 1 6.4 0" />
      <path d="m12 11.5 1.6-1.8" />
    </Base>
  ),
  exercise: (p) => (
    <Base {...p}>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 4.5a13.5 13.5 0 0 0 0 15M4.5 12h15" />
    </Base>
  ),
  symptom: (p) => (
    <Base {...p}>
      <path d="M10.5 13.8V5.5a1.5 1.5 0 0 1 3 0v8.3a3.6 3.6 0 1 1-3 0Z" />
      <circle cx="12" cy="17" r="1" fill="currentColor" stroke="none" />
    </Base>
  ),
  medication: (p) => (
    <Base {...p}>
      <rect x="4.5" y="8.8" width="15" height="6.5" rx="3.25" />
      <path d="M12 8.8v6.5" />
    </Base>
  ),
  vet_visit: (p) => (
    <Base {...p}>
      <path d="M12 20s-7-4.5-7-9.7A4 4 0 0 1 12 7.7a4 4 0 0 1 7 2.6C19 15.5 12 20 12 20Z" />
      <path d="M12 9.5v4.6M9.7 11.8h4.6" />
    </Base>
  ),
  grooming: (p) => (
    <Base {...p}>
      <rect x="4.5" y="8" width="15" height="4.5" rx="2.25" />
      <path d="M7.5 12.5v3.5M10.5 12.5v3.5M13.5 12.5v3.5M16.5 12.5v3.5" />
    </Base>
  ),
  vaccination: (p) => (
    <Base {...p}>
      <path d="m18.5 3 2.5 2.5M13.5 4.5l6 6" />
      <path d="M16.5 7.5 7.5 16.5l-3.5 1 1-3.5 9-9" />
      <path d="m4.5 19.5-2 2" />
    </Base>
  ),
  note: (p) => (
    <Base {...p}>
      <path d="M6.5 3.5H14l5.5 5.5v11.5h-13Z" />
      <path d="M14 3.5V9h5.5M9.5 13h5M9.5 16.5h3.5" />
    </Base>
  ),
};

export function CategoryIcon({
  category,
  ...props
}: { category: Category } & IconProps) {
  const Icon = icons[category];
  return <Icon {...props} />;
}
