"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getFamilyContext } from "@/lib/family-context";
import { isDate } from "@/lib/governance";
import type { SavedCode } from "@/lib/messages";
import { askToRemove } from "@/lib/removal";

// Events added to the timeline by hand. Managers and Administrators add them;
// removing takes two people. The family database checks this too.

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
const uuid = (s: string) => (/^[0-9a-f-]{36}$/i.test(s) ? s : null);
const safeBack = (familyId: string, back: string) => (back.startsWith(`/families/${familyId}/`) && !back.includes("//") ? back : `/families/${familyId}/reports/timeline`);

function friendly(m: string | undefined) {
  if (!m) return "Something went wrong.";
  if (/^Timeline: /.test(m)) return m.replace(/^Timeline: /, "");
  if (/row-level security/.test(m)) return "You don't have permission to change this.";
  return "That couldn't be saved. Please check the details and try again.";
}

export async function addTimelineEvent(familyId: string, back: string, form: FormData) {
  const to = safeBack(familyId, back);
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db || !ctx.canEdit) go(to, "Only a Manager or Administrator can add to the timeline.");
  const title = text(form, "title");
  const precision = text(form, "precision") || "day";
  const year = text(form, "year");
  const month = /^\d{2}$/.test(text(form, "month_only")) ? `${text(form, "year")}-${text(form, "month_only")}` : "";
  const day = text(form, "happened_on");
  if (!title) go(to, "Please say what happened.");
  // The date as exactly as it is known: a full date, a month, or a year.
  let date = "";
  if (precision === "day") date = day;
  else if (precision === "month") date = /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : "";
  else if (precision === "year") date = /^\d{4}$/.test(year) ? `${year}-01-01` : "";
  else go(to, "Please say how exact the date is.");
  if (precision !== "day" && /^\d{4}$/.test(year) && (Number(year) < 1800 || Number(year) > 2200)) go(to, "Please check the year.");
  if (!isDate(date)) go(to, precision === "year" ? "Please enter the year, e.g. 1998." : precision === "month" ? "Please choose the month and enter the year." : "Please enter the date as day, month and year.");
  const category = text(form, "category") || "family";
  if (!["family", "business", "governance", "other"].includes(category)) go(to, "Please choose what kind of event it was.");
  const [kind, id] = text(form, "about").split(":");
  const about = uuid(id ?? "") ? (kind === "entity" ? { entity_id: id } : kind === "branch" ? { branch_id: id } : {}) : {};
  const people = [...new Set(form.getAll("people").map(String).filter((p) => uuid(p)))];
  const { error } = await ctx.db.rpc("add_timeline_event", {
    p_event: { title, happened_on: date, precision, category, details: text(form, "details") || null, ...about },
    p_people: people,
  });
  go(to, error ? friendly(error.message) : undefined, "timeline_added");
}

export async function removeTimelineEvent(familyId: string, back: string, eventId: string) {
  const ctx = await getFamilyContext(familyId);
  const error = await askToRemove(ctx, "timeline_events", eventId);
  go(safeBack(familyId, back), error ?? undefined, "removal_requested");
}
