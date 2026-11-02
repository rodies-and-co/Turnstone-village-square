import { notFound } from "next/navigation";
import { AppShell, PageTitle } from "@/components/AppShell";
import { Toast } from "@/components/feedback";
import { getFamilyContext } from "@/lib/family-context";
import { errorMessage, savedMessage } from "@/lib/messages";
import { displayNames, type PersonSummary } from "@/lib/people";
import { DecisionsArea, VIEWS, type View } from "./DecisionsArea";
import { loadBodies } from "./meetings-data";

export const dynamic = "force-dynamic";

// Meetings & resolutions for the whole family: every entity's board and
// members, and the family's governance bodies. "Whose" narrows it to one.
export default async function MeetingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ familyId: string }>;
  searchParams: Promise<{
    who?: string;
    view?: string;
    saved?: string;
    error?: string;
  }>;
}) {
  const { familyId } = await params;
  const sp = await searchParams;
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db) notFound();
  const view = (VIEWS.find(([v]) => v === sp.view)?.[0] ?? "meetings") as View;
  const { entities, bodies } = await loadBodies(ctx);
  const [kind, id] = (sp.who ?? "").split(":");
  const scope =
    kind === "entity" && entities.some((e) => e.id === id)
      ? { entityId: id }
      : kind === "governance" && bodies.some((b) => b.id === id)
        ? { govId: id }
        : {};
  const who = scope.entityId
    ? `entity:${scope.entityId}`
    : scope.govId
      ? `governance:${scope.govId}`
      : "";
  const { data: peopleRows } = await ctx.db
    .from("people")
    .select("id, full_names, surname, known_as, birth_year")
    .order("surname");
  const names = displayNames((peopleRows ?? []) as PersonSummary[]);
  const familyName = /family$/i.test(ctx.family.name.trim())
    ? ctx.family.name
    : `${ctx.family.name} family`;
  const here = `/families/${familyId}/meetings${who ? `?who=${encodeURIComponent(who)}` : ""}`;

  return (
    <AppShell
      family={{ id: familyId, name: ctx.family.name }}
      section="meetings"
      crumbs={[
        ["My families", "/"],
        [familyName, `/families/${familyId}`],
        ["Meetings & resolutions"],
      ]}
      user={{
        name: ctx.displayName,
        roleLabel: ctx.roleLabel,
        hasTwoFactor: ctx.hasTwoFactor,
      }}
    >
      {sp.error && (
        <Toast
          key={`e-${sp.error}-${Date.now()}`}
          kind="error"
          message={errorMessage(sp.error)!}
        />
      )}
      {sp.saved && !sp.error && (
        <Toast
          key={`s-${sp.saved}-${Date.now()}`}
          message={savedMessage(sp.saved)!}
        />
      )}
      <PageTitle
        title="Meetings & resolutions"
        subtitle="Meetings, written resolutions and file notes of the family's entities and governance bodies. Only confirmed meetings and passed resolutions change the registers."
      />
      {sp.error && (
        <p className="alert mb-4">Not saved: {errorMessage(sp.error)}</p>
      )}
      <form
        method="get"
        className="mb-5 flex flex-wrap items-end gap-3 print:hidden"
      >
        <input type="hidden" name="view" value={view} />
        <div>
          <label
            htmlFor="who"
            className="mb-1 block text-sm font-medium text-ink"
          >
            Whose
          </label>
          <select id="who" name="who" defaultValue={who} className="text-input">
            <option value="">Everyone&apos;s</option>
            <optgroup label="Entities">
              {entities.map((e) => (
                <option key={e.id} value={`entity:${e.id}`}>
                  {e.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Governance bodies">
              {bodies.map((b) => (
                <option key={b.id} value={`governance:${b.id}`}>
                  {b.name}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
        <button type="submit" className="btn-secondary">
          Show
        </button>
      </form>
      <DecisionsArea
        ctx={ctx}
        familyId={familyId}
        scope={scope}
        view={view}
        here={here}
        names={names}
      />
    </AppShell>
  );
}
