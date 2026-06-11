import { ApiError } from "./api/client";
import { useMe } from "./api/me";
import { I18nProvider, useT } from "./i18n";
import { Login } from "./routes/Login";
import { Shell } from "./routes/Shell";

function Loading() {
  const t = useT();
  return (
    <main className="flex min-h-dvh items-center justify-center bg-warm-50">
      <p className="text-warm-900/60">{t.loading}</p>
    </main>
  );
}

export function App() {
  const me = useMe();

  const locale = me.data?.user.locale;
  return (
    <I18nProvider locale={locale}>
      {me.isLoading ? (
        <Loading />
      ) : me.error instanceof ApiError && me.error.status === 401 ? (
        <Login />
      ) : me.data ? (
        <Shell me={me.data} />
      ) : (
        <Login />
      )}
    </I18nProvider>
  );
}
