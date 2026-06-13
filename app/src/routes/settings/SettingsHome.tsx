import type { Locale } from "@pawary/shared";
import { useState } from "react";
import { Link } from "react-router";
import { myExportUrl, petExportUrl } from "../../api/export";
import { useLogout, useMe, useUpdateMe } from "../../api/me";
import { UserAvatar } from "../../components/Avatar";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { Field, Select, TextInput } from "../../components/form";
import { ChevronRightIcon, DownloadIcon } from "../../components/icons";
import { useToast } from "../../components/Toast";
import { useT } from "../../i18n";
import { NotificationsCard } from "../../features/pwa/NotificationsCard";
import { useCalendarPrefs } from "../../lib/calendarPrefs";
import { useRequiredPet } from "../../state/pets";
import { SettingsPage } from "./SettingsPage";

const ALL_TIMEZONES: string[] = (() => {
  const sv = (
    Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
  ).supportedValuesOf;
  return sv ? sv("timeZone") : [];
})();

export function SettingsHome() {
  const t = useT();
  const toast = useToast();
  const me = useMe();
  const updateMe = useUpdateMe();
  const logout = useLogout();
  const pet = useRequiredPet();
  const user = me.data?.user;
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [locale, setLocale] = useState<Locale>(user?.locale ?? "system");
  const { prefs, setPref } = useCalendarPrefs();
  const timeZones = ALL_TIMEZONES.includes(prefs.timeZone)
    ? ALL_TIMEZONES
    : [prefs.timeZone, ...ALL_TIMEZONES];

  const saveProfile = () => {
    if (displayName.trim() === "") return;
    updateMe.mutate(
      { displayName: displayName.trim(), locale },
      { onSuccess: () => toast.show(t.settings.saved) },
    );
  };

  return (
    <SettingsPage title={t.nav.settings} backTo="/">
      {/* profile */}
      {user && (
        <Card className="flex flex-col gap-4 p-5">
          <div className="flex items-center gap-3">
            <UserAvatar name={user.displayName} avatarUrl={user.avatarUrl} size="lg" />
            <div className="min-w-0">
              <p className="font-display text-lg text-ink">{user.displayName}</p>
              <p className="truncate text-sm text-ink-faint">{user.email}</p>
            </div>
          </div>
          <Field label={t.settings.displayName}>
            <TextInput
              value={displayName}
              maxLength={100}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </Field>
          <Field label={t.settings.language}>
            <Select
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
            >
              <option value="system">{t.settings.languageSystem}</option>
              <option value="en">English</option>
              <option value="ja">日本語</option>
            </Select>
          </Field>
          <Button
            size="sm"
            className="self-start"
            disabled={updateMe.isPending || displayName.trim() === ""}
            onClick={saveProfile}
          >
            {t.common.save}
          </Button>
        </Card>
      )}

      {/* calendar preferences */}
      <Card className="flex flex-col gap-4 p-5">
        <h2 className="font-display text-lg text-ink">{t.calendar.settings.title}</h2>
        <label className="flex items-center justify-between gap-3">
          <span className="font-semibold text-ink">
            {t.calendar.settings.weekendColor}
          </span>
          <input
            type="checkbox"
            className="h-5 w-5 accent-clay-500"
            checked={prefs.weekendColor}
            onChange={(e) => setPref("weekendColor", e.target.checked)}
          />
        </label>
        <Field label={t.calendar.settings.startHour}>
          <Select
            value={String(prefs.startHour)}
            onChange={(e) => setPref("startHour", Number(e.target.value))}
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t.calendar.settings.timezone}>
          <Select
            value={prefs.timeZone}
            onChange={(e) => setPref("timeZone", e.target.value)}
          >
            {timeZones.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </Select>
        </Field>
      </Card>

      {/* sections */}
      <Card className="divide-y divide-cream-200 p-0">
        {(
          [
            { to: "/settings/pets", label: t.pets.yourPets },
            { to: "/settings/presets", label: t.settings.presets },
            { to: "/settings/advisor", label: t.advisor.settings.title },
            { to: "/settings/account", label: t.settings.account },
          ] as const
        ).map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="flex items-center justify-between px-4 py-3.5 font-semibold text-ink transition hover:bg-cream-50"
          >
            {item.label}
            <ChevronRightIcon className="h-4 w-4 text-ink-faint" />
          </Link>
        ))}
      </Card>

      {/* notifications */}
      <NotificationsCard />

      {/* data export */}
      <Card className="flex flex-col gap-1 p-2">
        <h2 className="px-2 pt-2 font-display text-lg text-ink">
          {t.settings.exportTitle}
        </h2>
        {(
          [
            { href: myExportUrl(), label: t.settings.exportAll },
            { href: petExportUrl(pet.id, "json"), label: t.settings.exportPetJson(pet.name) },
            { href: petExportUrl(pet.id, "csv"), label: t.settings.exportPetCsv(pet.name) },
          ] as const
        ).map((item) => (
          <a
            key={item.href}
            href={item.href}
            download
            className="flex items-center gap-2.5 rounded-2xl px-2 py-2 font-semibold text-clay-700 transition hover:bg-cream-50"
          >
            <DownloadIcon className="h-4 w-4" />
            {item.label}
          </a>
        ))}
      </Card>

      <Button
        variant="ghost"
        size="sm"
        className="self-start text-ink-faint"
        onClick={() => void logout()}
      >
        {t.logout}
      </Button>
    </SettingsPage>
  );
}
