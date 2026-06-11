import { useEffect, useRef } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { useToast } from "../../components/Toast";
import { useT } from "../../i18n";

/**
 * Registers the service worker (registerType: "prompt") and shows a one-shot
 * "new version is ready" toast with a Reload action. In `vite dev` the
 * virtual module no-ops (devOptions are not enabled), so this renders inert.
 */
export function UpdatePrompt() {
  const t = useT();
  const toast = useToast();
  const announced = useRef(false);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  useEffect(() => {
    if (!needRefresh || announced.current) return;
    announced.current = true;
    toast.show(t.pwa.updateReady, {
      action: {
        label: t.pwa.reload,
        onClick: () => void updateServiceWorker(true),
      },
    });
  }, [needRefresh, t, toast, updateServiceWorker]);

  return null;
}
