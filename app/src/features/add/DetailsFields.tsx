import type { Category } from "@pawlog/shared";
import {
  DateInput,
  Field,
  NumberInput,
  Select,
  TextInput,
} from "../../components/form";
import { useT } from "../../i18n";
import {
  CATEGORY_FIELDS,
  type FieldSpec,
  type FormValues,
} from "./categoryFields";

function OneField({
  spec,
  value,
  onChange,
}: {
  spec: FieldSpec;
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useT();
  const label = spec.required
    ? t.fields[spec.label]
    : `${t.fields[spec.label]} (${t.common.optional})`;

  if (spec.control === "select") {
    const labels = t.options[spec.optionGroup!];
    return (
      <Field label={label}>
        <Select value={value} onChange={(e) => onChange(e.target.value)}>
          {!spec.required && <option value="">—</option>}
          {spec.options!.map((opt) => (
            <option key={opt} value={opt}>
              {(labels as Record<string, string>)[opt]}
            </option>
          ))}
        </Select>
      </Field>
    );
  }
  if (spec.control === "number") {
    return (
      <Field label={label}>
        <NumberInput value={value} onChange={(e) => onChange(e.target.value)} />
      </Field>
    );
  }
  if (spec.control === "date") {
    return (
      <Field label={label}>
        <DateInput value={value} onChange={(e) => onChange(e.target.value)} />
      </Field>
    );
  }
  return (
    <Field label={label}>
      <TextInput
        value={value}
        maxLength={spec.maxLength}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function DetailsFields({
  category,
  values,
  onChange,
}: {
  category: Category;
  values: FormValues;
  onChange: (values: FormValues) => void;
}) {
  const specs = CATEGORY_FIELDS[category];
  if (specs.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-3">
      {specs.map((spec) => (
        <div
          key={spec.key}
          className={spec.control === "text" ? "col-span-2" : ""}
        >
          <OneField
            spec={spec}
            value={values[spec.key] ?? ""}
            onChange={(v) => onChange({ ...values, [spec.key]: v })}
          />
        </div>
      ))}
    </div>
  );
}
