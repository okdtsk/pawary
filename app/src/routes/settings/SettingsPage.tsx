import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { IconButton } from "../../components/IconButton";
import { ArrowLeftIcon } from "../../components/icons";
import { useT } from "../../i18n";

export function SettingsPage({
  title,
  backTo,
  children,
}: {
  title: string;
  backTo: string;
  children: ReactNode;
}) {
  const t = useT();
  const navigate = useNavigate();
  return (
    <div className="animate-pop flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <IconButton label={t.common.back} onClick={() => navigate(backTo)}>
          <ArrowLeftIcon className="h-5 w-5" />
        </IconButton>
        <h1 className="text-2xl text-ink">{title}</h1>
      </div>
      {children}
    </div>
  );
}
