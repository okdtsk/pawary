import { useState } from "react";
import { Card } from "../../components/Card";
import { IconButton } from "../../components/IconButton";
import { ShareIcon, XIcon } from "../../components/icons";
import { useT } from "../../i18n";

const DISMISS_KEY = "pawlog:iosInstallHint";

function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  // iPadOS ≥13 reports as Macintosh but exposes multi-touch
  const isIos =
    /iPhone|iPad|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  // Chrome/Firefox/Edge on iOS embed Safari's engine but hide the share-sheet
  // entry point we describe, so only true Safari gets the hint.
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|Chrome/.test(ua);
  return isIos && isSafari;
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Spec §8: custom install hint — iOS Safari has no install-prompt API. */
export function InstallHint() {
  const t = useT();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) !== null;
    } catch {
      return true; // storage unavailable: do not nag every render
    }
  });

  if (dismissed || !isIosSafari() || isStandalone()) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // private mode: hide for this session only
    }
    setDismissed(true);
  };

  return (
    <Card className="animate-pop flex items-start gap-3" data-slot="ios-install-hint">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-clay-100 text-clay-600">
        <ShareIcon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-display text-ink">{t.pwa.iosInstallTitle}</p>
        <p className="text-sm text-ink-soft">{t.pwa.iosInstallBody}</p>
      </div>
      <IconButton label={t.common.close} onClick={dismiss}>
        <XIcon className="h-4 w-4" />
      </IconButton>
    </Card>
  );
}
