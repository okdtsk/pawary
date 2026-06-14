import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { Button } from "../components/Button";
import { PawIcon } from "../components/icons";
import { useT } from "../i18n";

export function Login() {
  const t = useT();
  const qc = useQueryClient();
  const authError = new URLSearchParams(window.location.search).get(
    "auth_error",
  );
  const testLoginEnabled =
    import.meta.env.DEV || __APP_ENVIRONMENT__ === "preview";
  const needsSecret = !import.meta.env.DEV;
  const [testEmail, setTestEmail] = useState("");
  const [testSecret, setTestSecret] = useState(() =>
    needsSecret ? localStorage.getItem("previewLoginSecret") ?? "" : "",
  );

  const testLogin = async () => {
    if (needsSecret) localStorage.setItem("previewLoginSecret", testSecret);
    await api("/api/auth/dev-login", {
      method: "POST",
      body: JSON.stringify(
        needsSecret
          ? { email: testEmail, secret: testSecret }
          : { email: testEmail },
      ),
    });
    await qc.invalidateQueries({ queryKey: ["me"] });
  };

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-cream-100 p-6">
      {/* atmosphere */}
      <div
        aria-hidden="true"
        className="blob absolute -left-24 -top-20 h-72 w-72 bg-clay-100"
      />
      <div
        aria-hidden="true"
        className="blob absolute -bottom-24 -right-20 h-80 w-80 bg-cat-water-soft"
      />
      <PawIcon
        aria-hidden="true"
        className="absolute left-10 top-1/3 h-10 w-10 -rotate-12 text-cream-200"
      />
      <PawIcon
        aria-hidden="true"
        className="absolute bottom-1/4 right-12 h-14 w-14 rotate-[24deg] text-cream-200"
      />

      <div className="relative flex w-full max-w-sm flex-col items-center gap-5 text-center">
        <span className="animate-pop blob flex h-24 w-24 items-center justify-center bg-clay-500 text-white shadow-float">
          <PawIcon className="h-12 w-12" />
        </span>
        <h1
          className="animate-pop text-5xl text-clay-800"
          style={{ animationDelay: "80ms" }}
        >
          {t.appName}
        </h1>
        <p
          className="animate-pop text-ink-soft"
          style={{ animationDelay: "140ms" }}
        >
          {t.tagline}
        </p>

        {authError && (
          <p
            role="alert"
            className="animate-pop w-full rounded-card bg-berry-100 px-4 py-3 text-sm font-semibold text-berry-700"
          >
            {t.login.authError}
          </p>
        )}

        <a
          href="/api/auth/google"
          className="animate-pop shadow-card inline-flex w-full items-center justify-center gap-2 rounded-full bg-clay-500 px-7 py-3.5 text-lg font-semibold text-white transition hover:bg-clay-600 active:scale-[0.98]"
          style={{ animationDelay: "200ms" }}
        >
          {t.signInWithGoogle}
        </a>
        {testLoginEnabled && (
          <div
            className="animate-pop flex w-full flex-col gap-2"
            style={{ animationDelay: "260ms" }}
          >
            <input
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder={t.login.testEmailPlaceholder}
              className="w-full rounded-full border border-cream-200 bg-white px-5 py-2.5 text-sm text-ink-soft outline-none focus:border-clay-400"
            />
            {needsSecret && (
              <input
                type="password"
                value={testSecret}
                onChange={(e) => setTestSecret(e.target.value)}
                placeholder={t.login.testSecretPlaceholder}
                className="w-full rounded-full border border-cream-200 bg-white px-5 py-2.5 text-sm text-ink-soft outline-none focus:border-clay-400"
              />
            )}
            <Button variant="ghost" size="sm" onClick={testLogin}>
              {t.login.testSubmit}
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}
