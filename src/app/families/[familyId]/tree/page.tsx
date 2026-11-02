import Link from "next/link";
import { AppShell, PageTitle } from "@/components/AppShell";
import { Toast } from "@/components/feedback";
import { Alert, Card, Chip } from "@/components/ui";
import { getFamilyContext } from "@/lib/family-context";
import { savedMessage } from "@/lib/messages";
import {
  THREE_CIRCLE_ROLES,
  displayNames,
  generationName,
  generations,
  lifeLine,
  matchesSearch,
  partnershipLine,
  type MemberType,
} from "@/lib/people";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  full_names: string;
  surname: string;
  maiden_name: string | null;
  known_as: string | null;
  birth_year: number | null;
  deceased: boolean;
  member_type: MemberType;
  three_circle_role: keyof typeof THREE_CIRCLE_ROLES | null;
  branch_id: string | null;
};
type Partnership = {
  person_a: string;
  person_b: string;
  kind: string;
  start_date: string | null;
  end_date: string | null;
  end_reason: string | null;
};

// The Tree: everyone in the family, grouped by generation, as in The Family
// Square's Family Register. Non-family people (advisers, trustees and so on)
// are listed separately.
export default async function TreePage({
  params,
  searchParams,
}: {
  params: Promise<{ familyId: string }>;
  searchParams: Promise<{ q?: string; saved?: string }>;
}) {
  const { familyId } = await params;
  const { q = "", saved } = await searchParams;
  const ctx = await getFamilyContext(familyId);
  const familyName = /family$/i.test(ctx.family.name.trim())
    ? ctx.family.name
    : `${ctx.family.name} family`;

  let people: Row[] = [];
  let branches = new Map<string, string>();
  let links: { parent_id: string; child_id: string }[] = [];
  let partnerships: Partnership[] = [];
  let loadError = false;
  if (ctx.db) {
    const [p, b, l, m] = await Promise.all([
      ctx.db
        .from("people")
        .select(
          "id, full_names, surname, maiden_name, known_as, birth_year, deceased, member_type, three_circle_role, branch_id",
        )
        .order("birth_year", { nullsFirst: false })
        .order("surname"),
      ctx.db.from("branches").select("id, name"),
      ctx.db.from("parent_child").select("parent_id, child_id"),
      ctx.db
        .from("partnerships")
        .select("person_a, person_b, kind, start_date, end_date, end_reason"),
    ]);
    loadError = Boolean(p.error);
    people = (p.data ?? []) as Row[];
    branches = new Map(
      (b.data ?? []).map((x: { id: string; name: string }) => [x.id, x.name]),
    );
    links = (l.data ?? []) as typeof links;
    partnerships = (m.data ?? []) as Partnership[];
  }

  const names = displayNames(people);
  const firstName = (id: string) => {
    const p = people.find((x) => x.id === id);
    return p ? p.known_as || p.full_names.split(/\s+/)[0] : "someone";
  };
  const family = people.filter((p) => p.member_type !== "non_family");
  const gens = generations(
    family.map((p) => p.id),
    links,
    partnerships,
  );
  const shown = people.filter((p) => matchesSearch(p, q));
  const shownIds = new Set(shown.map((p) => p.id));

  const groups = new Map<number | null, Row[]>();
  for (const p of family) {
    if (!shownIds.has(p.id)) continue;
    const g = gens.get(p.id) ?? null;
    groups.set(g, [...(groups.get(g) ?? []), p]);
  }
  const ordered = [...groups.entries()].sort(
    ([a], [b]) => (a ?? 99) - (b ?? 99),
  );
  const nonFamily = shown.filter((p) => p.member_type === "non_family");

  const familyCount = family.length;
  const nonFamilyCount = people.length - familyCount;

  const row = (p: Row) => (
    <li key={p.id}>
      <Link
        href={`/families/${familyId}/tree/${p.id}`}
        className="-mx-2 grid min-h-16 gap-x-6 gap-y-1 rounded-md px-2 py-3 hover:bg-muted md:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1.2fr)] md:items-center"
      >
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-medium text-ink">
              {names.get(p.id)}
            </span>
            {p.deceased && <Chip>Deceased</Chip>}
            {p.member_type === "family_not_succession" && (
              <Chip>Not in succession</Chip>
            )}
          </span>
          <span className="block text-sm text-ink-3">{lifeLine(p)}</span>
        </span>
        <span className="text-sm text-ink-2">
          {p.member_type === "non_family"
            ? p.three_circle_role
              ? THREE_CIRCLE_ROLES[p.three_circle_role]
              : "Non-family"
            : p.branch_id
              ? branches.get(p.branch_id)
              : ""}
        </span>
        <span className="text-sm text-ink-2">
          {partnershipLine(p.id, partnerships, firstName) ?? ""}
        </span>
      </Link>
    </li>
  );

  return (
    <AppShell
      family={{ id: familyId, name: ctx.family.name }}
      section="tree"
      crumbs={[
        ["My families", "/"],
        [familyName, `/families/${familyId}`],
        ["The Tree"],
      ]}
      user={{
        name: ctx.displayName,
        roleLabel: ctx.roleLabel,
        hasTwoFactor: ctx.hasTwoFactor,
      }}
    >
      {saved && (
        <Toast
          key={`s-${saved}-${Date.now()}`}
          message={savedMessage(saved)!}
        />
      )}
      <PageTitle
        eyebrow="Recording the facts"
        title="The Tree"
        subtitle={`${familyCount} family ${familyCount === 1 ? "member" : "members"}, ${nonFamilyCount} non-family`}
        actions={
          ctx.canEdit && (
            <Link
              href={`/families/${familyId}/tree/new`}
              className="btn-primary"
            >
              Add person
            </Link>
          )
        }
      />

      {!ctx.db && (
        <Alert>This family&apos;s database isn&apos;t connected yet.</Alert>
      )}
      {loadError && (
        <Alert>
          The family database could not be read. Sign out and in again, then try
          once more.
        </Alert>
      )}

      <form className="mb-6 flex flex-wrap items-end gap-2" role="search">
        <div className="w-full sm:w-80">
          <label
            htmlFor="q"
            className="mb-1 block text-sm font-medium text-ink"
          >
            Find a person
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q}
            className="text-input"
            placeholder="Name, Known as or maiden name"
          />
        </div>
        <button type="submit" className="btn-secondary">
          Search
        </button>
        {q && (
          <Link href={`/families/${familyId}/tree`} className="btn-quiet">
            Clear
          </Link>
        )}
        {q && (
          <p className="w-full text-sm text-ink-3" aria-live="polite">
            {shown.length} of {people.length} people match &ldquo;{q}&rdquo;.
          </p>
        )}
      </form>

      <div className="space-y-5">
        {ordered.map(([g, rows]) => (
          <Card key={String(g)} title={generationName(g)}>
            <ul className="divide-y divide-border border-t border-border">
              {rows.map(row)}
            </ul>
          </Card>
        ))}
        {nonFamily.length > 0 && (
          <Card
            title="Non-family"
            description="Advisers, trustees, employees and others who are not family."
          >
            <ul className="divide-y divide-border border-t border-border">
              {nonFamily.map(row)}
            </ul>
          </Card>
        )}
        {people.length > 0 && shown.length === 0 && (
          <p className="text-ink">Nobody matches &ldquo;{q}&rdquo;.</p>
        )}
        {people.length === 0 && ctx.db && !loadError && (
          <Card>
            <p className="text-ink">Nobody has been added yet.</p>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
