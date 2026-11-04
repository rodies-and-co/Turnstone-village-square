"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getFamilyContext } from "@/lib/family-context";
import { isDate } from "@/lib/governance";
import type { SavedCode } from "@/lib/messages";
import { STAGES } from "@/lib/projects";
import { askToRemove } from "@/lib/removal";

// Projects and their goals. Managers and Administrators add and change; only a
// Manager changes what a project is about (who sees it); removing takes two
// people. The family database checks all of this too. A goal's to-dos are
// added through the one to-do list (organising/actions.ts).

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
const page = (familyId: string, projectId: string) => `/families/${familyId}/projects/${projectId}`;

async function editor(familyId: string, to: string) {
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db || !ctx.canEdit) go(to, "Only a Manager or Administrator can change projects.");
  return ctx;
}
type Ctx = Awaited<ReturnType<typeof editor>>;

function friendly(message: string | undefined) {
  const m = message ?? "";
  if (/^Projects: /.test(m)) return m.replace(/^Projects: /, "");
  if (/row-level security/.test(m)) return "You don't have permission to change this.";
  if (/projects_check/.test(m)) return "The target date can't be before the start date.";
  return m ? "That couldn't be saved. Please check the details and try again." : "Something went wrong.";
}

function date(form: FormData, name: string, what: string) {
  const v = text(form, name);
  if (v && !isDate(v)) return { error: `Please enter ${what} as day, month and year.` };
  return { value: v || null };
}

async function projectFields(ctx: Ctx, form: FormData, currentOwner?: string | null) {
  const title = text(form, "title");
  if (!title) return { error: "Please give the project a name." };
  const starts = date(form, "starts_on", "the start date");
  const target = date(form, "target_on", "the target date");
  if (starts.error || target.error) return { error: starts.error ?? target.error };
  if (starts.value && target.value && target.value < starts.value) return { error: "The target date can't be before the start date." };
  const owner = uuid(text(form, "owner_id"));
  if (owner && owner !== currentOwner) {
    const { data } = await ctx.supabase.rpc("family_team", { p_family: ctx.family.id });
    if (!((data ?? []) as { user_id: string }[]).some((t) => t.user_id === owner)) return { error: "A project's owner must be a Manager or Administrator of this family." };
  }
  return {
    value: {
      title,
      purpose: optional(form, "purpose"),
      outcomes: optional(form, "outcomes"),
      lead_person_id: uuid(text(form, "lead_person_id")),
      owner_id: owner,
      starts_on: starts.value,
      target_on: target.value,
    },
  };
}

function about(form: FormData) {
  const [kind, id] = text(form, "about").split(":");
  const v = uuid(id ?? "");
  return { entity_id: kind === "entity" ? v : null, branch_id: kind === "branch" ? v : null };
}

export async function addProject(familyId: string, form: FormData) {
  const to = `/families/${familyId}/projects`;
  const ctx = await editor(familyId, to);
  const f = await projectFields(ctx, form);
  if (f.error || !f.value) go(to, f.error);
  const stage = text(form, "stage") || "idea";
  if (stage !== "idea" && stage !== "planning" && stage !== "under_way") go(to, "Please choose the stage.");
  const { data, error } = await ctx.db!.from("projects").insert({ ...f.value, ...about(form), stage }).select("id").single();
  if (error || !data) go(to, friendly(error?.message));
  go(page(familyId, data.id), undefined, "project_added");
}

export async function updateProject(familyId: string, projectId: string, form: FormData) {
  const to = page(familyId, projectId);
  const ctx = await editor(familyId, to);
  const { data: current } = await ctx.db!.from("projects").select("owner_id").eq("id", projectId).maybeSingle();
  if (!current) go(to, "That project can't be found.");
  const f = await projectFields(ctx, form, current.owner_id);
  if (f.error || !f.value) go(to, f.error);
  // Only a Manager may change what a project is about (the form only offers
  // it to Managers, and the database checks it).
  const change = ctx.canManage && form.has("about") ? { ...f.value, ...about(form) } : f.value;
  const { error } = await ctx.db!.from("projects").update(change).eq("id", projectId);
  go(to, error ? friendly(error.message) : undefined, "project_saved");
}

