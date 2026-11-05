import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageTitle } from "@/components/AppShell";
import { ConfirmRemove, SubmitButton, Toast } from "@/components/feedback";
import { Card, Field, Fold } from "@/components/ui";
import { getFamilyContext } from "@/lib/family-context";
import { errorMessage, savedMessage } from "@/lib/messages";
import { displayNames, type PersonSummary } from "@/lib/people";
import { THEMES, type Theme } from "@/lib/story";
import { TextArea } from "../meetings/DecisionsArea";
import { addChapter, removeChapter, updateChapter } from "./actions";
import { loadChapters, loadStories, myPersonId } from "./story-data";
import { AddStoryForm, StoryCard, type Look } from "./StoryParts";

export const dynamic = "force-dynamic";

type View = "family" | "all" | "sent";

// The Story: the family story in chapters, every story, and stories sent in.
export default async function StoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ familyId: string }>;
  searchParams: Promise<{ view?: string; theme?: string; person?: string; saved?: string; error?: string }>;
}) {
  const { familyId } = await params;
  const sp = await searchParams;
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db) notFound();
  const [chapters, stories, { data: peopleRows }, { data: branchRows }, me] = await Promise.all([
    loadChapters(ctx),
    loadStories(ctx),
    ctx.db.from("people").select("id, full_names, surname, known_as, birth_year").order("surname"),
    ctx.db.from("branches").select("id, name").order("name"),
    myPersonId(ctx),
  ]);
  const look: Look = { names: displayNames((peopleRows ?? []) as PersonSummary[]), branches: ((branchRows ?? []) as { id: string; name: string }[]).map((b) => [b.id, b.name]) };
  const view: View = sp.view === "all" ? "all" : sp.view === "sent" ? "sent" : "family";
  const published = stories.filter((s) => s.status === "published");
  const sent = stories.filter((s) => s.status !== "published");
  const theme = (Object.keys(THEMES) as Theme[]).find((t) => t === sp.theme);
  const person = sp.person && look.names.has(sp.person) ? sp.person : undefined;
  const listed = published.filter((s) => (!theme || s.themes.includes(theme)) && (!person || s.people.includes(person)));
  const base = `/families/${familyId}/story`;
  const familyName = /family$/i.test(ctx.family.name.trim()) ? ctx.family.name : `${ctx.family.name} family`;
  const waiting = sent.filter((s) => s.status === "suggested").length;
  const tabs: [View, string][] = [
    ["family", "The family story"],
    ["all", `All stories (${published.length})`],
    ...(ctx.canEdit || sent.length ? ([["sent", ctx.canEdit ? `Sent in (${waiting})` : `Sent in by me (${sent.length})`]] as [View, string][]) : []),
  ];

  return (
    <AppShell
      family={{ id: familyId, name: ctx.family.name }}
      section="story"
      crumbs={[["My families", "/"], [familyName, `/families/${familyId}`], ["The Story"]]}
      user={{ name: ctx.displayName, roleLabel: ctx.roleLabel, hasTwoFactor: ctx.hasTwoFactor }}
    >
      {sp.error && <Toast key={`e-${sp.error}-${Date.now()}`} kind="error" message={errorMessage(sp.error)!} />}
      {sp.saved && !sp.error && <Toast key={`s-${sp.saved}-${Date.now()}`} message={savedMessage(sp.saved)!} />}
      <PageTitle title="The Story" subtitle="The family's story, told in chapters, and the stories of its people. Each person's own stories are also in their Book of Life in the Tree." />
      <nav aria-label="The Story" className="border-b border-border">
        <ul className="flex flex-wrap gap-x-1">
          {tabs.map(([k, t]) => (
            <li key={k}>
              <Link
                href={k === "family" ? base : `${base}?view=${k}`}
                aria-current={view === k ? "page" : undefined}
                className={`inline-flex min-h-11 items-center border-b-2 px-3 text-[15px] ${view === k ? "border-primary font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
              >
                {t}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-6 space-y-5">
        {sp.error && <p className="alert">Not saved: {errorMessage(sp.error)}</p>}
        {me && !ctx.canEdit && (
          <p className="rounded-lg border border-border bg-card px-4 py-3 text-ink-2">
            Would you like to tell a story of your own?{" "}
            <Link href={`/families/${familyId}/tree/${me}?tab=story`} className="inline-flex min-h-11 items-center text-ink underline">
              Go to your Book of Life
            </Link>
            .
          </p>
        )}

        {view === "family" && (
          <>
            {chapters.map((c) => {
              const list = published.filter((s) => s.chapter_id === c.id);
              return (
                <section key={c.id} id={`chapter-${c.id}`} className="scroll-mt-6">
                  <Card title={c.title} description={c.description ?? undefined}>
                    {list.length === 0 ? (
                      <p className="text-ink-3">No stories in this chapter yet.</p>
                    ) : (
                      <ul className="divide-y divide-border border-y border-border">
                        {list.map((s) => (
                          <StoryCard key={s.id} s={s} familyId={familyId} look={look} />
                        ))}
                      </ul>
                    )}
                    {ctx.canEdit && (
                      <div className="mt-3 flex flex-wrap items-start gap-4">
                        <Fold label="Add a story to this chapter">
                          <AddStoryForm familyId={familyId} back={`${base}#chapter-${c.id}`} chapters={chapters} look={look} chapterId={c.id} />
                        </Fold>
                        <Fold label="Change the chapter">
                          <form action={updateChapter.bind(null, familyId, c.id)} className="space-y-4">
                            <Field id={`ch-${c.id}-title`} label="Title" name="title" required defaultValue={c.title} />
                            <TextArea id={`ch-${c.id}-desc`} label="What it covers" name="description" rows={2} defaultValue={c.description} />
                            <Field id={`ch-${c.id}-sort`} label="Order" name="sort" type="number" defaultValue={c.sort} />
                            <SubmitButton>Save</SubmitButton>
                          </form>
                        </Fold>
                        <ConfirmRemove action={removeChapter.bind(null, familyId, c.id)} what={`the chapter "${c.title}" (its stories stay, without a chapter)`} />
                      </div>
                    )}
                  </Card>
                </section>
              );
            })}
            {ctx.canEdit && (
              <Card title="Add a chapter">
                <Fold label="Add a chapter">
                  <form action={addChapter.bind(null, familyId)} className="space-y-4">
                    <Field label="Title" name="title" required />
                    <TextArea label="What it covers" name="description" rows={2} />
                    <Field label="Order" name="sort" type="number" defaultValue={(chapters.at(-1)?.sort ?? 0) + 10} />
                    <SubmitButton>Add the chapter</SubmitButton>
                  </form>
                </Fold>
              </Card>
            )}
          </>
        )}

        {view === "all" && (
          <>
            {ctx.canEdit && (
              <Card title="Add a story">
                <Fold label="Add a story">
                  <AddStoryForm familyId={familyId} back={`${base}?view=all`} chapters={chapters} look={look} />
                </Fold>
              </Card>
            )}
            <Card title="Stories">
              <form method="get" className="mb-3 flex flex-wrap items-end gap-3">
                <input type="hidden" name="view" value="all" />
                <div>
                  <label htmlFor="s-theme" className="mb-1 block text-sm font-medium text-ink">
                    Theme
                  </label>
                  <select id="s-theme" name="theme" defaultValue={theme ?? ""} className="text-input">
                    <option value="">All themes</option>
                    {(Object.keys(THEMES) as Theme[]).map((t) => (
                      <option key={t} value={t}>
                        {THEMES[t]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="s-person" className="mb-1 block text-sm font-medium text-ink">
                    About
                  </label>
                  <select id="s-person" name="person" defaultValue={person ?? ""} className="text-input">
                    <option value="">Anyone</option>
                    {[...look.names.entries()]
                      .sort((a, b) => a[1].localeCompare(b[1]))
                      .map(([id, n]) => (
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
              {listed.length === 0 ? (
                <p className="text-ink-3">No stories here yet.</p>
              ) : (
                <ul className="divide-y divide-border border-y border-border">
                  {listed.map((s) => (
                    <StoryCard key={s.id} s={s} familyId={familyId} look={look} />
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}

        {view === "sent" && (
          <Card
            title={ctx.canEdit ? "Stories sent in by family members" : "Stories I sent in"}
            description={ctx.canEdit ? "Read each one, change it if needed, then add it to the family's stories or decline it with a reason." : "The team reads each story before adding it."}
          >
            {sent.length === 0 ? (
              <p className="text-ink-3">Nothing sent in.</p>
            ) : (
              <ul className="divide-y divide-border border-y border-border">
                {[...sent]
                  .sort((a, b) => (a.status === b.status ? b.created_at.localeCompare(a.created_at) : a.status === "suggested" ? -1 : 1))
                  .map((s) => (
                    <StoryCard key={s.id} s={s} familyId={familyId} look={look} />
                  ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </AppShell>
  );
}
