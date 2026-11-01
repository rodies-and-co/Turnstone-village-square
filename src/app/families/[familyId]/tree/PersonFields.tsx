import { Checkbox, Field, Select } from "@/components/ui";
import { MEMBER_TYPES, THREE_CIRCLE_ROLES } from "@/lib/people";

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
};

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
    <div className="grid gap-5 sm:grid-cols-2">
      <Field label="Full names" name="full_names" defaultValue={values.full_names} required />
      <Field label="Surname" name="surname" defaultValue={values.surname} required />
      <Field label="Maiden name" name="maiden_name" defaultValue={values.maiden_name} />
      <Field
        label="Known as"
        name="known_as"
        defaultValue={values.known_as}
        hint="The name used every day. If two people share it, the year of birth is shown too."
      />
      <Select label="Type of member" name="member_type" options={MEMBER_TYPES} defaultValue={values.member_type} includeBlank="Choose…" required />
      <Field
        label="Year of birth"
        name="birth_year"
        type="number"
        defaultValue={values.birth_year}
        hint="Filled in for you once a full date of birth is recorded."
      />
      <Select
        label="Three circle role"
        name="three_circle_role"
        options={THREE_CIRCLE_ROLES}
        defaultValue={values.three_circle_role}
        includeBlank="Not recorded"
        hint="Their position across family, ownership and business."
      />
      <Select
        label="Branch"
        name="branch_id"
        options={branches.map((b) => [b.id, b.name] as [string, string])}
        defaultValue={values.branch_id}
        includeBlank="No branch"
        disabled={!canChooseBranch}
        hint={canChooseBranch ? undefined : "Only a Manager can move a person to another branch."}
      />
      <div className="sm:col-span-2">
        <Checkbox label="Deceased" name="deceased" defaultChecked={values.deceased} />
      </div>
    </div>
  );
}