export async function setStage(familyId: string, projectId: string, form: FormData) {
  const to = page(familyId, projectId);
  const ctx = await editor(familyId, to);
  const stage = text(form, "stage");
  if (!(stage in STAGES)) go(to, "Please choose the stage.");
  const finished = stage === "completed" || stage === "stopped";
  const on = date(form, "finished_on", "the date");
  if (on.error) go(to, on.error);
  // Already finished and no date given: keep the date it was finished.
  const { data: current } = await ctx.db!.from("projects").select("finished_on").eq("id", projectId).maybeSingle();
  const { error } = await ctx
    .db!.from("projects")
    .update(finished ? { stage, finished_on: on.value ?? current?.finished_on ?? null, finished_note: optional(form, "finished_note") } : { stage })
    .eq("id", projectId);
  go(to, error ? friendly(error.message) : undefined, "stage_saved");
}

export async function removeProject(familyId: string, projectId: string) {
  const ctx = await getFamilyContext(familyId);
  const error = await askToRemove(ctx, "projects", projectId);
  go(error ? page(familyId, projectId) : `/families/${familyId}/projects`, error ?? undefined, "removal_requested");
}

function goalFields(form: FormData) {
  const title = text(form, "title");
  if (!title) return { error: "Please give the goal a name." };
  const target = date(form, "target_on", "the target date");
  if (target.error) return { error: target.error };
  return { value: { title, description: optional(form, "description"), lead_person_id: uuid(text(form, "lead_person_id")), target_on: target.value } };
}

export async function addGoal(familyId: string, projectId: string, form: FormData) {
  const to = page(familyId, projectId);
  const ctx = await editor(familyId, to);
  const g = goalFields(form);
  if (g.error || !g.value) go(to, g.error);
  const { count } = await ctx.db!.from("project_goals").select("id", { count: "exact", head: true }).eq("project_id", projectId);
  const { data, error } = await ctx.db!.from("project_goals").insert({ ...g.value, project_id: projectId, sort: ((count ?? 0) + 1) * 10 }).select("id").single();
  go(error || !data ? to : `${to}#goal-${data.id}`, error ? friendly(error.message) : undefined, "goal_added");
}

export async function updateGoal(familyId: string, projectId: string, goalId: string, form: FormData) {
  const to = `${page(familyId, projectId)}#goal-${goalId}`;
  const ctx = await editor(familyId, to);
  const g = goalFields(form);
  if (g.error || !g.value) go(to, g.error);
  const { error } = await ctx.db!.from("project_goals").update(g.value).eq("id", goalId).eq("project_id", projectId);
  go(to, error ? friendly(error.message) : undefined, "goal_saved");
}

export async function setGoalAchieved(familyId: string, projectId: string, goalId: string, achieved: boolean, form: FormData) {
  const to = `${page(familyId, projectId)}#goal-${goalId}`;
  const ctx = await editor(familyId, to);
  const on = date(form, "achieved_on", "the date");
  if (on.error) go(to, on.error);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const { error } = await ctx
    .db!.from("project_goals")
    .update({ achieved_on: achieved ? (on.value ?? today) : null })
    .eq("id", goalId)
    .eq("project_id", projectId);
  go(to, error ? friendly(error.message) : undefined, achieved ? "goal_achieved" : "goal_reopened");
}

export async function removeGoal(familyId: string, projectId: string, goalId: string) {
  const ctx = await getFamilyContext(familyId);
  const error = await askToRemove(ctx, "project_goals", goalId, { project_id: projectId });
  go(page(familyId, projectId), error ?? undefined, "removal_requested");
}
