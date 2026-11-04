import Link from "next/link";
import { ConfirmRemove, SubmitButton } from "@/components/feedback";
import { Card, Field, Fold, Select } from "@/components/ui";
import { formatDate } from "@/lib/governance";
import { inMonth, monthGrid, monthName, on, shiftMonth } from "@/lib/organising";
import { TextArea } from "../meetings/DecisionsArea";
import { addEvent, removeEvent } from "./actions";
import { CALENDAR_KINDS, type CalendarEntry, type CalendarEvent, type CalendarKind } from "./organising-data";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// Each kind has a mark as well as a colour, so colour never carries meaning alone.
const MARK: Record<CalendarKind, string> = { meetings: "M", filings: "F", payments: "P", risks: "R", projects: "J", todos: "T", events: "D", passports: "X" };
const TONE: Record<CalendarKind, string> = {
  meetings: "border-l-ink",
  filings: "border-l-primary",
  payments: "border-l-bronze",
  risks: "border-l-[#8f2a1d]",
  projects: "border-l-[#2f5d50]",
  todos: "border-l-ink-3",
  events: "border-l-ink-2",
  passports: "border-l-border",
};

// Month and list views of meetings, filings, payment dates, to-dos, family
// dates and passport expiry, each kind switched on or off.
export function CalendarView({
  familyId,
  entries,
  events,
  month,
  shown,
  base,
  now,
  canEdit,
  entities,
  branches,
  names,
}: {
  familyId: string;
  entries: CalendarEntry[];
  events: CalendarEvent[];
  month: string;
  shown: CalendarKind[];
  // The page's address without month or kinds, e.g. ".../organising?view=calendar".
  base: string;
  now: string;
  canEdit: boolean;
  entities: [string, string][];
  branches: [string, string][];
  names: Map<string, string>;
}) {
  const visible = inMonth(
    month,
    entries.filter((e) => shown.includes(e.kind)),
  ).sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? ""));
  const sep = base.includes("?") ? "&" : "?";
  const link = (m: string, kinds = shown) => `${base}${sep}month=${m}&show=${kinds.join(",")}`;
  const here = link(month);
  const myEvents = new Map(events.map((e) => [e.id, e]));

  return (
    <div className="space-y-5">
      <Card title={monthName(month)}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <Link href={link(shiftMonth(month, -1))} className="btn-secondary" aria-label="Previous month">
              ‹ {monthName(shiftMonth(month, -1)).split(" ")[0]}
            </Link>
            <Link href={link(now.slice(0, 7))} className="btn-secondary">
              This month
            </Link>
            <Link href={link(shiftMonth(month, 1))} className="btn-secondary" aria-label="Next month">
              {monthName(shiftMonth(month, 1)).split(" ")[0]} ›
            </Link>
          </div>
          <form method="get" action={base.split("?")[0]} className="flex flex-wrap items-center gap-x-4">
            {base.includes("?") &&
              [...new URLSearchParams(base.split("?")[1]).entries()].map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <input type="hidden" name="month" value={month} />
            <input type="hidden" name="show" value="" />
            <fieldset className="flex flex-wrap items-center gap-x-4">
              <legend className="sr-only">Show</legend>
              {(Object.keys(CALENDAR_KINDS) as CalendarKind[]).map((k) => (
                <label key={k} className="flex min-h-11 items-center gap-2 text-sm text-ink">
                  <input type="checkbox" name="kind" value={k} defaultChecked={shown.includes(k)} className="h-5 w-5" />
                  <span aria-hidden="true" className={`inline-grid h-5 w-5 place-items-center rounded border-l-4 bg-card text-[10px] font-bold ${TONE[k]}`}>
                    {MARK[k]}
                  </span>
                  {CALENDAR_KINDS[k]}
                </label>
              ))}
            </fieldset>
            <button type="submit" className="btn-quiet">
              Show
            </button>
          </form>
        </div>

        {/* The month grid, on wider screens. */}
        <div className="hidden md:block">
          <table className="w-full table-fixed border-collapse text-sm">
            <thead>
              <tr>
                {WEEKDAYS.map((d) => (
                  <th key={d} scope="col" className="border-b border-ink py-1.5 text-left font-semibold text-ink">
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monthGrid(month).map((week) => (
                <tr key={week[0]}>
                  {week.map((day) => {
                    const list = on(day, visible);
                    const inThisMonth = day.startsWith(month);
                    return (
                      <td key={day} className={`h-28 border border-border p-1 align-top ${inThisMonth ? "bg-white" : "bg-muted"} ${day === now ? "outline outline-2 -outline-offset-2 outline-ink" : ""}`}>
                        <p className={`text-xs ${inThisMonth ? "text-ink" : "text-ink-3"} ${day === now ? "font-bold" : ""}`}>
                          {Number(day.slice(8))}
                          {day === now && <span className="sr-only"> (today)</span>}
                        </p>
                        <ul className="mt-1 space-y-1">
                          {list.slice(0, 4).map((e) => (
                            <li key={e.key + day}>
                              <Link href={e.href} className={`block truncate rounded border-l-4 bg-card px-1 text-xs text-ink hover:underline ${TONE[e.kind]}`} title={e.title}>
                                <span className="sr-only">{CALENDAR_KINDS[e.kind]}: </span>
                                {e.time ? `${e.time} ` : ""}
                                {e.title}
                              </Link>
                            </li>
                          ))}
                          {list.length > 4 && <li className="text-xs text-ink-3">and {list.length - 4} more (see the list)</li>}
                        </ul>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* The same month as a list (the only view on a phone). */}
        <h3 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-ink-3">In {monthName(month)}</h3>
        {visible.length === 0 ? (
          <p className="border-y border-border py-3 text-ink-3">Nothing this month.</p>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {visible.map((e) => {
              const ev = e.key.startsWith("event:") ? myEvents.get(e.key.slice(6)) : undefined;
              return (
                <li key={e.key} id={ev ? `event-${ev.id}` : undefined} className={`flex flex-wrap items-start justify-between gap-3 border-l-4 py-3 pl-3 ${TONE[e.kind]}`}>
                  <div className="min-w-0">
                    <p className="text-sm text-ink-3">
                      {formatDate(e.date)}
                      {e.endDate && e.endDate !== e.date ? ` to ${formatDate(e.endDate)}` : ""}
                      {e.time ? `, ${e.time}` : ""} · {CALENDAR_KINDS[e.kind]}
                    </p>
                    <Link href={e.href} className="text-[15px] font-medium text-ink hover:underline">
                      {e.title}
                    </Link>
                    {e.detail && <p className="text-sm text-ink-2">{e.detail}</p>}
                    {ev?.details && <p className="whitespace-pre-wrap text-sm text-ink-2">{ev.details}</p>}
                    {e.personIds.length > 0 && <p className="text-sm text-ink-3">With: {e.personIds.map((p) => names.get(p) ?? "someone you can't see").join(", ")}</p>}
                  </div>
                  {ev && canEdit && <ConfirmRemove action={removeEvent.bind(null, familyId, here, ev.id)} what={`"${ev.title}" from the calendar`} />}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {canEdit && (
        <Card title="Add to the calendar" description="Family dates such as a Family Assembly, a retreat or a birthday celebration. Meetings, filings and payments are added by themselves.">
          <Fold label="Add a date">
            <form action={addEvent.bind(null, familyId, here)} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Title" name="title" required />
                <Select label="Kind" name="kind" options={{ family: "Family", personal: "Personal", deadline: "Deadline", reminder: "Reminder", other: "Other" }} defaultValue="family" />
                <Field label="Date" name="starts_on" type="date" required defaultValue={`${month}-01` < now && now.startsWith(month) ? now : `${month}-01`} />
                <Field label="Until (if more than one day)" name="ends_on" type="date" />
                <Field label="Time" name="starts_at" type="time" />
                <Field label="Place" name="location" />
                <Select
                  label="About"
                  name="about"
                  includeBlank="The whole family"
                  options={[
                    ...entities.map(([id, n]) => [`entity:${id}`, n] as [string, string]),
                    ...branches.map(([id, n]) => [`branch:${id}`, `${n} branch`] as [string, string]),
                  ]}
                  hint="Who may see it follows this, and the people below."
                />
              </div>
              <TextArea label="Details" name="details" rows={3} />
              <div>
                <label htmlFor="event-people" className="mb-1 block text-sm font-medium text-ink">
                  People it is about
                </label>
                <select id="event-people" name="people" multiple size={Math.min(6, Math.max(3, names.size))} className="text-input h-auto">
                  {[...names.entries()]
                    .sort((a, b) => a[1].localeCompare(b[1]))
                    .map(([id, n]) => (
                      <option key={id} value={id}>
                        {n}
                      </option>
                    ))}
                </select>
                <p className="mt-1 text-xs text-ink-3">Optional. It also shows on their record in the Tree. Hold Ctrl (or Cmd on a Mac) to choose more than one.</p>
              </div>
              <SubmitButton>Add to the calendar</SubmitButton>
            </form>
          </Fold>
        </Card>
      )}
    </div>
  );
}

// Which kinds to show: from "?show=meetings,filings" or ticked boxes
// ("?kind=meetings&kind=filings"); everything when nothing is chosen.
export function parseShown(show: string | undefined, kinds: string | string[] | undefined): CalendarKind[] {
  const all = Object.keys(CALENDAR_KINDS) as CalendarKind[];
  const picked = [...(Array.isArray(kinds) ? kinds : kinds ? [kinds] : []), ...(show ? show.split(",") : [])].filter((k): k is CalendarKind =>
    (all as string[]).includes(k),
  );
  return picked.length ? [...new Set(picked)] : all;
}
