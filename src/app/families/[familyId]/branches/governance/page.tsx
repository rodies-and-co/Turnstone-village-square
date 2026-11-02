import Link from "next/link";
import { ConfirmRemove, SubmitButton } from "@/components/feedback";
import { Card, Field, Fold, Notice, Row, Rows, Select } from "@/components/ui";
import { getFamilyContext } from "@/lib/family-context";
import {
  BODY_HINTS,
  BODY_KINDS,
  MEMBER_ROLES,
  formatDate,
} from "@/lib/governance";
import { displayNames, type PersonSummary } from "@/lib/people";
import { QUORUM_RULES } from "@/lib/meetings";
import { saveBodyQuorum } from "../../meetings/actions";
import { BranchesFrame } from "../BranchesFrame";
import {
  addBody,
  addSeat,
  endSeat,
  removeBody,
  removeSeat,
  saveBody,
} from "../governance-actions";

export const dynamic = "force-dynamic";

type Body = {
  id: string;
  kind: keyof typeof BODY_KINDS;
  name: string;
  branch_id: string | null;
  purpose: string | null;
  meets: string | null;
  established_on: string | null;
  quorum_rule: string | null;
  quorum_number: number | null;
};
type Seat = {
  id: string;
  body_id: string;
  person_id: string;
  role: keyof typeof MEMBER_ROLES;
  from_date: string | null;
  to_date: string | null;
};

const KIND_ORDER = Object.keys(BODY_KINDS);

