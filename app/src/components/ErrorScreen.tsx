import { useT } from "../i18n";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";
import { PawIcon } from "./icons";

function SadArt() {
  return (
    <div className="relative h-28 w-32" aria-hidden="true">
      <div className="blob absolute left-2 top-3 h-24 w-24 bg-berry-100" />
      <PawIcon className="absolute left-9 top-10 h-11 w-11 rotate-[168deg] text-berry-600/50" />
    </div>
  );
}

export function ErrorScreen({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <main className="flex min-h-dvh items-center justify-center bg-cream-100 p-6">
      <EmptyState
        art={<SadArt />}
        title={t.errors.title}
        hint={t.errors.body}
        action={<Button onClick={onRetry}>{t.common.retry}</Button>}
      />
    </main>
  );
}
