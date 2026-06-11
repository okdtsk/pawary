import { CATEGORIES, type Category } from "@pawlog/shared";
import { useEffect, useRef, useState } from "react";
import { useLogActivities } from "../api/activities";
import { ActivityRow } from "../components/ActivityRow";
import { CategoryIcon, categoryTone } from "../components/CategoryIcon";
import { Chip } from "../components/Chip";
import { EmptyState } from "../components/EmptyState";
import { TextInput } from "../components/form";
import { PawIcon, SearchIcon } from "../components/icons";
import { Spinner } from "../components/Spinner";
import { useLocaleTag, useT } from "../i18n";
import {
  dayKeyOf,
  formatDayHeading,
  relativeDayKind,
  todayKey,
  type DayKey,
} from "../lib/dates";
import { useRequiredPet } from "../state/pets";

export function LogTab() {
  const t = useT();
  const tag = useLocaleTag();
  const pet = useRequiredPet();
  const [selectedCats, setSelectedCats] = useState<Category[]>([]);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const sentinelRef = useRef<HTMLDivElement>(null);

  // debounce the search input
  useEffect(() => {
    const id = window.setTimeout(() => setQ(qInput.trim()), 300);
    return () => window.clearTimeout(id);
  }, [qInput]);

  const log = useLogActivities(pet.id, { categories: selectedCats, q });
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = log;

  // infinite scroll sentinel
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
        void fetchNextPage();
      }
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const toggleCat = (category: Category) =>
    setSelectedCats((prev) =>
      prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category],
    );

  const items = log.data?.pages.flatMap((page) => page.items) ?? [];
  // group consecutive items (already sorted desc by the API) by household day
  const groups: { key: DayKey; items: typeof items }[] = [];
  for (const activity of items) {
    const key = dayKeyOf(activity.occurredAt, activity.tzOffsetMin);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(activity);
    else groups.push({ key, items: [activity] });
  }
  const today = todayKey();

  const dayLabel = (key: DayKey): string => {
    const kind = relativeDayKind(key, today);
    if (kind === "today") return t.common.today;
    if (kind === "yesterday") return t.common.yesterday;
    return formatDayHeading(key, tag);
  };

  return (
    <div className="animate-pop flex flex-col gap-3">
      {/* search */}
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
        <TextInput
          type="search"
          value={qInput}
          placeholder={t.log.searchPlaceholder}
          aria-label={t.log.searchPlaceholder}
          className="pl-10"
          onChange={(e) => setQInput(e.target.value)}
        />
      </div>

      {/* category filter chips (multi-select) */}
      <div
        role="group"
        aria-label={t.log.filterLabel}
        className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1"
      >
        {CATEGORIES.map((category) => (
          <Chip
            key={category}
            selected={selectedCats.includes(category)}
            tone={categoryTone[category]}
            onClick={() => toggleCat(category)}
          >
            <CategoryIcon category={category} className="h-4 w-4" />
            {t.categories[category]}
          </Chip>
        ))}
      </div>

      {log.isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <EmptyState title={t.log.emptyTitle} hint={t.log.emptyHint} />
      ) : (
        <div className="overflow-hidden rounded-card bg-paper shadow-card">
          {groups.map((group) => (
            <section key={group.key}>
              <h2 className="sticky top-0 z-10 border-b border-cream-200 bg-cream-50/95 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-ink-soft backdrop-blur">
                {dayLabel(group.key)}
              </h2>
              <div className="divide-y divide-cream-100">
                {group.items.map((activity) => (
                  <ActivityRow key={activity.id} activity={activity} />
                ))}
              </div>
            </section>
          ))}
          <div ref={sentinelRef} className="flex justify-center py-4">
            {isFetchingNextPage ? (
              <Spinner className="h-5 w-5" />
            ) : !hasNextPage ? (
              <PawIcon
                aria-hidden="true"
                className="h-5 w-5 rotate-12 text-cream-300"
              />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
