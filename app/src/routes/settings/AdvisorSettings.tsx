import type { AiProvider } from "@pawary/shared";
import { AI_DEFAULT_MODELS, AI_PROVIDERS } from "@pawary/shared";
import { useState } from "react";
import {
  useAdvisorSettings,
  useDeleteAdvisorSettings,
  useSaveAdvisorSettings,
} from "../../api/advisor";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { Field, Select, TextInput } from "../../components/form";
import { Spinner } from "../../components/Spinner";
import { useToast } from "../../components/Toast";
import { useT } from "../../i18n";
import { SettingsPage } from "./SettingsPage";

const PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: "Claude (Anthropic)",
  openai: "OpenAI",
  gemini: "Gemini (Google)",
};

function AdvisorForm({
  saved,
}: {
  saved: { provider: AiProvider; model: string } | null;
}) {
  const t = useT();
  const toast = useToast();
  const saveSettings = useSaveAdvisorSettings();
  const deleteSettings = useDeleteAdvisorSettings();

  const [provider, setProvider] = useState<AiProvider>(
    saved?.provider ?? AI_PROVIDERS[0],
  );
  const [model, setModel] = useState<string>(
    saved?.model ?? AI_DEFAULT_MODELS[saved?.provider ?? AI_PROVIDERS[0]],
  );
  const [modelTouched, setModelTouched] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [removeArmed, setRemoveArmed] = useState(false);

  const onProviderChange = (newProvider: AiProvider) => {
    setProvider(newProvider);
    if (!modelTouched) {
      setModel(AI_DEFAULT_MODELS[newProvider]);
    }
  };

  const onModelChange = (value: string) => {
    setModel(value);
    setModelTouched(true);
  };

  const onSave = () => {
    saveSettings.mutate(
      { provider, model, apiKey },
      {
        onSuccess: () => {
          toast.show(t.advisor.settings.saved);
          setApiKey("");
          setRemoveArmed(false);
        },
        onError: () => toast.show(t.errors.title, { tone: "danger" }),
      },
    );
  };

  const onRemove = () => {
    if (!removeArmed) {
      setRemoveArmed(true);
      return;
    }
    setRemoveArmed(false);
    deleteSettings.mutate(undefined, {
      onSuccess: () => {
        setProvider(AI_PROVIDERS[0]);
        setModel(AI_DEFAULT_MODELS[AI_PROVIDERS[0]]);
        setModelTouched(false);
        setApiKey("");
      },
      onError: () => toast.show(t.errors.title, { tone: "danger" }),
    });
  };

  const saveDisabled =
    saveSettings.isPending || deleteSettings.isPending || apiKey.trim() === "";

  return (
    <SettingsPage title={t.advisor.settings.title} backTo="/settings">
      <Card className="flex flex-col gap-4 p-5">
        <p className="text-sm text-ink-soft">{t.advisor.settings.intro}</p>

        <Field label={t.advisor.settings.provider}>
          <Select
            value={provider}
            onChange={(e) => onProviderChange(e.target.value as AiProvider)}
          >
            {AI_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABELS[p]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t.advisor.settings.model}>
          <TextInput
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
          />
        </Field>

        <Field
          label={t.advisor.settings.apiKey}
          hint={
            saved != null
              ? t.advisor.settings.apiKeyConfigured
              : t.advisor.settings.apiKeyHint
          }
        >
          <TextInput
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </Field>

        <Button disabled={saveDisabled} onClick={onSave}>
          {saveSettings.isPending ? <Spinner className="h-4 w-4" /> : null}
          {t.common.save}
        </Button>
      </Card>

      {saved != null && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start text-berry-600"
          disabled={deleteSettings.isPending || saveSettings.isPending}
          onClick={onRemove}
        >
          {removeArmed
            ? t.advisor.settings.removeConfirm
            : t.advisor.settings.remove}
        </Button>
      )}
    </SettingsPage>
  );
}

export function AdvisorSettings() {
  const settingsQuery = useAdvisorSettings();

  if (settingsQuery.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  return <AdvisorForm saved={settingsQuery.data?.settings ?? null} />;
}
