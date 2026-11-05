import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageTitle } from "@/components/AppShell";
import { ConfirmRemove, SubmitButton, Toast } from "@/components/feedback";
import { Card, Fold, Select } from "@/components/ui";
import { getFamilyContext } from "@/lib/family-context";
import { errorMessage, savedMessage } from "@/lib/messages";
import { displayNames, type PersonSummary } from "@/lib/people";
import { AUDIENCES, THEMES } from "@/lib/story";
import { dateText } from "@/lib/timeline";
import { TextArea } from "../../meetings/DecisionsArea";
import { linkPerson, removeStory, reviewStory, unlinkPerson, updateStory } from "../actions";
import { loadChapters, loadStories } from "../story-data";
import { AudienceFields, StoryFields, type Look } from "../StoryParts";

export const dynamic = "force-dynamic";

export default async function StoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ familyId: string; storyId: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { familyId, storyId } = await params;
  const sp = await searchParams;
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db) notFound();
  const [[story], chapters, { data: peopleRows }, { data: branchRows }, { data: linkRows }] = await Promise.all([
    loadStories(ctx, { storyId }),
    loadChapters(ctx),
    ctx.db.from("people").select("id, full_names, surname, known_as, birth_year").order("surname"),
    ctx.db.from("branches").select("id, name").order("name"),
    ctx.db.from("story_people").select("id, person_id").eq("story_id", storyId),
  ]);
  if (!story) notFound();
  const look: Look = { names: displayNames((peopleRows ?? []) as PersonSummary[]), branches: ((branchRows ?? []) as { id: string; name: string }[]).map((b) => [b.id, b.name]) };
  const links = (linkRows ?? []) as { id: string; person_id: string }[];
  const chapter = chapters.find((c) => c.id === story.chapter_id);
  const branchName = look.branches.find(([id]) => id === story.branch_id)?.[1];
  const familyName = /family$/i.test(ctx.family.name.trim()) ? ctx.family.name : `${ctx.family.name} family`;
  const people = [...look.names.entries()].filter(([id]) => !story.people.includes(id)).sort((a, b) => a[1].localeCompare(b[1]));

  return (
    <AppShell
      family={{ id: familyId, name: ctx.family.name }}
      section="story"
      crumbs={[["My families", "/"], [familyName, `/families/${familyId}`], ["The Story", `/families/${familyId}/story`], [story.title]]}
      user={{ name: ctx.displayName, roleLabel: ctx.roleLabel, hasTwoFactor: ctx.hasTwoFactor }}
    >
      {sp.error && <Toast key={`e-${sp.error}-${Date.now()}`} kind="error" message={errorMessage(sp.error)!} />}
      {sp.saved && !sp.error && <Toast key={`s-${sp.saved}-${Date.now()}`} message={savedMessage(sp.saved)!} />}
      <PageTitle
        title={story.title}
        subtitle={[story.happened_on ? dateText(story.happened_on, story.precision) : null, story.place, chapter ? `Chapter: ${chapter.title}` : null].filter(Boolean).join(" · ") || undefined}
      />
      <div className="mt-6 space-y-5">
        {sp.error && <p className="alert">Not saved: {errorMessage(sp.error)}</p>}
        {story.status === "suggested" && (
          <div className="alert">
            Sent in by a family member and waiting for the team. Until it is added, only they and the team can see it.
          </div>
        )}
        {story.status === "declined" && <div className="alert">Not added{story.review_note ? `: ${story.review_note}` : "."}</div>}

        <Card>
          {story.prompt && <p className="mb-3 text-sm italic text-ink-2">{story.prompt}</p>}
          <div className="max-w-prose whitespace-pre-wrap text-[17px] leading-relaxed text-ink">{story.body}</div>
          <dl className="mt-5 grid gap-x-6 gap-y-2 border-t border-border pt-4 text-sm sm:grid-cols-2">
            {story.told_by && (
              <div>
                <dt className="text-ink-3">Told by</dt>
                <dd className="text-ink">{story.told_by}</dd>
              </div>
            )}
            <div>
              <dt className="text-ink-3">About</dt>
              <dd className="text-ink">
                {story.people.length
                  ? story.people.map((p, i) => (
                      <span key={p}>
                        {i ? ", " : ""}
                        <Link href={`/families/${familyId}/tree/${p}?tab=story`} className="inline-flex min-h-11 items-center underline">
                          {look.names.get(p) ?? "someone"}
                        </Link>
                      </span>
                    ))
                  : "The family"}
              </dd>
            </div>
            {story.themes.length > 0 && (
              <div>
                <dt className="text-ink-3">Themes</dt>
                <dd className="text-ink">{story.themes.map((t) => THEMES[t]).join(", ")}</dd>
              </div>
            )}
            {ctx.canEdit && (
              <div>
                <dt className="text-ink-3">Who may read it</dt>
                <dd className="text-ink">{story.audience === "branch" ? `${branchName ?? "One branch"}` : AUDIENCES[story.audience]}</dd>
              </div>
            )}
          </dl>
        </Card>

        {ctx.canEdit && story.status === "suggested" && (
          <Card title="Review" description="Change the story below if needed, then add it to the family's stories or decline it. Who may read it can be changed by a Manager.">
            <div className="flex flex-wrap items-start gap-4">
              <form action={reviewStory.bind(null, familyId, story.id, "published")}>
                <SubmitButton pendingText="Adding…">Add to the family&apos;s stories</SubmitButton>
              </form>
              <Fold label="Decline">
                <form action={reviewStory.bind(null, familyId, story.id, "declined")} className="space-y-3">
                  <TextArea id="decline-note" label="Why (the family member will see this)" name="review_note" rows={2} />
                  <SubmitButton variant="secondary">Decline</SubmitButton>
                </form>
              </Fold>
            </div>
          </Card>
        )}

        {ctx.canEdit && (
          <Card title="Change">
            <div className="flex flex-wrap items-start gap-4">
              <Fold label="Change the story">
                <form action={updateStory.bind(null, familyId, story.id)} className="space-y-4">
                  <StoryFields prefix="edit" s={story} chapters={chapters} />
                  {ctx.canManage ? (
                    <AudienceFields prefix="edit" s={story} look={look} />
                  ) : (
                    <p className="text-sm text-ink-3">Only a Manager can change who may read it, because it changes who sees it.</p>
                  )}
                  <SubmitButton>Save</SubmitButton>
                </form>
              </Fold>
              {ctx.canManage && (
              <Fold label="People it is about">
                <ul className="mb-3 divide-y divide-border border-y border-border">
                  {links.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-3 py-2">
                      <span>{look.names.get(l.person_id) ?? "Someone"}</span>
                      <ConfirmRemove action={unlinkPerson.bind(null, familyId, story.id, l.id)} what={`${look.names.get(l.person_id) ?? "this person"} from the story`} />
                    </li>
                  ))}
                  {links.length === 0 && <li className="py-2 text-ink-3">Nobody linked yet.</li>}
                </ul>
                <form action={linkPerson.bind(null, familyId, story.id)} className="flex flex-wrap items-end gap-3">
                  <Select label="Add a person" name="person_id" options={people} includeBlank="Choose…" />
                  <SubmitButton variant="secondary">Add</SubmitButton>
                </form>
                <p className="mt-2 text-xs text-ink-3">A Viewer sees a story only if they may see everyone it is about.</p>
              </Fold>
              )}
              <ConfirmRemove action={removeStory.bind(null, familyId, story.id)} what={`the story "${story.title}"`} />
            </div>
          </Card>
        )}
        <p>
          <Link href={`/families/${familyId}/story`} className="inline-flex min-h-11 items-center text-ink underline">
            Back to The Story
          </Link>
        </p>
      </div>
    </AppShell>
  );
}
