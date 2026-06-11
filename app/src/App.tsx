import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { ApiError } from "./api/client";
import { useMe } from "./api/me";
import { ErrorScreen } from "./components/ErrorScreen";
import { PawIcon } from "./components/icons";
import { I18nProvider } from "./i18n";
import { CalendarTab } from "./routes/CalendarTab";
import { HealthTab } from "./routes/HealthTab";
import { Home } from "./routes/Home";
import { Login } from "./routes/Login";
import { LogTab } from "./routes/LogTab";
import { Shell } from "./routes/Shell";
import { PetEditor } from "./routes/settings/PetEditor";
import { PetsSettings } from "./routes/settings/PetsSettings";
import { PetProvider } from "./state/pets";

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
      {me.isLoading ? (
        <Splash />
      ) : me.error instanceof ApiError && me.error.status === 401 ? (
        <Login />
      ) : me.error ? (
        <ErrorScreen onRetry={() => void me.refetch()} />
      ) : me.data ? (
        <PetProvider me={me.data}>
          <BrowserRouter>
            <Routes>
              <Route element={<Shell />}>
                <Route path="/" element={<Home />} />
                <Route path="/calendar" element={<CalendarTab />} />
                <Route path="/log" element={<LogTab />} />
                <Route path="/health" element={<HealthTab />} />
                <Route path="/settings/pets" element={<PetsSettings />} />
                <Route path="/settings/pets/new" element={<PetEditor />} />
                <Route path="/settings/pets/:petId" element={<PetEditor />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </PetProvider>
      ) : (
        <Login />
      )}
    </I18nProvider>
  );
}
