import { notFound } from "next/navigation";
import { AppShell, PageTitle } from "@/components/AppShell";
import { Toast } from "@/components/feedback";
import { UnderlineTabs } from "@/components/ui";
import { getFamilyContext } from "@/lib/family-context";
import { errorMessage, savedMessage } from "@/lib/messages";
import { isMonth } from "@/lib/organising";
import { displayNames, type PersonSummary } from "@/lib/people";
import { CalendarView, parseShown } from "./CalendarView";
import { loadOrganising, loadTeam } from "./organising-data";
import { TodoList } from "./TodoList";

export const dynamic = "force-dynamic";

// Organising: the one to-do list (with views) and the calendar. Viewers see
// the calendar only.
export default async function OrganisingPage({
  params,
  searchParams,
}: {
  params: Promise<{ familyId: string }>;
  searchParams: Promise<{ view?: string; who?: string; entity?: string; month?: string; show?: string; kind?: string | string[]; saved?: string; error?: string }>;
}) {
  const { familyId } = await params;
  const sp = await searchParams;
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db) notFound();
  const view = sp.view === "calendar" || !ctx.canEdit ? "calendar" : "todo";
  const [{ data: peopleRows }, { data: branchRows }, team] = await Promise.all([
    ctx.db.from("people").select("id, full_names, surname, known_as, birth_year").order("surname"),
    ctx.db.from("branches").select("id, name").order("name"),
    loadTeam(ctx),
  ]);
  const names = displayNames((peopleRows ?? []) as PersonSummary[]);
  const { items, entries, events, now, entityName } = await loadOrganising(ctx, names);
  const entities = [...entityName.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const me = ctx.user?.id ?? "";

  // To-do views: everything, mine, not given to anyone; and one entity.
  const who = sp.who === "mine" || sp.who === "unassigned" ? sp.who : "all";
  const entity = entities.find(([id]) => id === sp.entity)?.[0];
  const listed = items.filter(
    (i) =>
      (!entity || i.entityId === entity) &&
      (who === "all" || (who === "mine" ? i.todo?.assigned_to === me : Boolean(i.todo) && !i.todo!.assigned_to)),
  );
  const month = isMonth(sp.month) ? sp.month : now.slice(0, 7);
  const familyName = /family$/i.test(ctx.family.name.trim()) ? ctx.family.name : `${ctx.family.name} family`;
  const todoHere = `/families/${familyId}/organising?who=${who}${entity ? `&entity=${entity}` : ""}`;
  const openCount = items.filter((i) => !i.todo || i.todo.status === "open").length;

  return (
    <AppShell
      family={{ id: familyId, name: ctx.family.name }}
      section={view === "calendar" ? "calendar" : "todo"}
      crumbs={[["My families", "/"], [familyName, `/families/${familyId}`], [view === "calendar" ? "Calendar" : "To-do list"]]}
      user={{ name: ctx.displayName, roleLabel: ctx.roleLabel, hasTwoFactor: ctx.hasTwoFactor }}
    >
      {sp.error && <Toast key={`e-${sp.error}-${Date.now()}`} kind="error" message={errorMessage(sp.error)!} />}
      {sp.saved && !sp.error && <Toast key={`s-${sp.saved}-${Date.now()}`} message={savedMessage(sp.saved)!} />}
      <PageTitle
        title="Organising"
        subtitle="The family's one to-do list and calendar. What the records say needs doing is added by itself, from every part of Village Square."
      />
      {ctx.canEdit && (
        <UnderlineTabs
          label="Organising"
          current={view}
          items={[
            ["todo", `To-do list (${openCount})`, `/families/${familyId}/organising`],
            ["calendar", "Calendar", `/families/${familyId}/organising?view=calendar`],
          ]}
        />
      )}
      <div className="mt-6 space-y-5">
        {sp.error && <p className="alert">Not saved: {errorMessage(sp.error)}</p>}
        {view === "todo" ? (
          <>
            <form method="get" className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="who" className="mb-1 block text-sm font-medium text-ink">
                  Show
                </label>
                <select id="who" name="who" defaultValue={who} className="text-input">
                  <option value="all">Everything</option>
                  <option value="mine">My to-dos</option>
                  <option value="unassigned">To-dos not given to anyone</option>
                </select>
              </div>
              <div>
                <label htmlFor="entity" className="mb-1 block text-sm font-medium text-ink">
                  Entity
                </label>
                <select id="entity" name="entity" defaultValue={entity ?? ""} className="text-input">
                  <option value="">All</option>
                  {entities.map(([id, n]) => (
                    <option key={id} value={id}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className="btn-secondary">
                Show
              </button>
            </form>
            <TodoList familyId={familyId} items={listed} team={team} names={names} entities={entities} here={todoHere} now={now} me={me} canEdit={ctx.canEdit} />
          </>
        ) : (
          <CalendarView
            familyId={familyId}
            entries={entries}
            events={events}
            month={month}
            shown={parseShown(sp.show, sp.kind)}
            base={`/families/${familyId}/organising?view=calendar`}
            now={now}
            canEdit={ctx.canEdit}
            entities={entities}
            branches={((branchRows ?? []) as { id: string; name: string }[]).map((b) => [b.id, b.name] as [string, string])}
            names={names}
          />
        )}
      </div>
    </AppShell>
  );
}
