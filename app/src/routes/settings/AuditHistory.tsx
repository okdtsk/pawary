import type { AuditEntryView } from "@pawary/shared";
import { useAuditLog } from "../../api/audit";
import { ApiError } from "../../api/client";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { EmptyState } from "../../components/EmptyState";
import { Spinner } from "../../components/Spinner";
import { useT } from "../../i18n";
import { useLocaleTag } from "../../i18n";
import { deviceTzOffsetMin, dayKeyOf, relativeDayKind, todayKey } from "../../lib/dates";
import { useParams } from "react-router";
import { SettingsPage } from "./SettingsPage";

function shortDate(ms: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  }).format(new Date(ms));
}

function entryDate(ms: number, locale: string, t: ReturnType<typeof useT>): string {
  const kind = relativeDayKind(dayKeyOf(ms, deviceTzOffsetMin()), todayKey());
  if (kind === "today") return t.common.today;
  if (kind === "yesterday") return t.common.yesterday;
  return shortDate(ms, locale);
}

function auditLine(entry: AuditEntryView, t: ReturnType<typeof useT>): string {
  const entityMap = (t.audit.lines as Record<string, Record<string, string> | undefined>)[entry.entity];
  const line = entityMap?.[entry.action];
  return line ?? `${entry.entity} ${entry.action}`;
}

function AuditEntryRow({ entry }: { entry: AuditEntryView }) {
  const t = useT();
  const locale = useLocaleTag();
  return (
    <li className="flex flex-col gap-0.5 px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-ink">
          {entry.actorName ?? t.audit.formerMember}
        </span>
        <span className="shrink-0 text-xs text-ink-faint">
          {entryDate(entry.createdAt, locale, t)}
        </span>
      </div>
      <p className="text-sm text-ink-soft">{auditLine(entry, t)}</p>
      {entry.summary && (
        <p className="text-xs text-ink-faint">{entry.summary}</p>
      )}
    </li>
  );
}

export function AuditHistory() {
  const t = useT();
  const { petId } = useParams<{ petId: string }>();
  const audit = useAuditLog(petId ?? "");

  if (audit.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  // 403 from the API means non-owner; treat like not found
  if (audit.error instanceof ApiError && (audit.error.status === 403 || audit.error.status === 404)) {
    return (
      <SettingsPage title={t.errors.notFound} backTo={`/settings/pets/${petId ?? ""}`}>
        <p className="text-ink-faint">{t.errors.notFound}</p>
      </SettingsPage>
    );
  }

  if (audit.error) {
    return (
      <SettingsPage title={t.audit.title} backTo={`/settings/pets/${petId ?? ""}`}>
        <p className="text-ink-faint">{t.errors.body}</p>
      </SettingsPage>
    );
  }

  const allEntries = audit.data?.pages.flatMap((p) => p.entries) ?? [];
  const hasMore = !!audit.data?.pages[audit.data.pages.length - 1]?.cursor;

  return (
    <SettingsPage title={t.audit.title} backTo={`/settings/pets/${petId ?? ""}`}>
      {allEntries.length === 0 ? (
        <Card>
          <EmptyState title={t.audit.empty} />
        </Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-cream-200">
            {allEntries.map((entry) => (
              <AuditEntryRow key={entry.id} entry={entry} />
            ))}
          </ul>
        </Card>
      )}
      {hasMore && (
        <Button
          variant="ghost"
          disabled={audit.isFetchingNextPage}
          onClick={() => void audit.fetchNextPage()}
        >
          {audit.isFetchingNextPage ? <Spinner className="h-4 w-4" /> : null}
          {t.common.showMore}
        </Button>
      )}
    </SettingsPage>
  );
}
