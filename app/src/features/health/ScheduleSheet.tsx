import type {
  Category,
  CreateScheduleInput,
  RecurrenceUnit,
  ScheduleResponse,
  ScheduleType,
} from "@pawary/shared";
import { CATEGORIES, RECURRENCE_UNITS, SCHEDULE_TYPES, createScheduleSchema } from "@pawary/shared";
import { useEffect, useState } from "react";
import { useCreateSchedule, useDeleteSchedule, useUpdateSchedule } from "../../api/schedules";
import { Button } from "../../components/Button";
import { DateInput, DateTimeInput, Field, NumberInput, Select, TextInput } from "../../components/form";
import { Sheet } from "../../components/Sheet";
import { useToast } from "../../components/Toast";
import { useT } from "../../i18n";
import type { Messages } from "../../i18n/messages";
import { buildDetails, initialValues, type FormValues } from "../add/categoryFields";
import { DetailsFields } from "../add/DetailsFields";

const DEFAULT_CATEGORY: Record<ScheduleType, Category> = {
  medication: "medication",
  vaccination: "vaccination",
  vet_visit: "vet_visit",
  deworming: "medication",
  grooming: "grooming",
  custom: "note",
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** "YYYY-MM-DD" → inclusive end of that device-local day, epoch ms. */
function endOfLocalDayMs(isoDate: string): number {
  const y = Number(isoDate.slice(0, 4));
  const m = Number(isoDate.slice(5, 7));
  const d = Number(isoDate.slice(8, 10));
  return new Date(y, m - 1, d + 1).getTime() - 1;
}

function msToLocalIsoDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function recurrenceOptionLabel(unit: RecurrenceUnit, n: number, t: Messages): string {
  switch (unit) {
    case "once":
      return t.care.recurrence.once;
    case "hour":
      return t.care.recurrence.hours(n);
    case "day":
      return t.care.recurrence.days(n);
    case "week":
      return t.care.recurrence.weeks(n);
    case "month":
      return t.care.recurrence.months(n);
  }
}

export function ScheduleSheet({
  petId,
  open,
  onClose,
  schedule,
}: {
  petId: string;
  open: boolean;
  onClose: () => void;
  /** present = edit mode (type + categoryLink are immutable server-side) */
  schedule?: ScheduleResponse;
}) {
  const t = useT();
  const toast = useToast();
  const create = useCreateSchedule(petId);
  const update = useUpdateSchedule(petId);
  const remove = useDeleteSchedule(petId);

  const [type, setType] = useState<ScheduleType>("medication");
  const [name, setName] = useState("");
  const [categoryLink, setCategoryLink] = useState<Category>("medication");
  const [details, setDetails] = useState<FormValues>(() => initialValues("medication"));
  const [unit, setUnit] = useState<RecurrenceUnit>("day");
  const [n, setN] = useState("1");
  const [firstDueMs, setFirstDueMs] = useState(() => Date.now());
  const [endDate, setEndDate] = useState(""); // "" = no end
  const [error, setError] = useState<string | null>(null);
  const [armDelete, setArmDelete] = useState(false);

  // (re)seed the form whenever the sheet opens
  useEffect(() => {
    if (!open) return;
    setError(null);
    setArmDelete(false);
    if (schedule) {
      setType(schedule.type);
      setName(schedule.name);
      setCategoryLink(schedule.categoryLink);
      setDetails(initialValues(schedule.categoryLink, schedule.detailsTemplate));
      setUnit(schedule.recurrenceUnit);
      setN(String(schedule.recurrenceN ?? 1));
      setFirstDueMs(schedule.nextDueAt);
      setEndDate(schedule.endAt === null ? "" : msToLocalIsoDate(schedule.endAt));
    } else {
      setType("medication");
      setName("");
      setCategoryLink("medication");
      setDetails(initialValues("medication"));
      setUnit("day");
      setN("1");
      setFirstDueMs(Date.now());
      setEndDate("");
    }
  }, [open, schedule]);

  const pickType = (next: ScheduleType) => {
    setType(next);
    if (!schedule) {
      const cat = DEFAULT_CATEGORY[next];
      setCategoryLink(cat);
      setDetails(initialValues(cat));
    }
  };
  const pickCategory = (next: Category) => {
    setCategoryLink(next);
    setDetails(initialValues(next));
  };

  const submit = () => {
    const built = buildDetails(categoryLink, details, t);
    if ("error" in built) {
      setError(built.error);
      return;
    }
    const candidate: CreateScheduleInput = {
      type,
      name: name.trim(),
      categoryLink,
      detailsTemplate: built.details,
      recurrenceUnit: unit,
      ...(unit !== "once" ? { recurrenceN: Number(n) || 0 } : {}),
      nextDueAt: firstDueMs,
      ...(endDate !== "" ? { endAt: endOfLocalDayMs(endDate) } : {}),
    };
    // same Zod the server runs — friendly per-field messages first
    const parsed = createScheduleSchema.safeParse(candidate);
    if (!parsed.success) {
      const path = parsed.error.issues[0]?.path[0];
      setError(
        path === "name"
          ? t.care.nameRequired
          : path === "recurrenceN"
            ? t.care.invalidN
            : path === "endAt"
              ? t.care.invalidEnd
              : (parsed.error.issues[0]?.message ?? t.add.detailsInvalid),
      );
      return;
    }
    if (schedule) {
      update.mutate(
        {
          id: schedule.id,
          input: {
            name: candidate.name,
            detailsTemplate: candidate.detailsTemplate,
            recurrenceUnit: candidate.recurrenceUnit,
            recurrenceN: unit === "once" ? null : (candidate.recurrenceN ?? 1),
            nextDueAt: candidate.nextDueAt,
            endAt: endDate === "" ? null : candidate.endAt!,
          },
        },
        {
          onSuccess: () => {
            toast.show(t.care.saved);
            onClose();
          },
          onError: () => toast.show(t.errors.title, { tone: "danger" }),
        },
      );
    } else {
      create.mutate(parsed.data, {
        onSuccess: () => {
          toast.show(t.care.created);
          onClose();
        },
        onError: () => toast.show(t.errors.title, { tone: "danger" }),
      });
    }
  };

  const destroy = () => {
    if (!schedule) return;
    if (!armDelete) {
      setArmDelete(true); // two-tap confirm
      return;
    }
    remove.mutate(schedule.id, {
      onSuccess: () => {
        toast.show(t.detail.deleted);
        onClose();
      },
      onError: () => toast.show(t.errors.title, { tone: "danger" }),
    });
  };

  return (
    <Sheet open={open} onClose={onClose} title={schedule ? t.care.editSchedule : t.care.addSchedule}>
      <div className="flex flex-col gap-4 pb-2">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t.care.typeLabel}>
            <Select value={type} disabled={!!schedule} onChange={(e) => pickType(e.target.value as ScheduleType)}>
              {SCHEDULE_TYPES.map((s) => (
                <option key={s} value={s}>
                  {t.care.types[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t.care.categoryLabel}>
            <Select value={categoryLink} disabled={!!schedule} onChange={(e) => pickCategory(e.target.value as Category)}>
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {t.categories[cat]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t.care.nameLabel}>
          <TextInput value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
        </Field>
        <DetailsFields category={categoryLink} values={details} onChange={setDetails} />
        <div className="grid grid-cols-2 gap-3">
          <Field label={t.care.repeatLabel}>
            <Select value={unit} onChange={(e) => setUnit(e.target.value as RecurrenceUnit)}>
              {RECURRENCE_UNITS.map((u) => (
                <option key={u} value={u}>
                  {recurrenceOptionLabel(u, Number(n) || 1, t)}
                </option>
              ))}
            </Select>
          </Field>
          {unit !== "once" && (
            <Field label={t.care.everyLabel}>
              <NumberInput value={n} min={1} step={1} onChange={(e) => setN(e.target.value)} />
            </Field>
          )}
        </div>
        <Field label={t.care.firstDueLabel}>
          <DateTimeInput valueMs={firstDueMs} onChangeMs={setFirstDueMs} />
        </Field>
        <Field label={`${t.care.endLabel} (${t.common.optional})`} hint={t.care.endHint}>
          <DateInput value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
        {error && (
          <p role="alert" className="text-sm font-semibold text-berry-600">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button className="flex-1" disabled={create.isPending || update.isPending} onClick={submit}>
            {t.common.save}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t.common.cancel}
          </Button>
        </div>
        {schedule && (
          <Button variant="danger" size="sm" disabled={remove.isPending} onClick={destroy}>
            {armDelete ? t.care.deleteConfirm : t.care.deleteSchedule}
          </Button>
        )}
      </div>
    </Sheet>
  );
}
