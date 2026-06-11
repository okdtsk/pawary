import { EmptyState } from "../components/EmptyState";
import { useT } from "../i18n";

export function LogTab() {
  const t = useT();
  return <EmptyState title={t.nav.log} />;
}
