import type { MeResponse } from "@pawlog/shared";
import { useLogout } from "../api/me";
import { useT } from "../i18n";

export function Shell({ me }: { me: MeResponse }) {
  const t = useT();
  const logout = useLogout();

  return (
    <div className="min-h-dvh bg-warm-50">
      <header className="flex items-center justify-between border-b border-warm-100 bg-white px-4 py-3">
        <h1 className="font-bold text-warm-900">🐾 {t.appName}</h1>
        <div className="flex items-center gap-3">
          {me.user.avatarUrl && (
            <img
              src={me.user.avatarUrl}
              alt=""
              className="h-8 w-8 rounded-full"
            />
          )}
          <button
            type="button"
            onClick={logout}
            className="text-sm text-warm-600 underline"
          >
            {t.logout}
          </button>
        </div>
      </header>
      <main className="p-6">
        <p className="text-lg text-warm-900">{t.greeting(me.user.displayName)}</p>
        <p className="mt-2 text-warm-900/60">{t.comingSoon}</p>
      </main>
    </div>
  );
}
