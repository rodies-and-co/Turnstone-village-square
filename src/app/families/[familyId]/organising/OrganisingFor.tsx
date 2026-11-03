import Link from "next/link";
import { Card } from "@/components/ui";
import type { FamilyContext } from "@/lib/family-context";
import { formatDate } from "@/lib/governance";
import { addDays, CALENDAR_KINDS, loadOrganising, loadTeam } from "./organising-data";
import { TodoList } from "./TodoList";

// One entity's or one person's part of the to-do list, and what is coming up
// for them in the calendar (shown on their own page).
export async function OrganisingFor({
  ctx,
  familyId,
  names,
  entityId,
  personId,
  here,
}: {
  ctx: FamilyContext;
  familyId: string;
  names: Map<string, string>;
  entityId?: string;
  personId?: string;
  here: string;
}) {
  const [{ items, entries, now, entityName }, team] = await Promise.all([loadOrganising(ctx, names), loadTeam(ctx)]);
  const mine = (x: { entityId: string | null; personIds: string[] }) => (entityId ? x.entityId === entityId : x.personIds.includes(personId!));
  const coming = entries
    .filter(mine)
    .filter((e) => (e.endDate ?? e.date) >= now && e.date <= addDays(now, 365))
    .sort((a, b) => a.date.localeCompare(b.date));
  const past = entries
    .filter(mine)
    .filter((e) => (e.endDate ?? e.date) < now && e.date >= addDays(now, -365))
    .sort((a, b) => b.date.localeCompare(a.date));
  const entities = [...entityName.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const row = (e: (typeof entries)[number]) => (
    <li key={e.key} className="py-3">
      <p className="text-sm text-ink-3">
        {formatDate(e.date)}
        {e.endDate && e.endDate !== e.date ? ` to ${formatDate(e.endDate)}` : ""}
        {e.time ? `, ${e.time}` : ""} · {CALENDAR_KINDS[e.kind]}
      </p>
      <Link href={e.href} className="text-[15px] font-medium text-ink hover:underline">
        {e.title}
      </Link>
      {e.detail && <p className="text-sm text-ink-2">{e.detail}</p>}
    </li>
  );
  return (
    <div className="space-y-5">
      <Card
        title="Coming up"
        description="From the family calendar: meetings, filings, payments, to-dos, family dates and passport expiry, over the next 12 months."
        actions={
          <Link href={`/families/${familyId}/organising?view=calendar`} className="btn-secondary">
            The whole calendar
          </Link>
        }
      >
        {coming.length ? <ul className="divide-y divide-border border-y border-border">{coming.map(row)}</ul> : <p className="border-y border-border py-3 text-ink-3">Nothing coming up.</p>}
        {past.length > 0 && (
          <details className="fold mt-3">
            <summary>The last 12 months ({past.length})</summary>
            <ul className="mt-2 divide-y divide-border border-y border-border">{past.map(row)}</ul>
          </details>
        )}
      </Card>
      {ctx.canEdit && (
        <TodoList
          familyId={familyId}
          items={items.filter(mine)}
          team={team}
          names={names}
          entities={entities}
          here={here}
          now={now}
          me={ctx.user?.id ?? ""}
          canEdit={ctx.canEdit}
          fixed={entityId ? { entityId } : { personId }}
          title="To do"
        />
      )}
    </div>
  );
}
