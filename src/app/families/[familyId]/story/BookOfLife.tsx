import Link from "next/link";
import { Card, Fold } from "@/components/ui";
import type { FamilyContext } from "@/lib/family-context";
import { PROMPTS, excerpt } from "@/lib/story";
import { TIMELINE_KINDS, dateText } from "@/lib/timeline";
import { loadTimeline } from "../reports/timeline-data";
import { loadChapters, loadStories, myPersonId } from "./story-data";
import { AddStoryForm, SuggestForm, type Look } from "./StoryParts";

// A person's Book of Life: their stories and their life events together, in
// date order, with prompts to help them tell their story.
export async function BookOfLife({ ctx, familyId, personId, here }: { ctx: FamilyContext; familyId: string; personId: string; here: string }) {
  const [stories, chapters, t, me] = await Promise.all([loadStories(ctx), loadChapters(ctx), loadTimeline(ctx), myPersonId(ctx)]);
  const mine = stories.filter((s) => s.people.includes(personId) && (s.status === "published" || ctx.canEdit || s.submitted_by === ctx.user?.id));
  const isMe = me === personId;
  const canTell = ctx.canEdit || isMe;
  const { data: branchRows } = await ctx.db!.from("branches").select("id, name").order("name");
  const look: Look = { names: t.names, branches: ((branchRows ?? []) as { id: string; name: string }[]).map((b) => [b.id, b.name]) };
  const name = t.names.get(personId) ?? "this person";

  // Stories and life events, in one list by date (undated stories last).
  type Row = { key: string; date: string | null; label: string; title: string; href?: string; detail?: string | null; story?: boolean; status?: string };
  const rows: Row[] = [
    ...mine.map((s) => ({
      key: `s:${s.id}`,
      date: s.happened_on,
      label: s.happened_on ? `${dateText(s.happened_on, s.precision)} · Story` : "Story",
      title: s.title,
      href: `/families/${familyId}/story/${s.id}`,
      detail: excerpt(s.body, 40),
      story: true,
      status: s.status,
    })),
    ...t.items
      .filter((i) => i.kind !== "stories" && i.personIds.includes(personId))
      .map((i) => ({ key: i.key, date: i.date, label: `${dateText(i.date, i.precision)} · ${TIMELINE_KINDS[i.kind]}`, title: i.title, href: i.href, detail: i.detail })),
  ].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999") || a.title.localeCompare(b.title));

  return (
    <div className="space-y-5">
      <Card title={`${name}'s Book of Life`} description="Their stories and the events of their life, in date order.">
        {rows.length === 0 ? (
          <p className="text-ink-3">Nothing yet. The prompts below can help to begin.</p>
        ) : (
          <ol className="space-y-2 border-l-2 border-border pl-4">
            {rows.map((r) => (
              <li key={r.key} className={`rounded-lg border border-border border-l-4 px-4 py-3 ${r.story ? "border-l-[#6b4e9b] bg-white" : "border-l-ink-3 bg-card"}`}>
                <p className="text-sm text-ink-3">{r.label}</p>
                {r.href ? (
                  <Link href={r.href} className={`inline-flex min-h-11 items-center text-ink hover:underline ${r.story ? "text-[16px] font-semibold" : "text-[15px] font-medium"}`}>
                    {r.title}
                  </Link>
                ) : (
                  <p className="text-[15px] font-medium text-ink">{r.title}</p>
                )}
                {r.detail && <p className="text-sm leading-relaxed text-ink-2">{r.detail}</p>}
                {r.status === "suggested" && <p className="mt-1 text-sm font-medium text-ink">Sent in – waiting for the team</p>}
                {r.status === "declined" && <p className="mt-1 text-sm font-medium text-ink">Not added</p>}
              </li>
            ))}
          </ol>
        )}
      </Card>

      {canTell && (
        <Card
          title={isMe && !ctx.canEdit ? "Tell your story" : "Add a story"}
          description={isMe && !ctx.canEdit ? "Write in your own words. The family's team reads each story before it is added." : `A story about ${name}. It shows here and in The Story.`}
        >
          <Fold label={isMe && !ctx.canEdit ? "Write a story" : "Add a story"}>
            {ctx.canEdit ? <AddStoryForm familyId={familyId} back={here} chapters={chapters} look={look} about={personId} /> : <SuggestForm familyId={familyId} back={here} />}
          </Fold>
          <h3 className="mb-1 mt-5 text-sm font-semibold text-ink">Prompts to help</h3>
          <ul className="divide-y divide-border border-y border-border">
            {PROMPTS.map((p, i) => (
              <li key={p} className="py-1">
                <Fold label={p}>
                  {ctx.canEdit ? (
                    <AddStoryForm familyId={familyId} back={here} chapters={chapters} look={look} about={personId} prompt={p} n={i} />
                  ) : (
                    <SuggestForm familyId={familyId} back={here} prompt={p} n={i} />
                  )}
                </Fold>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
