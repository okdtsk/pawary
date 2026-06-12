import { useNavigate, useParams } from "react-router";
import { ApiError } from "../api/client";
import { useAcceptInvite, useInvitePreview } from "../api/members";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { PawIcon } from "../components/icons";
import { Spinner } from "../components/Spinner";
import { useToast } from "../components/Toast";
import { useT } from "../i18n";

export function JoinInvite() {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const { token } = useParams<{ token: string }>();
  const preview = useInvitePreview(token ?? "");
  const accept = useAcceptInvite();

  const invalid =
    token === undefined ||
    (preview.error instanceof ApiError && preview.error.status === 404);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-cream-100 p-6">
      <Card className="flex w-full max-w-sm flex-col items-center gap-4 p-6 text-center">
        <PawIcon className="h-12 w-12 text-clay-400" />
        {preview.isLoading ? (
          <Spinner />
        ) : invalid || !preview.data ? (
          <>
            <h1 className="font-display text-xl text-ink">
              {t.members.invalidTitle}
            </h1>
            <p className="text-sm text-ink-soft">{t.members.invalidBody}</p>
            <Button variant="soft" onClick={() => navigate("/")}>
              {t.members.goHome}
            </Button>
          </>
        ) : (
          <>
            <h1 className="font-display text-xl text-ink">
              {t.members.joinTitle}
            </h1>
            <p className="text-ink-soft">
              {t.members.joinPrompt(preview.data.petName, preview.data.inviterName)}
            </p>
            <p className="text-sm text-ink-faint">
              {t.members.joinAs(t.pets.role[preview.data.role])}
            </p>
            <div className="flex w-full flex-col gap-2">
              <Button
                disabled={accept.isPending}
                onClick={() =>
                  // token is defined here: the invalid branch handled undefined
                  accept.mutate(token!, {
                    onSuccess: (data) => {
                      toast.show(
                        data.alreadyMember
                          ? t.members.alreadyMember
                          : t.members.joined,
                      );
                      navigate("/", { replace: true });
                    },
                    onError: (error) =>
                      toast.show(
                        error instanceof ApiError && error.status === 404
                          ? t.members.invalidBody
                          : t.errors.title,
                        { tone: "danger" },
                      ),
                  })
                }
              >
                {accept.isPending ? <Spinner className="h-4 w-4 text-white" /> : null}
                {t.members.accept}
              </Button>
              <Button variant="ghost" onClick={() => navigate("/", { replace: true })}>
                {t.members.decline}
              </Button>
            </div>
          </>
        )}
      </Card>
    </main>
  );
}
