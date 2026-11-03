"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getFamilyContext } from "@/lib/family-context";
import { isDate } from "@/lib/governance";
import type { SavedCode } from "@/lib/messages";
import { askToRemove } from "@/lib/removal";

// The one to-do list and the calendar. Managers and Administrators add and
// change; removing takes two people. The family database checks this too.

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
const TOPICS = ["actions", "filings", "meetings", "resolutions", "investments", "property", "other"];

// Only pages inside this family may be returned to.
function safeBack(familyId: string, back: string) {
  return back.startsWith(`/families/${familyId}/`) && !back.includes("//") ? back : `/families/${familyId}/organising`;
}

async function editor(familyId: string, to: string) {
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db || !ctx.canEdit) go(to, "Only a Manager or Administrator can change the to-do list and the calendar.");
  return ctx;
}

function friendly(message: string | undefined) {
  const m = message ?? "";
  if (/row-level security/.test(m)) return "You don't have permission to change this.";
  if (/ends_on/.test(m)) return "The end date can't be before the start date.";
  if (/^Calendar: /.test(m)) return m.replace(/^Calendar: /, "");
  if (/calendar_event_people_event_id_person_id_key/.test(m)) return "That person is already linked.";
  return m ? "That couldn't be saved. Please check the details and try again." : "Something went wrong.";
}

async function teamIds(ctx: Awaited<ReturnType<typeof getFamilyContext>>) {
  const { data } = await ctx.supabase.rpc("family_team", { p_family: ctx.family.id });
  return new Set(((data ?? []) as { user_id: string }[]).map((t) => t.user_id));
}

function todoFields(form: FormData) {
  const title = text(form, "title");
  const due = text(form, "due_on");
  const topic = text(form, "topic") || "actions";
  const priority = text(form, "priority") || "normal";
  if (!title) return { error: "Please say what needs doing." };
  if (due && !isDate(due)) return { error: "Please enter the date as day, month and year." };
  if (!TOPICS.includes(topic)) return { error: "Please choose the topic." };
  if (!["high", "normal", "low"].includes(priority)) return { error: "Please choose the priority." };
  return {
    value: {
      title,
      details: optional(form, "details"),
      due_on: due || null,
      topic,
      priority,
      entity_id: uuid(text(form, "entity_id")),
      person_id: uuid(text(form, "person_id")),
    },
  };
}

export async function addTodo(familyId: string, back: string, form: FormData) {
  const to = safeBack(familyId, back);
  const ctx = await editor(familyId, to);
  const fields = todoFields(form);
  if ("error" in fields) go(to, fields.error);
  const assigned = uuid(text(form, "assigned_to"));
  if (assigned && !(await teamIds(ctx)).has(assigned)) go(to, "A to-do can only be given to a Manager or Administrator of this family.");
  const { error } = await ctx.db!.from("todos").insert({ ...fields.value, assigned_to: assigned });
  go(to, error ? friendly(error.message) : undefined, "todo_added");
}

export async function updateTodo(familyId: string, back: string, todoId: string, form: FormData) {
  const to = safeBack(familyId, back);
  const ctx = await editor(familyId, to);
  const fields = todoFields(form);
  if ("error" in fields) go(to, fields.error);
  const assigned = uuid(text(form, "assigned_to"));
  if (assigned && !(await teamIds(ctx)).has(assigned)) go(to, "A to-do can only be given to a Manager or Administrator of this family.");
  const { error } = await ctx.db!.from("todos").update({ ...fields.value, assigned_to: assigned }).eq("id", todoId);
  go(to, error ? friendly(error.message) : undefined, "todo_saved");
}

export async function setTodoStatus(familyId: string, back: string, todoId: string, status: "open" | "done") {
  const to = safeBack(familyId, back);
  const ctx = await editor(familyId, to);
  if (status !== "open" && status !== "done") go(to, "That isn't possible.");
  const { error } = await ctx.db!.from("todos").update({ status }).eq("id", todoId);
  go(to, error ? friendly(error.message) : undefined, status === "done" ? "todo_done" : "todo_reopened");
}

export async function removeTodo(familyId: string, back: string, todoId: string) {
  const ctx = await getFamilyContext(familyId);
  const error = await askToRemove(ctx, "todos", todoId);
  go(safeBack(familyId, back), error ?? undefined, "removal_requested");
}

export async function addEvent(familyId: string, back: string, form: FormData) {
  const to = safeBack(familyId, back);
  const ctx = await editor(familyId, to);
  const title = text(form, "title");
  const starts = text(form, "starts_on");
  const ends = text(form, "ends_on");
  const time = text(form, "starts_at");
  const kind = text(form, "kind") || "family";
  if (!title) go(to, "Please give the entry a title.");
  if (!isDate(starts)) go(to, "Please enter the date as day, month and year.");
  if (ends && !isDate(ends)) go(to, "Please enter the end date as day, month and year.");
  if (ends && ends < starts) go(to, "The end date can't be before the start date.");
  if (time && !/^\d{2}:\d{2}$/.test(time)) go(to, "Please enter the time as hours and minutes, e.g. 14:30.");
  if (!["family", "personal", "deadline", "reminder", "other"].includes(kind)) go(to, "Please choose the kind of entry.");
  const [aboutKind, aboutId] = text(form, "about").split(":");
  const about = uuid(aboutId ?? "") ? (aboutKind === "entity" ? { entity_id: aboutId } : aboutKind === "branch" ? { branch_id: aboutId } : {}) : {};
  const people = [...new Set(form.getAll("people").map(String).filter((p) => uuid(p)))];
  // Saved with its people in one step, so it is never briefly seen by everyone.
  const { error } = await ctx.db!.rpc("add_calendar_event", {
    p_event: { title, kind, starts_on: starts, ends_on: ends || null, starts_at: time || null, location: optional(form, "location"), details: optional(form, "details"), ...about },
    p_people: people,
  });
  if (error) go(to, friendly(error.message));
  go(to, undefined, "event_added");
}

export async function removeEvent(familyId: string, back: string, eventId: string) {
  const ctx = await getFamilyContext(familyId);
  const error = await askToRemove(ctx, "calendar_events", eventId);
  go(safeBack(familyId, back), error ?? undefined, "removal_requested");
}
