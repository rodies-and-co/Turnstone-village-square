import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { Toast } from "@/components/feedback";
import { Alert, BackLink, PageShell } from "@/components/ui";
import { getFamilyContext } from "@/lib/family-context";
import { savedMessage } from "@/lib/messages";
import { MEMBER_TYPES, THREE_CIRCLE_ROLES, displayNames, matchesSearch, type MemberType } from "@/lib/people";

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

  let people: Row[] = [];
  let branches = new Map<string, string>();
  let loadError = false;
  if (ctx.db) {
    const [p, b] = await Promise.all([
      ctx.db
        .from("people")
        .select("id, full_names, surname, maiden_name, known_as, birth_year, deceased, member_type, three_circle_role, branch_id")
        .order("surname")
        .order("birth_year", { nullsFirst: false }),
      ctx.db.from("branches").select("id, name"),
    ]);
    loadError = Boolean(p.error);
    people = (p.data ?? []) as Row[];
    branches = new Map((b.data ?? []).map((x: { id: string; name: string }) => [x.id, x.name]));
  }

  const names = displayNames(people);
  const shown = people.filter((p) => matchesSearch(p, q));
  const groups = (Object.keys(MEMBER_TYPES) as MemberType[]).map((t) => ({
    type: t,
    rows: shown.filter((p) => p.member_type === t),
  }));

  return (
    <>
      <SiteHeader name={ctx.displayName} roleLabel={ctx.roleLabel} hasTwoFactor={ctx.hasTwoFactor} />
      <PageShell>
        <BackLink href={`/families/${familyId}`}>{ctx.family.name}</BackLink>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-ink">The Tree</h1>
          {ctx.canEdit && (
            <Link href={`/families/${familyId}/tree/new`} className="btn-primary">
              Add a person
            </Link>
          )}
        </div>

        {saved && <Toast key={`s-${saved}-${Date.now()}`} message={savedMessage(saved)!} />}
        {!ctx.db && (
          <div className="mt-4">
            <Alert>This family&apos;s database isn&apos;t connected yet.</Alert>
          </div>
        )}
        {loadError && (
          <div className="mt-4">
            <Alert>The family database could not be read. Sign out and in again, then try once more.</Alert>
          </div>
        )}

        <form className="mt-6 flex flex-wrap items-end gap-3" role="search">
          <div className="grow">
            <label htmlFor="q" className="mb-1 block font-medium text-ink">
              Search by name
            </label>
            <input id="q" name="q" defaultValue={q} className="text-input" placeholder="Full names, surname, Known as or maiden name" />
          </div>
          <button type="submit" className="btn-secondary">
            Search
          </button>
          {q && (
            <Link href={`/families/${familyId}/tree`} className="btn-secondary">
              Clear
            </Link>
          )}
        </form>

        <p className="mt-4 text-sm text-ink">
          {shown.length} of {people.length} {people.length === 1 ? "person" : "people"}
        </p>

        <div className="mt-4 space-y-8">
          {groups.map((g) => (
            <section key={g.type}>
              <h2 className="text-lg font-semibold text-ink">
                {MEMBER_TYPES[g.type]} ({g.rows.length})
              </h2>
              {g.rows.length === 0 ? (
                <p className="mt-2 text-ink">None{q ? " match your search" : ""}.</p>
              ) : (
                <ul className="mt-2 divide-y divide-border rounded-2xl border border-border bg-card">
                  {g.rows.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`/families/${familyId}/tree/${p.id}`}
                        className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-muted"
                      >
                        <span className="font-medium text-ink">
                          {names.get(p.id)}
                          {p.deceased ? " · Deceased" : ""}
                        </span>
                        <span className="text-sm text-ink">
                          {[
                            p.full_names !== p.known_as ? `${p.full_names} ${p.surname}` : null,
                            p.three_circle_role ? THREE_CIRCLE_ROLES[p.three_circle_role] : null,
                            p.branch_id ? branches.get(p.branch_id) : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </PageShell>
    </>
  );
}