export default async function GovernancePage({
  params,
  searchParams,
}: {
  params: Promise<{ familyId: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { familyId } = await params;
  const sp = await searchParams;
  const ctx = await getFamilyContext(familyId);

  let bodies: Body[] = [];
  let seats: Seat[] = [];
  let people: (PersonSummary & { member_type: string })[] = [];
  let branches: { id: string; name: string }[] = [];
  if (ctx.db) {
    const [b, s, p, br] = await Promise.all([
      ctx.db
        .from("governance_bodies")
        .select(
          "id, kind, name, branch_id, purpose, meets, established_on, quorum_rule, quorum_number",
        ),
      ctx.db
        .from("body_members")
        .select("id, body_id, person_id, role, from_date, to_date"),
      ctx.db
        .from("people")
        .select("id, full_names, surname, known_as, birth_year, member_type")
        .order("surname"),
      ctx.db.from("branches").select("id, name").order("name"),
    ]);
    bodies = ((b.data ?? []) as Body[]).sort(
      (x, y) =>
        Number(Boolean(x.branch_id)) - Number(Boolean(y.branch_id)) ||
        KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind) ||
        x.name.localeCompare(y.name),
    );
    seats = (s.data ?? []) as Seat[];
    people = (p.data ?? []) as typeof people;
    branches = (br.data ?? []) as typeof branches;
  }
  const names = displayNames(people);
  const name = (id: string) => names.get(id) ?? "Someone you can't see";
  const branchName = (id: string | null) =>
    id
      ? (branches.find((b) => b.id === id)?.name ?? "A branch")
      : "Whole family";
  const scopeOptions: [string, string][] = [
    ["", "Whole family"],
    ...branches.map((b) => [b.id, b.name] as [string, string]),
  ];
  const personOptions = people
    .map((p) => [p.id, names.get(p.id) ?? p.surname] as [string, string])
    .sort((a, b) => a[1].localeCompare(b[1]));
  const roleOrder = Object.keys(MEMBER_ROLES);

  return (
    <BranchesFrame
      ctx={ctx}
      familyId={familyId}
      tab="governance"
      saved={sp.saved}
      error={sp.error}
    >
      {bodies.length === 0 && (
        <Card title="No governance bodies yet">
          <p className="text-ink-2">
            Most families start with a{" "}
            <strong className="font-medium text-ink">Family Assembly</strong>{" "}
            (every adult family member, meeting once or twice a year) and a{" "}
            <strong className="font-medium text-ink">Family Council</strong> (a
            smaller group chosen by the Assembly, acting for the family between
            meetings). Larger families often add a council per branch.
          </p>
        </Card>
      )}

      {bodies.map((body) => {
        const current = seats
          .filter((s) => s.body_id === body.id && !s.to_date)
          .sort(
            (a, b) =>
              roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role) ||
              name(a.person_id).localeCompare(name(b.person_id)),
          );
        const past = seats.filter((s) => s.body_id === body.id && s.to_date);
        const seated = new Set(current.map((s) => s.person_id));
        return (
          <Card
            key={body.id}
            title={body.name}
            description={[
              BODY_KINDS[body.kind],
              branchName(body.branch_id),
              body.meets ? `Meets: ${body.meets}` : null,
              body.established_on
                ? `Since ${formatDate(body.established_on)}`
                : null,
              body.quorum_rule
                ? `Quorum: ${body.quorum_rule === "number" ? body.quorum_number : body.quorum_rule === "majority" ? "a majority" : "everyone"}`
                : "Quorum not recorded",
            ]
              .filter(Boolean)
              .join(" · ")}
            actions={
              <Link
                href={`/families/${familyId}/meetings?who=${encodeURIComponent(`governance:${body.id}`)}`}
                className="btn-secondary"
              >
                Meetings &amp; resolutions
              </Link>
            }
          >
            {body.purpose && (
              <p className="mb-4 whitespace-pre-line text-ink-2">
                {body.purpose}
              </p>
            )}
            {current.length === 0 ? (
              <p className="border-y border-border py-3 text-ink-3">
                No members yet.
              </p>
            ) : (
              <Rows>
                {current.map((s) => (
                  <Row
                    key={s.id}
                    title={
                      <Link
                        href={`/families/${familyId}/tree/${s.person_id}`}
                        className="hover:underline"
                      >
                        {name(s.person_id)}
                      </Link>
                    }
                    meta={[
                      MEMBER_ROLES[s.role],
                      s.from_date ? `Since ${formatDate(s.from_date)}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  >
                    {ctx.canEdit && (
                      <ConfirmRemove
                        action={endSeat.bind(null, familyId, s.id)}
                        what={`${name(s.person_id)}'s seat`}
                        label="End"
                      />
                    )}
                  </Row>
                ))}
              </Rows>
            )}

            {ctx.canEdit && (
              <div className="mt-2 flex flex-wrap gap-x-6">
                <Fold label="Add a member">
                  <form
                    action={addSeat.bind(null, familyId, body.id)}
                    className="grid gap-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
                  >
                    <Select
                      id={`person_id-${body.id}`}
                      label="Person"
                      name="person_id"
                      options={personOptions.filter(([id]) => !seated.has(id))}
                      includeBlank="Choose…"
                      required
                    />
                    <Select
                      id={`role-${body.id}`}
                      label="Role"
                      name="role"
                      options={MEMBER_ROLES}
                      defaultValue="member"
                    />
                    <Field
                      id={`from_date-${body.id}`}
                      label="Since"
                      name="from_date"
                      type="date"
                    />
                    <SubmitButton pendingText="Adding…">Add</SubmitButton>
                  </form>
                </Fold>
                <Fold label="Change the details">
                  <form
                    action={saveBody.bind(null, familyId, body.id)}
                    className="space-y-4"
                  >
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Field
                        id={`name-${body.id}`}
                        label="Name"
                        name="name"
                        defaultValue={body.name}
                        required
                      />
                      <Field
                        id={`meets-${body.id}`}
                        label="How often it meets"
                        name="meets"
                        defaultValue={body.meets}
                        hint="e.g. Twice a year"
                      />
                      <Field
                        id={`established-${body.id}`}
                        label="Established"
                        name="established_on"
                        type="date"
                        defaultValue={body.established_on}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`purpose-${body.id}`}
                        className="mb-1 block text-sm font-medium text-ink"
                      >
                        Purpose and powers
                      </label>
                      <textarea
                        id={`purpose-${body.id}`}
                        name="purpose"
                        rows={3}
                        defaultValue={body.purpose ?? ""}
                        className="text-area"
                      />
                    </div>
                    <SubmitButton>Save changes</SubmitButton>
                  </form>
                </Fold>
                <Fold label="Quorum">
                  <form
                    action={saveBodyQuorum.bind(null, familyId, body.id)}
                    className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
                  >
                    <Select
                      id={`quorum-${body.id}`}
                      label="How many must be present"
                      name="quorum_rule"
                      options={QUORUM_RULES}
                      includeBlank="Not recorded"
                      defaultValue={body.quorum_rule}
                    />
                    <Field
                      id={`quorum-n-${body.id}`}
                      label="Number (if a set number)"
                      name="quorum_number"
                      defaultValue={body.quorum_number}
                    />
                    <SubmitButton>Save</SubmitButton>
                  </form>
                </Fold>
                {ctx.canEdit && (
                  <Fold label="Remove this body" danger>
                    <p className="text-sm text-ink-2">
                      This removes {body.name} and its list of members. The
                      change is recorded in the history. It is removed only once
                      another Manager approves the request on the family
                      Overview.
                    </p>
                    <form
                      action={removeBody.bind(null, familyId, body.id)}
                      className="mt-3"
                    >
                      <SubmitButton pendingText="Asking…">
                        Ask to remove {body.name}
                      </SubmitButton>
                    </form>
                  </Fold>
                )}
              </div>
            )}

            {past.length > 0 && (
              <Fold label={`Past members (${past.length})`}>
                <Rows>
                  {past.map((s) => (
                    <Row
                      key={s.id}
                      title={name(s.person_id)}
                      meta={[
                        MEMBER_ROLES[s.role],
                        [formatDate(s.from_date), formatDate(s.to_date)]
                          .filter(Boolean)
                          .join(" to "),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    >
                      {ctx.canEdit && (
                        <ConfirmRemove
                          action={removeSeat.bind(null, familyId, s.id)}
                          what={`${name(s.person_id)}'s past seat`}
                        />
                      )}
                    </Row>
                  ))}
                </Rows>
              </Fold>
            )}
          </Card>
        );
      })}

      {ctx.canEdit && (
        <Card title="Add a governance body">
          <Fold
            label="Add a Family Assembly, Family Council, branch council or committee"
            open={bodies.length === 0}
          >
            <form action={addBody.bind(null, familyId)} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <Select
                  label="Kind"
                  name="kind"
                  options={BODY_KINDS}
                  includeBlank="Choose…"
                  required
                />
                <Field
                  label="Name"
                  name="name"
                  hint="Leave empty to use the kind, e.g. “Family Council”."
                />
                <Select label="For" name="branch_id" options={scopeOptions} />
                <Field
                  label="How often it meets"
                  name="meets"
                  hint="e.g. Twice a year"
                />
                <Field label="Established" name="established_on" type="date" />
              </div>
              <div>
                <label
                  htmlFor="purpose"
                  className="mb-1 block text-sm font-medium text-ink"
                >
                  Purpose and powers
                </label>
                <textarea
                  id="purpose"
                  name="purpose"
                  rows={3}
                  className="text-area"
                />
              </div>
              <ul className="space-y-1 text-xs text-ink-3">
                {Object.entries(BODY_HINTS).map(([k, h]) => (
                  <li key={k}>
                    <strong className="font-medium text-ink-2">
                      {BODY_KINDS[k as keyof typeof BODY_KINDS]}:
                    </strong>{" "}
                    {h}
                  </li>
                ))}
              </ul>
              <SubmitButton pendingText="Adding…">Add body</SubmitButton>
            </form>
          </Fold>
        </Card>
      )}

      {!ctx.canEdit && bodies.length > 0 && (
        <Notice>
          Only Managers and Administrators can change the governance bodies.
        </Notice>
      )}
    </BranchesFrame>
  );
}
