import type { ScheduleResponse } from "@pawlog/shared";
import { useDeleteActivity } from "../../api/activities";
import { useCompleteSchedule, useUpdateSchedule } from "../../api/schedules";
import { useToast } from "../../components/Toast";
import { useT } from "../../i18n";
import { deviceTzOffsetMin } from "../../lib/dates";

/**
 * Complete + undo, used by both the Health tab and the Home care card.
 * Undo is exactly (locked decision): soft-DELETE the activity the completion
 * created, then PATCH the schedule's nextDueAt/active back to the values it
 * had BEFORE completing — both captured from the schedule row we already had.
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
                removeActivity.mutate(res.activity.id);
                updateSchedule.mutate(
                  {
                    id: schedule.id,
                    input: { nextDueAt: schedule.nextDueAt, active: schedule.active },
                  },
                  { onSuccess: () => toast.show(t.care.undone) },
                );
              },
            },
          });
        },
        onError: () => toast.show(t.errors.title, { tone: "danger" }),
      },
    );
  };
  return { complete, isPending: completeMut.isPending };
}
