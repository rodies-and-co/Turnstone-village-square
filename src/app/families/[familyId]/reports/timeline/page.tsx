import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageTitle } from "@/components/AppShell";
import { ConfirmRemove, SubmitButton, Toast } from "@/components/feedback";
import { Card, Field, Fold, Select } from "@/components/ui";
import { getFamilyContext } from "@/lib/family-context";
import { errorMessage, savedMessage } from "@/lib/messages";
import { KIND_MARK, TIMELINE_KINDS, arrange, dateText, parseKinds, type TimelineKind } from "@/lib/timeline";
import { TextArea } from "../../meetings/DecisionsArea";
import { addTimelineEvent, removeTimelineEvent } from "../actions";
import { loadTimeline } from "../timeline-data";

export const dynamic = "force-dynamic";

const TONE: Record<TimelineKind, string> = {
  family: "border-l-[#2f5d50]",
  entities: "border-l-ink",
  governance: "border-l-bronze",
  added: "border-l-primary",
};

// The family / branch timeline: life events, entities and ownership,
// governance and events added by hand, each switched on or off.
export default async function TimelinePage({
  params,
  searchParams,
}: {
  params: Promise<{ familyId: string }>;
  searchParams: Promise<{ kind?: string | string[]; show?: string; branch?: string; person?: string; q?: string; order?: string; saved?: string; error?: string }>;
}) {
  const { familyId } = await params;
  const sp = await searchParams;
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db) notFound();
  const t = await loadTimeline(ctx);
  const kinds = parseKinds(sp.kind, sp.show);
  const branch = t.branches.find(([id]) => id === sp.branch)?.[0];
  const person = t.people.find(([id]) => id === sp.person)?.[0];
  const newestFirst = sp.order === "newest";
  const { count, years } = arrange(t.items, { kinds, personId: person, words: sp.q, newestFirst, branchOf: branch ? (i) => t.inBranch(i, branch) : undefined });
  const familyName = /family$/i.test(ctx.family.name.trim()) ? ctx.family.name : `${ctx.family.name} family`;
  const params2 = new URLSearchParams();
  for (const k of kinds) params2.append("kind", k);
  if (branch) params2.set("branch", branch);
  if (person) params2.set("person", person);
  if (sp.q) params2.set("q", sp.q);
  if (newestFirst) params2.set("order", "newest");
  const here = `/families/${familyId}/reports/timeline?${params2.toString()}`;

  return (
    <AppShell
      family={{ id: familyId, name: ctx.family.name }}
      section="timeline"
      crumbs={[["My families", "/"], [familyName, `/families/${familyId}`], ["Reports", `/families/${familyId}/reports`], ["Timeline"]]}
      user={{ name: ctx.displayName, roleLabel: ctx.roleLabel, hasTwoFactor: ctx.hasTwoFactor }}
    >
      {sp.error && <Toast key={`e-${sp.error}-${Date.now()}`} kind="error" message={errorMessage(sp.error)!} />}
      {sp.saved && !sp.error && <Toast key={`s-${sp.saved}-${Date.now()}`} message={savedMessage(sp.saved)!} />}
      <PageTitle title="Family timeline" subtitle="The turning points in the family's life, its entities and its governance, from the records. Untick what you don't want to see." />
      <div className="mt-6 space-y-5">
        {sp.error && <p className="alert">Not saved: {errorMessage(sp.error)}</p>}
        <Card title="Show">
          <form method="get" className="space-y-4">
            <input type="hidden" name="show" value="" />
            <fieldset className="flex flex-wrap items-center gap-x-5">
              <legend className="mb-1 text-sm font-medium text-ink">What to show</legend>
              {(Object.keys(TIMELINE_KINDS) as TimelineKind[]).map((k) => (
                <label key={k} className="flex min-h-11 items-center gap-2 text-sm text-ink">
                  <input type="checkbox" name="kind" value={k} defaultChecked={kinds.includes(k)} className="h-5 w-5" />
                  <span aria-hidden="true" className={`inline-grid h-5 w-5 place-items-center rounded border-l-4 bg-card text-[10px] font-bold ${TONE[k]}`}>
                    {KIND_MARK[k]}
                  </span>
                  {TIMELINE_KINDS[k]}
                </label>
              ))}
            </fieldset>
            <div className="flex flex-wrap items-end gap-3">
              <Select label="Branch" name="branch" options={t.branches} includeBlank="The whole family" defaultValue={branch ?? ""} />
              <Select label="Person" name="person" options={t.people} includeBlank="Everyone" defaultValue={person ?? ""} />
              <Field label="Words" name="q" defaultValue={sp.q} />
              <Select label="Order" name="order" options={{ oldest: "Oldest first", newest: "Newest first" }} defaultValue={newestFirst ? "newest" : "oldest"} />
              <button type="submit" className="btn-secondary">
                Show
              </button>
            </div>
          </form>
        </Card>

        {ctx.canEdit && (
          <Card title="Add an event" description="Turning points that aren't recorded anywhere else: a move, the sale of the business, a family crisis. Births, marriages, meetings and the like are added by themselves.">
            <Fold label="Add an event">
              <form action={addTimelineEvent.bind(null, familyId, here)} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Field label="What happened" name="title" required />
                  </div>
                  <Select label="How exact is the date?" name="precision" options={{ day: "The day is known", month: "Only the month", year: "Only the year" }} defaultValue="day" />
                  <Field label="Date (if the day is known)" name="happened_on" type="date" />
                  <Select
                    label="Month (if only the month is known)"
                    name="month_only"
                    includeBlank="Choose…"
                    options={["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((m, i) => [String(i + 1).padStart(2, "0"), m] as [string, string])}
                  />
                  <Field label="Year (if only the month or year is known)" name="year" type="number" hint="E.g. 1998." />
                  <Select label="Kind" name="category" options={{ family: "Family", business: "Business", governance: "Governance", other: "Other" }} defaultValue="family" />
                  <Select
                    label="About"
                    name="about"
                    includeBlank="The whole family"
                    options={[...t.entities.map(([id, n]) => [`entity:${id}`, n] as [string, string]), ...t.branches.map(([id, n]) => [`branch:${id}`, n] as [string, string])]}
                    hint="Who may see it follows this, and the people below."
                  />
                </div>
                <TextArea label="Details" name="details" rows={3} hint="Keep personal matters general: this is seen by everyone who may see what it is about." />
                <div>
                  <label htmlFor="tl-people" className="mb-1 block text-sm font-medium text-ink">
                    People it is about
                  </label>
                  <select id="tl-people" name="people" multiple size={Math.min(6, Math.max(3, t.people.length))} className="text-input h-auto">
                    {t.people.map(([id, n]) => (
                      <option key={id} value={id}>
                        {n}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-ink-3">Optional. Only those who may see every person linked will see it. Hold Ctrl (or Cmd on a Mac) to choose more than one.</p>
                </div>
                <SubmitButton>Add to the timeline</SubmitButton>
              </form>
            </Fold>
          </Card>
        )}

        <p className="text-sm text-ink-2">
          {count} {count === 1 ? "event" : "events"}
          {ctx.canEdit ? "" : ". Full dates of birth and death show only to the family's team and the person themself."}
        </p>
        {years.length === 0 && <p className="rounded-lg border border-border bg-card px-4 py-3 text-ink-2">Nothing to show. Try ticking more kinds, or clearing the filters.</p>}
        {years.map(([year, list]) => (
          <section key={year} aria-labelledby={`y-${year}`}>
            <h2 id={`y-${year}`} className="sticky top-0 z-10 bg-background py-2 text-lg font-semibold text-ink">
              {year}
            </h2>
            <ol className="space-y-2 border-l-2 border-border pl-4">
              {list.map((i) => (
                <li key={i.key} className={`rounded-lg border border-border border-l-4 bg-card px-4 py-3 ${TONE[i.kind]}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-ink-3">
                        {dateText(i.date, i.precision)} · {TIMELINE_KINDS[i.kind]}
                      </p>
                      {i.href ? (
                        <Link href={i.href} className="inline-flex min-h-11 items-center text-[15px] font-medium text-ink hover:underline">
                          {i.title}
                        </Link>
                      ) : (
                        <p className="text-[15px] font-medium text-ink">{i.title}</p>
                      )}
                      {i.detail && <p className="whitespace-pre-wrap text-sm text-ink-2">{i.detail}</p>}
                      {i.kind === "added" && i.personIds.length > 0 && <p className="text-sm text-ink-3">About: {i.personIds.map((p) => t.names.get(p) ?? "someone you can't see").join(", ")}</p>}
                    </div>
                    {i.kind === "added" && ctx.canEdit && <ConfirmRemove action={removeTimelineEvent.bind(null, familyId, here, i.key.slice(6))} what={`"${i.title}" from the timeline`} />}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </AppShell>
  );
}
