"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getFamilyContext } from "@/lib/family-context";
import { isDomain, RELATIONSHIPS } from "@/lib/advisors";
import { PROFESSIONS, isDate } from "@/lib/governance";
import type { SavedCode } from "@/lib/messages";
import { askToRemove } from "@/lib/removal";

// Circles of advisors (the advisory team map). Managers and Administrators
// add and change advisors and their places; how each relationship is working
// is recorded for the team only; removing takes two people. The family
// database checks all of this too.

function go(path: string, error?: string, saved: SavedCode = "saved"): never {
  revalidatePath(path.split("?")[0].split("#")[0]);
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
const safeBack = (familyId: string, back: string) => (back.startsWith(`/families/${familyId}/village/advisors`) && !back.includes("//") ? back : `/families/${familyId}/village/advisors`);

function friendly(m: string | undefined) {
  if (!m) return "Something went wrong.";
  if (/^Advisors: /.test(m)) return m.replace(/^Advisors: /, "");
  if (/advisor_roles_one_coordinator/.test(m)) return "One of the circles chosen already has a coordinator, so nothing was added. Stop the current coordinator first, or untick “Coordinates”.";
  if (/advisor_roles_once/.test(m)) return "That advisor already covers this domain in one of the circles chosen. Nothing was added; untick that circle and try again.";
  if (/advisor_roles_says_what/.test(m)) return "Please choose the domain, or say what they advise on.";
  if (/email/.test(m) && /check constraint/.test(m)) return "That email address doesn't look right.";
  if (/phone/.test(m) && /check constraint/.test(m)) return "That phone number doesn't look right.";
  if (/row-level security/.test(m)) return "You don't have permission to change this.";
  return "That couldn't be saved. Please check the details and try again.";
}

async function editor(familyId: string, to: string) {
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db || !ctx.canEdit) go(to, "Only a Manager or Administrator can change the advisors.");
  return ctx;
}

function advisorFields(form: FormData) {
  const full = text(form, "full_name");
  const profession = text(form, "profession") || "other";
  if (!full) return { error: "Please give the advisor's name (a person or a firm)." };
  if (!(profession in PROFESSIONS)) return { error: "Please choose what they do." };
  return { value: { full_name: full, firm: optional(form, "firm"), profession, email: optional(form, "email"), phone: optional(form, "phone") } };
}

// Places an advisor (one already recorded, or a new one) in a circle, for a
// domain.
export async function placeAdvisor(familyId: string, back: string, form: FormData) {
  const to = safeBack(familyId, back);
  const ctx = await editor(familyId, to);
  const domain = text(form, "domain");
  const advisesOn = optional(form, "advises_on");
  if (domain && !isDomain(domain)) go(to, "Please choose the domain.");
  if (!domain && !advisesOn) go(to, "Please choose the domain, or say what they advise on.");
  const from = text(form, "from_date");
  if (from && !isDate(from)) go(to, "Please enter the date as day, month and year.");
  // Who they advise: the family, one or more branches, or everyone.
  const chosen = form.getAll("circles").map(String);
  const { data: branchRows } = await ctx.db!.from("branches").select("id");
  const allBranches = ((branchRows ?? []) as { id: string }[]).map((b) => b.id);
  const circles: (string | null)[] = chosen.includes("all")
    ? [null, ...allBranches]
    : [...new Set(chosen.flatMap((c) => (c === "family" ? [null] : c.startsWith("branch:") && allBranches.includes(c.slice(7)) ? [c.slice(7)] : [])))];
  if (circles.length === 0) go(to, "Please say who they advise: the family, one or more branches, or everyone.");
  let advisorId = uuid(text(form, "advisor_id"));
  if (!advisorId) {
    const f = advisorFields(form);
    if (f.error || !f.value) go(to, f.error ?? "Please choose an advisor already recorded, or give the new advisor's name.");
    const { data, error } = await ctx.db!.from("advisors").insert(f.value).select("id").single();
    if (error || !data) go(to, friendly(error?.message));
    advisorId = data.id as string;
  }
  const { error } = await ctx.db!.from("advisor_roles").insert(
    circles.map((branch) => ({
      advisor_id: advisorId,
      branch_id: branch,
      domain: domain || null,
      advises_on: advisesOn,
      from_date: from || null,
      coordinator: form.get("coordinator") === "on",
    })),
  );
  go(to, error ? friendly(error.message) : undefined, circles.length > 1 ? "advisor_added_many" : "advisor_added");
}

export async function saveAdvisorDetails(familyId: string, back: string, advisorId: string, form: FormData) {
  const to = safeBack(familyId, back);
  const ctx = await editor(familyId, to);
  const f = advisorFields(form);
  if (f.error || !f.value) go(to, f.error);
  const { error } = await ctx.db!.from("advisors").update(f.value).eq("id", advisorId);
  go(to, error ? friendly(error.message) : undefined, "advisor_saved");
}

export async function setCoordinator(familyId: string, back: string, roleId: string, on: boolean) {
  const to = safeBack(familyId, back);
  const ctx = await editor(familyId, to);
  const { error } = await ctx.db!.from("advisor_roles").update({ coordinator: on }).eq("id", roleId).is("to_date", null);
  go(to, error ? friendly(error.message) : undefined, on ? "coordinator_set" : "coordinator_stopped");
}

export async function assessRelationship(familyId: string, back: string, roleId: string, form: FormData) {
  const to = safeBack(familyId, back);
  const ctx = await editor(familyId, to);
  const relationship = text(form, "relationship");
  if (!(relationship in RELATIONSHIPS)) go(to, "Please choose how the relationship is working.");
  const value = { role_id: roleId, relationship, note: optional(form, "note") };
  const { data: existing } = await ctx.db!.from("advisor_assessments").select("id").eq("role_id", roleId).maybeSingle();
  const { error } = existing
    ? await ctx.db!.from("advisor_assessments").update(value).eq("id", existing.id)
    : await ctx.db!.from("advisor_assessments").insert(value);
  go(to, error ? friendly(error.message) : undefined, "relationship_saved");
}

export async function endPlace(familyId: string, back: string, roleId: string, form: FormData) {
  const to = safeBack(familyId, back);
  const ctx = await editor(familyId, to);
  const on = text(form, "to_date");
  if (!isDate(on)) go(to, "Please enter the date as day, month and year.");
  const { error } = await ctx.db!.from("advisor_roles").update({ to_date: on }).eq("id", roleId).is("to_date", null);
  go(to, error ? friendly(error.message) : undefined, "advisor_place_ended");
}

export async function removePlace(familyId: string, back: string, roleId: string) {
  const ctx = await getFamilyContext(familyId);
  const error = await askToRemove(ctx, "advisor_roles", roleId);
  go(safeBack(familyId, back), error ?? undefined, "removal_requested");
}
