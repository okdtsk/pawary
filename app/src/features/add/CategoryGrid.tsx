import { CATEGORIES, type Category } from "@pawlog/shared";
import { CategoryIcon, categoryTone } from "../../components/CategoryIcon";
import { useT } from "../../i18n";
import { cn } from "../../lib/cn";

export function CategoryGrid({
  onPick,
  selected,
}: {
  onPick: (category: Category) => void;
  selected?: Category;
}) {
  const t = useT();
  return (
    <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
      {CATEGORIES.map((category, i) => {
        const tone = categoryTone[category];
        const active = selected === category;
        return (
          <button
            key={category}
            type="button"
            aria-pressed={active}
            onClick={() => onPick(category)}
            className={cn(
              "animate-pop flex flex-col items-center gap-1.5 rounded-card border-2 px-1 py-3 transition active:scale-95",
              active
                ? cn("border-current", tone.soft, tone.text)
                : "border-transparent bg-cream-50 hover:bg-cream-100",
            )}
            style={{ animationDelay: `${i * 25}ms` }}
          >
            <span
              className={cn(
                "flex h-11 w-11 items-center justify-center rounded-full",
                tone.soft,
                tone.text,
              )}
            >
              <CategoryIcon category={category} className="h-6 w-6" />
            </span>
            <span className="text-xs font-semibold text-ink">
              {t.categories[category]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
