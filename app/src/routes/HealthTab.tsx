import { EmptyState } from "../components/EmptyState";
import { HeartIcon, PawIcon } from "../components/icons";
import { useT } from "../i18n";

function HealthArt() {
  return (
    <div className="relative h-28 w-32" aria-hidden="true">
      <div className="blob absolute left-2 top-3 h-24 w-24 bg-cat-vet-soft" />
      <HeartIcon className="absolute left-8 top-9 h-12 w-12 text-cat-vet" />
      <PawIcon className="absolute right-0 top-0 h-8 w-8 rotate-12 text-clay-300" />
    </div>
  );
}

export function HealthTab() {
  const t = useT();
  return (
    <div className="animate-pop">
      <h1 className="mb-2 text-2xl text-ink">{t.nav.health}</h1>
      <EmptyState
        art={<HealthArt />}
        title={t.health.soonTitle}
        hint={t.health.soonBody}
      />
    </div>
  );
}
