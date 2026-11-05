"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getFamilyContext } from "@/lib/family-context";
import { isDate } from "@/lib/governance";
import type { SavedCode } from "@/lib/messages";
import { askToRemove } from "@/lib/removal";
import { cleanThemes } from "@/lib/story";

// The Story. Managers and Administrators write and change stories and
// chapters; a family member sends their own story in for the team to review;
// only a Manager changes who may read a story; removing takes two people.
// The family database checks all of this too.

function go(path: string, error?: string, saved: SavedCode = "saved"): never {
  revalidatePath(path.split("?")[0].split("#")[0], "layout");
  const [base, hash] = path.split("#");
  const params = new URLSearchParams(error ? { error } : { saved });
  redirect(`${base}${base.includes("?") ? "&" : "?"}${params.toString()}${hash ? `#${hash}` : ""}`);
}
function text(form: FormData, name: string) {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}
const optional = (form: FormData, name: string) => text(form, name) || null;
const uuid = (s: string) => (/^[0-9a-f-]{36}$/i.test(s) ? s : null);
const safeBack = (familyId: string, back: string) => (back.startsWith(`/families/${familyId}/`) && !back.includes("//") ? back : `/families/${familyId}/story`);
const storyPage = (familyId: string, id: string) => `/families/${familyId}/story/${id}`;

function friendly(m: string | undefined) {
  if (!m) return "Something went wrong.";
  if (/^Story: /.test(m)) return m.replace(/^Story: /, "");
  if (/row-level security/.test(m)) return "You don't have permission to change this.";
  if (/story_people_story_id_person_id_key/.test(m)) return "That person is already linked to the story.";
  return "That couldn't be saved. Please check the details and try again.";
}

async function editor(familyId: string, to: string) {
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db || !ctx.canEdit) go(to, "Only a Manager or Administrator can change the family's stories.");
  return ctx;
}

// When it happened, as exactly as it is known: worked out from what was
// filled in (an exact date; a month and year; or a year).
function when(form: FormData) {
  const year = text(form, "year");
  const month = text(form, "month_only");
  const day = text(form, "happened_on");
  if (day) return isDate(day) ? { date: day, precision: "day" } : { error: "Please enter the date as day, month and year." };
  if (!year) return month ? { error: "Please enter the year as well as the month." } : { date: null, precision: "year" };
  if (!/^\d{4}$/.test(year) || Number(year) < 1700 || Number(year) > 2200) return { error: "Please check the year." };
  if (month) return /^(0[1-9]|1[0-2])$/.test(month) ? { date: `${year}-${month}-01`, precision: "month" } : { error: "Please choose the month again." };
  return { date: `${year}-01-01`, precision: "year" };
}

function fields(form: FormData) {
  const title = text(form, "title");
  const body = text(form, "body");
  if (!title) return { error: "Please give the story a title." };
  if (!body) return { error: "Please tell the story." };
  const w = when(form);
  if (w.error) return { error: w.error };
  return {
    value: {
      title,
      body,
      told_by: optional(form, "told_by"),
      happened_on: w.date,
      precision: w.precision,
      place: optional(form, "place"),
      prompt: optional(form, "prompt"),
      themes: cleanThemes(form.getAll("themes").map(String)),
      chapter_id: uuid(text(form, "chapter_id")),
    },
  };
}

function audience(form: FormData) {
  const a = text(form, "audience") || "family";
  const branch = uuid(text(form, "branch_id"));
  if (a === "branch" && !branch) return { error: "Please choose the branch that may read it." };
  if (!["family", "branch", "people"].includes(a)) return { error: "Please choose who may read it." };
  return { value: { audience: a, branch_id: a === "branch" ? branch : null } };
}

export async function addStory(familyId: string, back: string, form: FormData) {
  const to = safeBack(familyId, back);
  const ctx = await editor(familyId, to);
  const f = fields(form);
  if (f.error || !f.value) go(to, f.error);
  const a = audience(form);
  if (a.error || !a.value) go(to, a.error);
  const people = [...new Set(form.getAll("people").map(String).filter((p) => uuid(p)))];
  if (a.value.audience === "people" && people.length === 0) go(to, "Please choose the people the story is about, as only they (and the team) may read it.");
  const { data, error } = await ctx.db!.rpc("add_story", { p_story: { ...f.value, ...a.value }, p_people: people });
  if (error || !data) go(to, friendly(error?.message));
  go(storyPage(familyId, data as string), undefined, "story_added");
}

