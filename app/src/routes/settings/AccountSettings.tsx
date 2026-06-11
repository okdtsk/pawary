import { useState } from "react";
import { useDeleteAccount, useLogout, useMe } from "../../api/me";
import { ApiError } from "../../api/client";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { Field, TextInput } from "../../components/form";
import { useToast } from "../../components/Toast";
import { useT } from "../../i18n";
import { SettingsPage } from "./SettingsPage";

export function AccountSettings() {
  const t = useT();
  const toast = useToast();
  const me = useMe();
  const logout = useLogout();
  const deleteAccount = useDeleteAccount();
  const [confirmEmail, setConfirmEmail] = useState("");
  const email = me.data?.user.email ?? "";
  const armed = confirmEmail === email && email !== "";

  const onDelete = () =>
    deleteAccount.mutate(confirmEmail, {
      onSuccess: () => {
        localStorage.removeItem("pawlog:selectedPetId");
        window.location.assign("/");
      },
      onError: (error) =>
        toast.show(
          error instanceof ApiError ? error.message : t.errors.title,
          { tone: "danger" },
        ),
    });

  return (
    <SettingsPage title={t.settings.account} backTo="/settings">
      <Card className="flex items-center justify-between gap-3 p-5">
        <div className="min-w-0">
          <p className="text-sm text-ink-faint">{t.settings.signedInAs}</p>
          <p className="truncate font-semibold text-ink">{email}</p>
        </div>
        <Button variant="soft" size="sm" onClick={() => void logout()}>
          {t.logout}
        </Button>
      </Card>

      <Card className="border border-berry-100 p-5">
        <h2 className="mb-1 font-display text-lg text-berry-700">
          {t.settings.dangerTitle}
        </h2>
        <p className="mb-4 text-sm text-ink-soft">{t.settings.dangerBody}</p>
        <Field label={t.settings.confirmEmailLabel(email)}>
          <TextInput
            value={confirmEmail}
            autoComplete="off"
            onChange={(e) => setConfirmEmail(e.target.value)}
          />
        </Field>
        <Button
          variant="danger"
          className="mt-4"
          disabled={!armed || deleteAccount.isPending}
          onClick={onDelete}
        >
          {t.settings.deleteAccount}
        </Button>
      </Card>
    </SettingsPage>
  );
}
