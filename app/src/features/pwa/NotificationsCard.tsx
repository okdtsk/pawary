import { useEffect, useState } from "react";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { Spinner } from "../../components/Spinner";
import { useToast } from "../../components/Toast";
import { useT } from "../../i18n";
import { householdTzOffsetMin } from "../../lib/calendarPrefs";
import {
  disablePush,
  enablePush,
  getCurrentSubscription,
  isPushSupported,
} from "../../lib/pushClient";

type Status =
  | "loading"
  | "unsupported"
  | "ios-hint"
  | "disabled"
  | "denied"
  | "enabled";

function isIos(): boolean {
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))
  );
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches;
}

export function NotificationsCard() {
  const t = useT();
  const toast = useToast();
  const [status, setStatus] = useState<Status>("loading");
  const [actionPending, setActionPending] = useState(false);

  useEffect(() => {
    if (!isPushSupported()) {
      setStatus("unsupported");
      return;
    }
    if (isIos() && !isStandalone()) {
      setStatus("ios-hint");
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }
    getCurrentSubscription()
      .then((sub) => {
        setStatus(sub ? "enabled" : "disabled");
      })
      .catch(() => {
        setStatus("disabled");
      });
  }, []);

  const handleEnable = async () => {
    setActionPending(true);
    const result = await enablePush(householdTzOffsetMin());
    setActionPending(false);
    if (result.ok) {
      setStatus("enabled");
    } else if (result.reason === "denied") {
      setStatus("denied");
    } else {
      toast.show(t.push.error);
    }
  };

  const handleDisable = async () => {
    setActionPending(true);
    const result = await disablePush();
    setActionPending(false);
    if (result.ok) {
      setStatus("disabled");
    } else {
      toast.show(t.push.error);
    }
  };

  return (
    <Card className="flex flex-col gap-3 p-5">
      <h2 className="font-display text-lg text-ink">{t.push.title}</h2>

      {status === "loading" && (
        <div className="flex items-center gap-2 text-sm text-ink-faint">
          <Spinner className="h-4 w-4" />
        </div>
      )}

      {status === "unsupported" && (
        <p className="text-sm text-ink-faint">{t.push.unsupported}</p>
      )}

      {status === "ios-hint" && (
        <p className="text-sm text-ink-faint">{t.push.iosInstallHint}</p>
      )}

      {status === "denied" && (
        <p className="text-sm text-ink-faint">{t.push.denied}</p>
      )}

      {status === "disabled" && (
        <Button
          size="sm"
          className="self-start"
          disabled={actionPending}
          onClick={() => void handleEnable()}
        >
          {actionPending ? <Spinner className="h-4 w-4 text-white" /> : null}
          {t.push.enable}
        </Button>
      )}

      {status === "enabled" && (
        <>
          <p className="text-sm text-ink-faint">{t.push.enabledStatus}</p>
          <Button
            variant="soft"
            size="sm"
            className="self-start"
            disabled={actionPending}
            onClick={() => void handleDisable()}
          >
            {actionPending ? <Spinner className="h-4 w-4" /> : null}
            {t.push.disable}
          </Button>
        </>
      )}
    </Card>
  );
}