export async function updateStory(familyId: string, storyId: string, form: FormData) {
  const to = storyPage(familyId, storyId);
  const ctx = await editor(familyId, to);
  const f = fields(form);
  if (f.error || !f.value) go(to, f.error);
  let change: Record<string, unknown> = f.value;
  if (ctx.canManage && form.has("audience")) {
    const a = audience(form);
    if (a.error || !a.value) go(to, a.error);
    if (a.value.audience === "people") {
      const { count } = await ctx.db!.from("story_people").select("id", { count: "exact", head: true }).eq("story_id", storyId);
      if (!count) go(to, "Please link the people the story is about first, as only they (and the team) may read it.");
    }
    change = { ...change, ...a.value };
  }
  const { error } = await ctx.db!.from("stories").update(change).eq("id", storyId);
  go(to, error ? friendly(error.message) : undefined, "story_saved");
}

export async function linkPerson(familyId: string, storyId: string, form: FormData) {
  const to = storyPage(familyId, storyId);
  const ctx = await editor(familyId, to);
  if (!ctx.canManage) go(to, "Only a Manager can add people to a story once it is saved, because it changes who may read it.");
  const person = uuid(text(form, "person_id"));
  if (!person) go(to, "Please choose a person.");
  const { error } = await ctx.db!.from("story_people").insert({ story_id: storyId, person_id: person });
  go(to, error ? friendly(error.message) : undefined, "story_person_added");
}

export async function unlinkPerson(familyId: string, storyId: string, linkId: string) {
  const ctx = await getFamilyContext(familyId);
  const error = await askToRemove(ctx, "story_people", linkId, { story_id: storyId });
  go(storyPage(familyId, storyId), error ?? undefined, "removal_requested");
}

export async function reviewStory(familyId: string, storyId: string, decision: "published" | "declined", form: FormData) {
  const to = storyPage(familyId, storyId);
  const ctx = await editor(familyId, to);
  if (decision !== "published" && decision !== "declined") go(to, "That isn't possible.");
  const note = optional(form, "review_note");
  if (decision === "declined" && !note) go(to, "Please say why, so the family member knows.");
  const { data, error } = await ctx.db!.from("stories").update({ status: decision, review_note: note }).eq("id", storyId).eq("status", "suggested").select("id");
  if (!error && !data?.length) go(to, "That story has already been reviewed.");
  go(to, error ? friendly(error.message) : undefined, decision === "published" ? "story_accepted" : "story_declined");
}

export async function removeStory(familyId: string, storyId: string) {
  const ctx = await getFamilyContext(familyId);
  const error = await askToRemove(ctx, "stories", storyId);
  go(error ? storyPage(familyId, storyId) : `/families/${familyId}/story`, error ?? undefined, "removal_requested");
}

export async function addChapter(familyId: string, form: FormData) {
  const to = `/families/${familyId}/story`;
  const ctx = await editor(familyId, to);
  const title = text(form, "title");
  if (!title) go(to, "Please give the chapter a title.");
  const { error } = await ctx.db!.from("story_chapters").insert({ title, description: optional(form, "description"), sort: Number(text(form, "sort")) || 100 });
  go(to, error ? friendly(error.message) : undefined, "chapter_added");
}

export async function updateChapter(familyId: string, chapterId: string, form: FormData) {
  const to = `/families/${familyId}/story#chapter-${chapterId}`;
  const ctx = await editor(familyId, to);
  const title = text(form, "title");
  if (!title) go(to, "Please give the chapter a title.");
  const { error } = await ctx.db!.from("story_chapters").update({ title, description: optional(form, "description"), sort: Number(text(form, "sort")) || 100 }).eq("id", chapterId);
  go(to, error ? friendly(error.message) : undefined, "chapter_saved");
}

export async function removeChapter(familyId: string, chapterId: string) {
  const ctx = await getFamilyContext(familyId);
  const error = await askToRemove(ctx, "story_chapters", chapterId);
  go(`/families/${familyId}/story`, error ?? undefined, "removal_requested");
}

// A family member sends in their own story (from their Book of Life).
export async function suggestStory(familyId: string, back: string, form: FormData) {
  const to = safeBack(familyId, back);
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db) go(to, "That isn't possible.");
  const title = text(form, "title");
  const body = text(form, "body");
  if (!title || !body) go(to, "Please give your story a title and tell it.");
  const w = when(form);
  if (w.error) go(to, w.error);
  const { error } = await ctx.db.rpc("suggest_story", {
    p_title: title,
    p_body: body,
    p_happened_on: w.date,
    p_precision: w.precision,
    p_place: optional(form, "place"),
    p_prompt: optional(form, "prompt"),
  });
  go(to, error ? friendly(error.message) : undefined, "story_sent");
}
