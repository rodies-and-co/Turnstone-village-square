import "server-only";
import type { FamilyContext } from "@/lib/family-context";
import type { Audience, Theme } from "@/lib/story";
import type { Precision } from "@/lib/timeline";

// The Story: chapters of the family story, and stories. Every read runs as the
// signed-in person, so each sees only the stories meant for them.

export type Chapter = { id: string; title: string; description: string | null; sort: number };
export type Story = {
  id: string;
  title: string;
  body: string;
  told_by: string | null;
  happened_on: string | null;
  precision: Precision;
  place: string | null;
  prompt: string | null;
  themes: Theme[];
  chapter_id: string | null;
  timeline_event_id: string | null;
  audience: Audience;
  branch_id: string | null;
  status: "suggested" | "published" | "declined";
  submitted_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  people: string[];
};

export async function loadChapters(ctx: FamilyContext) {
  const { data } = await ctx.db!.from("story_chapters").select("id, title, description, sort").order("sort").order("title");
  return (data ?? []) as Chapter[];
}

export async function loadStories(ctx: FamilyContext, filter?: { storyId?: string }) {
  let q = ctx.db!.from("stories").select("*, story_people(person_id)").order("happened_on", { ascending: true, nullsFirst: false }).order("created_at");
  if (filter?.storyId) q = q.eq("id", filter.storyId);
  const { data } = await q;
  return ((data ?? []) as (Omit<Story, "people"> & { story_people: { person_id: string }[] })[]).map(({ story_people, ...s }) => ({ ...s, people: (story_people ?? []).map((p) => p.person_id) })) as Story[];
}

// The person linked to the signed-in login, if any (for "tell your story").
export async function myPersonId(ctx: FamilyContext) {
  if (!ctx.user?.id) return null;
  const { data } = await ctx.db!.from("people").select("id").eq("user_id", ctx.user.id).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}
