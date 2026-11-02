"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/feedback";
import {
  PARENT_KINDS,
  PARTNERSHIP_END_REASONS,
  PARTNERSHIP_KINDS,
} from "@/lib/people";

type P = { id: string; name: string; birth_year: number | null };
type Relation = "parent_of" | "child_of" | "partner_of";

const RELATIONS: [Relation, string, string][] = [
  ["parent_of", "Parent of", "Add a child of this person"],
  ["child_of", "Child of", "Add a parent of this person"],
  [
    "partner_of",
    "Spouse / Partner of",
    "Add a marriage, civil partnership or partner",
  ],
];

// The fields change with the relationship chosen, so only what applies is
// shown. A sentence underneath says exactly what will be recorded, and on
// whose records it will show.
export function RelationshipForm({
  action,
  me,
  people,
  existing,
  currentPartners,
  fixed,
}: {
  action: (form: FormData) => Promise<void>;
  me: P;
  people: P[];
  existing: { parents: string[]; children: string[]; partners: string[] };
  currentPartners: Record<string, string[]>;
  // When set, the form is for one kind of link only (e.g. "Add a parent") and
  // the choice of relationship is not shown.
  fixed?: Relation;
}) {
  const [relation, setRelation] = useState<Relation | null>(fixed ?? null);
  const [otherId, setOtherId] = useState("");
  const [kind, setKind] = useState("birth");
  const [ended, setEnded] = useState(false);

  const byId = new Map(people.map((p) => [p.id, p]));
  const other = byId.get(otherId);

  // Only people it makes sense to choose for this relationship.
  const exclude = new Set<string>([
    ...existing.partners,
    ...(relation === "parent_of"
      ? [...existing.children, ...existing.parents]
      : []),
    ...(relation === "child_of"
      ? [...existing.parents, ...existing.children]
      : []),
    ...(relation === "partner_of"
      ? [...existing.parents, ...existing.children]
      : []),
  ]);
  const choices = people.filter((p) => !exclude.has(p.id));

  // The parent's current spouse or partner, offered as the second parent.
  const parentId =
    relation === "parent_of" ? me.id : relation === "child_of" ? otherId : "";
  const childId = relation === "parent_of" ? otherId : me.id;
  const parentPartners = parentId
    ? (currentPartners[parentId] ?? []).filter((id) => id !== childId)
    : [];
  const second =
    parentPartners.length === 1
      ? (byId.get(parentPartners[0]) ??
        (parentPartners[0] === me.id ? me : undefined))
      : undefined;
  const secondAlreadyParent =
    second && relation === "child_of" && existing.parents.includes(second.id);

  // Sense check on the years of birth, shown before saving. Only for birth
  // parents: a step-parent can be younger than a step-child.
  let warning: string | null = null;
  if (
    other &&
    kind === "birth" &&
    (relation === "parent_of" || relation === "child_of")
  ) {
    const parent = relation === "parent_of" ? me : other;
    const child = relation === "parent_of" ? other : me;
    if (parent.birth_year && child.birth_year) {
      const gap = child.birth_year - parent.birth_year;
      if (gap <= 0)
        warning = `${parent.name} (born ${parent.birth_year}) can't be the parent of ${child.name} (born ${child.birth_year}). Please check the years of birth.`;
      else if (gap < 14)
        warning = `Please check: ${parent.name} and ${child.name} were born only ${gap} years apart.`;
    }
  }
  const blocked = Boolean(warning && warning.includes("can't"));

  const kindWord = (
    PARENT_KINDS[kind as keyof typeof PARENT_KINDS] ?? ""
  ).toLowerCase();
  let preview: string | null = null;
  if (other && relation === "parent_of") {
    preview = `${me.name} will be recorded as the ${kindWord} parent of ${other.name}. ${other.name}'s record will show "Child of ${me.name}".`;
  } else if (other && relation === "child_of") {
    preview = `${me.name} will be recorded as the ${kindWord} child of ${other.name}. ${other.name}'s record will show "Parent of ${me.name}".`;
  } else if (other && relation === "partner_of") {
    preview = `${me.name} and ${other.name} will be recorded as spouses / partners. It will show on both records.`;
  }

  return (
    <form action={action} className="space-y-5">
      {fixed ? (
        <input type="hidden" name="relation" value={fixed} />
      ) : (
        <fieldset>
          <legend className="mb-2 font-medium text-ink">
            {me.name} is the…
          </legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {RELATIONS.map(([value, title, hint]) => (
              <label
                key={value}
                className={`flex min-h-11 cursor-pointer flex-col rounded-lg border-2 px-4 py-3 text-ink ${
                  relation === value
                    ? "border-primary bg-card"
                    : "border-border bg-field hover:bg-muted"
                }`}
              >
                <span className="flex items-center gap-2 font-semibold">
                  <input
                    type="radio"
                    name="relation"
                    value={value}
                    checked={relation === value}
                    onChange={() => {
                      setRelation(value);
                      setOtherId("");
                    }}
                    className="h-5 w-5"
                    required
                  />
                  {title}
                </span>
                <span className="mt-1 text-sm">{hint}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {relation && (
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label
              htmlFor="other_id"
              className="mb-1 block text-sm font-medium text-ink"
            >
              {relation === "parent_of"
                ? "Parent of whom?"
                : relation === "child_of"
                  ? "Child of whom?"
                  : "Spouse / Partner of whom?"}{" "}
              (required)
            </label>
            <select
              id="other_id"
              name="other_id"
              required
              value={otherId}
              onChange={(e) => setOtherId(e.target.value)}
              className="text-input"
            >
              <option value="">Choose…</option>
              {choices.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-ink-3">
              The person must already be in the Tree. Add them first if they
              aren&apos;t.
            </p>
          </div>

          {(relation === "parent_of" || relation === "child_of") && (
            <div>
              <label
                htmlFor="parent_kind"
                className="mb-1 block text-sm font-medium text-ink"
              >
                Kind of {relation === "parent_of" ? "parent" : "child"}
              </label>
              <select
                id="parent_kind"
                name="parent_kind"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                className="text-input"
              >
                {Object.entries(PARENT_KINDS).map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          )}

          {relation === "partner_of" && (
            <>
              <div>
                <label
                  htmlFor="partnership_kind"
                  className="mb-1 block text-sm font-medium text-ink"
                >
                  Married or partners?
                </label>
                <select
                  id="partnership_kind"
                  name="partnership_kind"
                  defaultValue="marriage"
                  className="text-input"
                >
                  {Object.entries(PARTNERSHIP_KINDS).map(([v, t]) => (
                    <option key={v} value={v}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="start_date"
                  className="mb-1 block text-sm font-medium text-ink"
                >
                  Date married or started
                </label>
                <input
                  id="start_date"
                  name="start_date"
                  type="date"
                  className="text-input"
                />
              </div>
              <label className="flex min-h-11 items-center gap-3 self-end text-ink">
                <input
                  type="checkbox"
                  checked={ended}
                  onChange={(e) => setEnded(e.target.checked)}
                  className="h-5 w-5"
                />
                It has ended
              </label>
              {ended && (
                <>
                  <div>
                    <label
                      htmlFor="end_date"
                      className="mb-1 block text-sm font-medium text-ink"
                    >
                      Date it ended (required)
                    </label>
                    <input
                      id="end_date"
                      name="end_date"
                      type="date"
                      required
                      className="text-input"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="end_reason"
                      className="mb-1 block text-sm font-medium text-ink"
                    >
                      Why it ended (required)
                    </label>
                    <select
                      id="end_reason"
                      name="end_reason"
                      required
                      defaultValue=""
                      className="text-input"
                    >
                      <option value="">Choose…</option>
                      {Object.entries(PARTNERSHIP_END_REASONS).map(([v, t]) => (
                        <option key={v} value={v}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {other &&
        second &&
        !secondAlreadyParent &&
        (relation === "parent_of" || relation === "child_of") && (
          <label className="flex min-h-11 items-center gap-3 rounded-lg border border-border bg-card px-4 py-2 text-sm text-ink">
            <input
              type="checkbox"
              name="also_parent"
              value={second.id}
              className="h-5 w-5"
            />
            Also record {second.name} (
            {relation === "parent_of" ? `${me.name}'s` : `${other.name}'s`}{" "}
            spouse / partner) as a {kindWord} parent of{" "}
            {relation === "parent_of" ? other.name : me.name}
          </label>
        )}

      {warning && (
        <p role="alert" className="alert">
          {warning}
        </p>
      )}
      {preview && !blocked && (
        <p className="text-sm text-ink-2" aria-live="polite">
          {preview}
        </p>
      )}

      {relation && !blocked && (
        <SubmitButton variant="primary" pendingText="Adding…">
          {fixed === "child_of"
            ? "Add parent"
            : fixed === "parent_of"
              ? "Add child"
              : fixed === "partner_of"
                ? "Add marriage or partnership"
                : "Add relationship"}
        </SubmitButton>
      )}
    </form>
  );
}
