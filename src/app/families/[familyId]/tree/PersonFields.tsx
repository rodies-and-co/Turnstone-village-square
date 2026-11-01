import { Checkbox, Field, Select } from "@/components/ui";
import { MEMBER_TYPES, MONTHS, THREE_CIRCLE_ROLES } from "@/lib/people";

export type PersonValues = {
  full_names?: string;
  surname?: string;
  maiden_name?: string | null;
  known_as?: string | null;
  member_type?: string;
  birth_year?: number | null;
  deceased?: boolean;
  three_circle_role?: string | null;
  branch_id?: string | null;
  date_of_birth?: string | null;
};

// Date of birth, entered once: the year on its own, or the full date.
function BirthDateFields({ year, date }: { year?: number | null; date?: string | null }) {
  const [, m, d] = date ? date.split("-").map(Number) : [];
  return (
    <fieldset className="sm:col-span-2 lg:col-span-2">
      <legend className="mb-1 text-sm font-medium text-ink">Date of birth</legend>
      <div className="grid max-w-md grid-cols-[5rem_1fr_6rem] gap-3">
        <div>
          <label htmlFor="birth_day" className="mb-1 block text-xs text-ink-3">
            Day
          </label>
          <select id="birth_day" name="birth_day" defaultValue={d ?? ""} className="text-input">
            <option value="">—</option>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="birth_month" className="mb-1 block text-xs text-ink-3">
            Month
          </label>
          <select id="birth_month" name="birth_month" defaultValue={m ?? ""} className="text-input">
            <option value="">—</option>
            {MONTHS.map((name, i) => (
              <option key={name} value={i + 1}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="birth_year" className="mb-1 block text-xs text-ink-3">
            Year
          </label>
          <input id="birth_year" name="birth_year" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} defaultValue={year ?? ""} className="text-input" placeholder="e.g. 1975" />
        </div>
      </div>
      <p className="mt-1 text-xs text-ink-3">
        If only the year is known, fill in the year and leave the day and month empty. The full date is private:
        Viewers only see the year.
      </p>
    </fieldset>
  );
}

// The fields of a person's Overview, shared by "Add a person" and "Edit".
export function PersonFields({
  values = {},
  branches,
  canChooseBranch,
}: {
  values?: PersonValues;
  branches: { id: string; name: string }[];
  canChooseBranch: boolean;
}) {
  return (
    <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Full names" name="full_names" defaultValue={values.full_names} required />
      <Field label="Surname" name="surname" defaultValue={values.surname} required />
      <Field
        label="Known as"
        name="known_as"
        defaultValue={values.known_as}
        hint="The name used every day. If two people share it, the year of birth is shown too."
      />
      <Field label="Maiden name" name="maiden_name" defaultValue={values.maiden_name} />
      <Select label="Type of member" name="member_type" options={MEMBER_TYPES} defaultValue={values.member_type} includeBlank="Choose…" required />
      <Select
        label="Three circle role"
        name="three_circle_role"
        options={THREE_CIRCLE_ROLES}
        defaultValue={values.three_circle_role}
        includeBlank="Not recorded"
        hint="Their position across family, ownership and business."
      />
      <BirthDateFields year={values.birth_year} date={values.date_of_birth} />
      <Select
        label="Branch"
        name="branch_id"
        options={branches.map((b) => [b.id, b.name] as [string, string])}
        defaultValue={values.branch_id}
        includeBlank="No branch"
        disabled={!canChooseBranch}
        hint={canChooseBranch ? undefined : "Only a Manager can move a person to another branch."}
      />
      <div className="sm:col-span-2 lg:col-span-3">
        <Checkbox label="Deceased" name="deceased" defaultChecked={values.deceased} />
      </div>
    </div>
  );
}
