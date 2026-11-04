import type { ReactNode } from "react";
import Link from "next/link";
import { ConfirmRemove, SubmitButton } from "@/components/feedback";
import { Card, Chip, Field, Fold, Select } from "@/components/ui";
import { formatDate } from "@/lib/governance";
import { byDue, londonDate } from "@/lib/organising";
import { TextArea } from "../meetings/DecisionsArea";
import { addTodo, removeTodo, setTodoStatus, updateTodo } from "./actions";
import { GROUPS, PRIORITIES, TOPICS, type Group, type Item } from "./organising-data";

// The one to-do list: to-dos people add and what the records say needs doing,
// grouped by topic, overdue first.
export function TodoList({
  familyId,
  items,
  team,
  names,
  entities,
  here,
  now,
  me,
  canEdit,
  fixed,
  title = "To-do list",
  compact,
}: {
  familyId: string;
  items: Item[];
  team: Map<string, string>;
  names: Map<string, string>;
  entities: [string, string][];
  // This page's address, to come back to after a change.
  here: string;
  now: string;
  me: string;
  canEdit: boolean;
  // A new to-do is about this entity or person (on their own page).
  fixed?: { entityId?: string; personId?: string; goalId?: string };
  title?: string;
  // Inside another card (a project's goal): one plain list, no cards.
  compact?: boolean;
}) {
  const Box = compact ? Plain : Card;
  const open = items.filter((i) => !i.todo || i.todo.status === "open");
  const done = items.filter((i) => i.todo?.status === "done").sort((a, b) => (b.todo!.done_at ?? "").localeCompare(a.todo!.done_at ?? ""));
  const groups = (Object.keys(GROUPS) as Group[]).map((g) => [g, open.filter((i) => i.group === g).sort((a, b) => byDue({ due: a.due, priority: a.todo?.priority }, { due: b.due, priority: b.todo?.priority }))] as const);
  const teamOptions = [...team.entries()].map(([id, n]) => [id, id === me ? `${n} (me)` : n] as [string, string]);
  const people = [...names.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const overdue = (d: string | null) => Boolean(d && d < now);
  // The entity is already named on the line above, so don't say it twice.
  const detailOf = (i: Item) => {
    const n = i.entityId ? entities.find(([id]) => id === i.entityId)?.[1] : undefined;
    if (!i.detail || !n || fixed?.entityId || !i.detail.startsWith(n)) return i.detail;
    return i.detail.slice(n.length).replace(/^[.\s]+/, "") || null;
  };

  const fields = (t?: Item["todo"], prefix = fixed?.goalId ? `new-${fixed.goalId}` : "new") => (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field id={`${prefix}-title`} label="What needs doing" name="title" defaultValue={t?.title} required />
      <Field id={`${prefix}-due`} label="Due" name="due_on" type="date" defaultValue={t?.due_on} />
      <Select id={`${prefix}-assigned`} label="Given to" name="assigned_to" options={teamOptions} includeBlank="Nobody yet" defaultValue={t?.assigned_to ?? (t ? null : me)} />
      <Select id={`${prefix}-priority`} label="Priority" name="priority" options={PRIORITIES} defaultValue={t?.priority ?? "normal"} />
      {t?.project_goal_id || fixed?.goalId ? (
        <input type="hidden" name="topic" value="projects" />
      ) : (
        <Select id={`${prefix}-topic`} label="Topic" name="topic" options={TOPICS as Record<string, string>} defaultValue={t?.topic ?? "actions"} />
      )}
      {fixed?.goalId && <input type="hidden" name="project_goal_id" value={fixed.goalId} />}
      {fixed?.entityId ? (
        <input type="hidden" name="entity_id" value={fixed.entityId} />
      ) : fixed?.goalId || t?.project_goal_id ? null : (
        <Select id={`${prefix}-entity`} label="About an entity" name="entity_id" options={entities} includeBlank="None" defaultValue={t?.entity_id} />
      )}
      {fixed?.personId ? (
        <input type="hidden" name="person_id" value={fixed.personId} />
      ) : fixed?.goalId || t?.project_goal_id ? null : (
        <Select id={`${prefix}-person`} label="About a person" name="person_id" options={people} includeBlank="None" defaultValue={t?.person_id} />
      )}
      <div className="sm:col-span-2">
        <TextArea id={`${prefix}-details`} label="Details" name="details" defaultValue={t?.details} rows={3} />
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      {canEdit && (
        <Box title={title} description={compact ? undefined : "What the records say needs doing is added by itself and clears once it is done there. Add anything else here."}>
          <Fold label="Add a to-do">
            <form action={addTodo.bind(null, familyId, here)} className="space-y-4">
              {fields()}
              <SubmitButton>Add to the list</SubmitButton>
            </form>
          </Fold>
        </Box>
      )}
      {open.length === 0 && <p className="rounded-lg border border-border bg-card px-4 py-3 text-ink-2">{compact ? "No open to-dos for this goal." : "Nothing to do. Everything is up to date."}</p>}
      {groups
        .filter(([, list]) => list.length > 0)
        .map(([g, list]) => (
          <Box key={g} title={compact ? `Open (${list.length})` : `${GROUPS[g]} (${list.length})`}>
            <ul className="divide-y divide-border border-y border-border">
              {list.map((i) => (
                <li key={i.key} className="space-y-1 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={i.href} className="text-[15px] font-medium text-ink hover:underline">
                        {i.title}
                      </Link>
                      <p className="text-sm text-ink-3">
                        {[
                          i.due ? (overdue(i.due) ? `Overdue – was due ${formatDate(i.due)}` : `Due ${formatDate(i.due)}`) : null,
                          i.todo ? (i.todo.assigned_to ? `Given to ${team.get(i.todo.assigned_to) ?? "a former team member"}` : "Not given to anyone") : "From the records",
                          i.todo && i.todo.priority !== "normal" ? `${PRIORITIES[i.todo.priority]} priority` : null,
                          i.entityId && !fixed?.entityId ? entities.find(([id]) => id === i.entityId)?.[1] : null,
                          i.personIds.length && !fixed?.personId ? i.personIds.map((p) => names.get(p)).filter(Boolean).join(", ") : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {detailOf(i) && <p className="whitespace-pre-wrap text-sm text-ink-2">{detailOf(i)}</p>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {overdue(i.due) && <Chip>Overdue</Chip>}
                      {i.todo && canEdit && (
                        <form action={setTodoStatus.bind(null, familyId, here, i.todo.id, "done")}>
                          <SubmitButton variant="secondary" pendingText="Saving…">
                            Mark done
                          </SubmitButton>
                        </form>
                      )}
                    </div>
                  </div>
                  {i.todo && canEdit && (
                    <div className="flex flex-wrap items-start gap-3">
                      <Fold label="Change">
                        <form action={updateTodo.bind(null, familyId, here, i.todo.id)} className="space-y-4">
                          {fields(i.todo, i.todo.id)}
                          <SubmitButton>Save</SubmitButton>
                        </form>
                      </Fold>
                      <ConfirmRemove action={removeTodo.bind(null, familyId, here, i.todo.id)} what={`the to-do "${i.todo.title}"`} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Box>
        ))}
      {done.length > 0 && (
        <Box title="Done">
          <Fold label={`Show what was done (${done.length})`}>
            <ul className="divide-y divide-border border-y border-border">
              {done.slice(0, 50).map((i) => (
                <li key={i.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-[15px] text-ink line-through decoration-ink-3">{i.title}</p>
                    <p className="text-sm text-ink-3">
                      Done {formatDate(londonDate(i.todo!.done_at))}
                      {i.todo!.done_by ? ` by ${team.get(i.todo!.done_by) ?? "a team member"}` : ""}
                    </p>
                  </div>
                  {canEdit && (
                    <form action={setTodoStatus.bind(null, familyId, here, i.todo!.id, "open")}>
                      <SubmitButton variant="quiet" pendingText="Saving…">
                        Put it back on the list
                      </SubmitButton>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </Fold>
        </Box>
      )}
    </div>
  );
}

function Plain({ title, description, children }: { title?: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-2">
      {title && <h3 className="text-sm font-semibold text-ink">{title}</h3>}
      {description && <p className="text-sm text-ink-2">{description}</p>}
      {children}
    </div>
  );
}
