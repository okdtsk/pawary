import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from "react-router";
import { ApiError } from "./api/client";
import { useMe } from "./api/me";
import { ErrorScreen } from "./components/ErrorScreen";
import { PawIcon } from "./components/icons";
import { I18nProvider } from "./i18n";
import { UpdatePrompt } from "./features/pwa/UpdatePrompt";
import { ActivityDetail } from "./routes/ActivityDetail";
import { Advisor } from "./routes/Advisor";
import { CalendarTab } from "./routes/CalendarTab";
import { HealthTab } from "./routes/HealthTab";
import { Home } from "./routes/Home";
import { JoinInvite } from "./routes/JoinInvite";
import { Login } from "./routes/Login";
import { LogTab } from "./routes/LogTab";
import { Shell } from "./routes/Shell";
import { AccountSettings } from "./routes/settings/AccountSettings";
import { AdvisorSettings } from "./routes/settings/AdvisorSettings";
import { AuditHistory } from "./routes/settings/AuditHistory";
import { PetEditor } from "./routes/settings/PetEditor";
import { PetsSettings } from "./routes/settings/PetsSettings";
import { PresetsSettings } from "./routes/settings/PresetsSettings";
import { SettingsHome } from "./routes/settings/SettingsHome";
import { PetProvider } from "./state/pets";
import {
  pendingInviteFromPath,
  savePendingInvite,
  takePendingInvite,
} from "./lib/pendingInvite";

/** Logged-out visit to /join/<token>: stash the token before showing Login. */
function LoginCapturingInvite() {
  const token = pendingInviteFromPath(window.location.pathname);
  if (token) savePendingInvite(token);
  return <Login />;
}

/** After login the OAuth callback lands on "/" — replay a stashed join. */
function PendingInviteRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    const token = takePendingInvite();
    if (token) navigate(`/join/${token}`, { replace: true });
  }, [navigate]);
  return null;
}

function Splash() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-cream-100">
      <PawIcon className="animate-paw h-14 w-14 text-clay-400" />
    </main>
  );
}

export function App() {
  const me = useMe();
  const locale = me.data?.user.locale;
  return (
    <I18nProvider locale={locale}>
      <UpdatePrompt />
      {me.isLoading ? (
        <Splash />
      ) : me.error instanceof ApiError && me.error.status === 401 ? (
        <LoginCapturingInvite />
      ) : me.error ? (
        <ErrorScreen onRetry={() => void me.refetch()} />
      ) : me.data ? (
        <PetProvider me={me.data}>
          <BrowserRouter>
            <PendingInviteRedirect />
            <Routes>
              <Route path="/join/:token" element={<JoinInvite />} />
              <Route element={<Shell />}>
                <Route path="/" element={<Home />} />
                <Route path="/calendar" element={<CalendarTab />} />
                <Route path="/log" element={<LogTab />} />
                <Route path="/health" element={<HealthTab />} />
                <Route path="/settings" element={<SettingsHome />} />
                <Route path="/settings/presets" element={<PresetsSettings />} />
                <Route path="/advisor" element={<Advisor />} />
                <Route path="/settings/advisor" element={<AdvisorSettings />} />
                <Route path="/settings/account" element={<AccountSettings />} />
                <Route path="/settings/pets" element={<PetsSettings />} />
                <Route path="/settings/pets/new" element={<PetEditor />} />
                <Route path="/settings/pets/:petId" element={<PetEditor />} />
                <Route path="/settings/pets/:petId/audit" element={<AuditHistory />} />
                <Route
                  path="/pets/:petId/activities/:id"
                  element={<ActivityDetail />}
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </PetProvider>
      ) : (
        <LoginCapturingInvite />
      )}
    </I18nProvider>
  );
}
