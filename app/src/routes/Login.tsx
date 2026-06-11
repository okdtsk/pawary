import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useT } from "../i18n";

export function Login() {
  const t = useT();
  const qc = useQueryClient();

  const devLogin = async () => {
    await api("/api/auth/dev-login", {
      method: "POST",
      body: JSON.stringify({}),
    });
    await qc.invalidateQueries({ queryKey: ["me"] });
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-warm-50 p-6">
      <div className="text-6xl">🐾</div>
      <h1 className="text-3xl font-bold text-warm-900">{t.appName}</h1>
      <p className="text-warm-900/70">{t.tagline}</p>
      <a
        href="/api/auth/google"
        className="rounded-full bg-warm-500 px-6 py-3 font-semibold text-white shadow hover:bg-warm-600"
      >
        {t.signInWithGoogle}
      </a>
      {import.meta.env.DEV && (
        <button
          type="button"
          onClick={devLogin}
          className="text-sm text-warm-600 underline"
        >
          {t.signInDev}
        </button>
      )}
    </main>
  );
}
