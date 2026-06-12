import type { InviteRole, PetResponse, Role } from "@pawary/shared";
import { useState } from "react";
import { useNavigate } from "react-router";
import { ROLES } from "@pawary/shared";
import { ApiError } from "../../api/client";
import {
  useCreateInvite,
  useMembers,
  useRemoveMember,
  useRevokeInvite,
  useUpdateMemberRole,
} from "../../api/members";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { Field, Select } from "../../components/form";
import { Spinner } from "../../components/Spinner";
import { useToast } from "../../components/Toast";
import { useLocaleTag, useT } from "../../i18n";

function mutationErrorMessage(
  error: unknown,
  t: ReturnType<typeof useT>,
): string {
  if (error instanceof ApiError && error.code === "last_owner") {
    return t.members.lastOwner;
  }
  return t.errors.title;
}

export function MembersSection({ pet }: { pet: PetResponse }) {
  const t = useT();
  const locale = useLocaleTag();
  const toast = useToast();
  const navigate = useNavigate();
  const members = useMembers(pet.id);
  const createInvite = useCreateInvite(pet.id);
  const revokeInvite = useRevokeInvite(pet.id);
  const updateRole = useUpdateMemberRole(pet.id);
  const removeMember = useRemoveMember(pet.id);
  const [inviteRole, setInviteRole] = useState<InviteRole>("editor");
  // two-tap confirm state: userId armed for removal/leave
  const [armed, setArmed] = useState<string | null>(null);
  // shown when clipboard write fails so the invite link is never lost
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  const isOwner = pet.role === "owner";
  const dateFmt = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  });

  if (members.isLoading) {
    return (
      <Card className="flex justify-center p-5">
        <Spinner />
      </Card>
    );
  }
  if (!members.data) return null;

  const ownerCount = members.data.members.filter(
    (m) => m.role === "owner",
  ).length;
  const me = members.data.members.find((m) => m.isMe);
  const canLeave = !(me?.role === "owner" && ownerCount === 1);

  const onError = (error: unknown) =>
    toast.show(mutationErrorMessage(error, t), { tone: "danger" });

  const share = async (url: string) => {
    setFallbackUrl(null);
    if (navigator.share) {
      try {
        await navigator.share({ text: t.members.shareText(pet.name), url });
        return;
      } catch {
        // user dismissed the sheet — fall through to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.show(t.members.linkCopied);
    } catch {
      // clipboard can reject after the async create (no user activation) —
      // surface the URL so it is never silently lost
      setFallbackUrl(url);
    }
  };

  return (
    <Card className="p-5">
      <h2 className="mb-3 font-display text-lg text-ink">{t.members.title}</h2>

      <ul className="flex flex-col gap-2.5">
        {members.data.members.map((member) => (
          <li key={member.userId} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-ink">
              {member.displayName}
              {member.isMe && (
                <span className="ml-1 text-xs text-ink-faint">
                  {t.members.you}
                </span>
              )}
            </span>
            {isOwner ? (
              // wrapper fixes the width — cn() does not de-duplicate
              // Tailwind classes, so overriding Select's w-full is unreliable
              <div className="w-28 shrink-0">
                <Select
                  value={member.role}
                  aria-label={member.displayName}
                  disabled={updateRole.isPending}
                  className="py-1.5 text-sm"
                  onChange={(e) =>
                    updateRole.mutate(
                      { userId: member.userId, role: e.target.value as Role },
                      { onError },
                    )
                  }
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {t.pets.role[role]}
                    </option>
                  ))}
                </Select>
              </div>
            ) : (
              <span className="rounded-full bg-cream-200 px-2.5 py-0.5 text-xs font-semibold text-ink-soft">
                {t.pets.role[member.role]}
              </span>
            )}
            {isOwner && !member.isMe && (
              <Button
                variant="danger"
                size="sm"
                disabled={removeMember.isPending}
                onClick={() => {
                  if (armed !== member.userId) {
                    setArmed(member.userId);
                    return;
                  }
                  setArmed(null);
                  removeMember.mutate(member.userId, { onError });
                }}
              >
                {armed === member.userId
                  ? t.members.removeConfirm
                  : t.members.remove}
              </Button>
            )}
          </li>
        ))}
      </ul>

      {isOwner && (
        <div className="mt-4 border-t border-cream-200 pt-4">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Field label={t.members.inviteRole}>
                <Select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as InviteRole)}
                >
                  <option value="editor">{t.pets.role.editor}</option>
                  <option value="viewer">{t.pets.role.viewer}</option>
                </Select>
              </Field>
            </div>
            <Button
              variant="soft"
              disabled={createInvite.isPending}
              onClick={() =>
                createInvite.mutate(
                  { role: inviteRole },
                  { onSuccess: (data) => void share(data.url), onError },
                )
              }
            >
              {createInvite.isPending ? <Spinner className="h-4 w-4" /> : null}
              {t.members.inviteCreate}
            </Button>
          </div>

          {fallbackUrl && (
            <input
              readOnly
              value={fallbackUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="mt-2 w-full rounded-2xl border border-cream-300 bg-paper px-3 py-2 text-xs text-ink-soft"
            />
          )}

          {members.data.invites && members.data.invites.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold text-ink-soft">
                {t.members.pendingTitle}
              </h3>
              <ul className="flex flex-col gap-2">
                {members.data.invites.map((invite) => (
                  <li key={invite.id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 text-ink-soft">
                      {t.pets.role[invite.role]} ·{" "}
                      {t.members.expires(dateFmt.format(new Date(invite.expiresAt)))}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={revokeInvite.isPending}
                      onClick={() => revokeInvite.mutate(invite.id, { onError })}
                    >
                      {t.members.revoke}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {me && canLeave && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-4 self-start text-berry-600"
          disabled={removeMember.isPending}
          onClick={() => {
            if (armed !== me.userId) {
              setArmed(me.userId);
              return;
            }
            setArmed(null);
            removeMember.mutate(me.userId, {
              onSuccess: () => navigate("/settings/pets"),
              onError,
            });
          }}
        >
          {armed === me.userId ? t.members.leaveConfirm : t.members.leave}
        </Button>
      )}
    </Card>
  );
}
