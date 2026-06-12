import type { ScheduleResponse } from "@pawary/shared";
import { useDeleteActivity } from "../../api/activities";
import { useCompleteSchedule, useUpdateSchedule } from "../../api/schedules";
import { useToast } from "../../components/Toast";
import { useT } from "../../i18n";
import { deviceTzOffsetMin } from "../../lib/dates";
import { friendlyError } from "../../lib/errors";

/**
 * Complete + undo, used by both the Health tab and the Home care card.
 * Undo is exactly (locked decision, Plan 4): soft-DELETE the activity the
 * completion created, THEN PATCH the schedule's nextDueAt/active back to the
 * values it had before completing — sequenced, so a failed delete never
 * resets the schedule while the logged activity survives.
 */
export function useCompleteWithUndo(petId: string): {
  complete: (schedule: ScheduleResponse) => void;
  isPending: boolean;
} {
  const t = useT();
  const toast = useToast();
  const completeMut = useCompleteSchedule(petId);
  const removeActivity = useDeleteActivity(petId);
  const updateSchedule = useUpdateSchedule(petId);

  const complete = (schedule: ScheduleResponse) => {
    completeMut.mutate(
      { id: schedule.id, input: { tzOffsetMin: deviceTzOffsetMin() } },
      {
        onSuccess: (res) => {
          toast.show(t.care.completed(schedule.name), {
            action: {
              label: t.care.undo,
              onClick: () => {
                void (async () => {
                  try {
                    await removeActivity.mutateAsync(res.activity.id);
                    await updateSchedule.mutateAsync({
                      id: schedule.id,
                      input: {
                        nextDueAt: schedule.nextDueAt,
                        active: schedule.active,
                      },
                    });
                    toast.show(t.care.undone);
                  } catch (error) {
                    toast.show(friendlyError(error, t), { tone: "danger" });
                  }
                })();
              },
            },
          });
        },
        onError: (error) =>
          toast.show(friendlyError(error, t), { tone: "danger" }),
      },
    );
  };
  return { complete, isPending: completeMut.isPending };
}
