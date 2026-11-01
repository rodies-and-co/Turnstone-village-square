"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getFamilyContext } from "@/lib/family-context";
import { BODY_KINDS, MEMBER_ROLES, PROFESSIONS, STATEMENT_KINDS, governanceError, isDate, oneOf } from "@/lib/governance";
import type { SavedCode } from "@/lib/messages";

// Governance bodies, advisors, and purpose and values. Managers and
// Administrators add and change; only Managers remove and adopt. The family
// database checks all of this too; these checks only give a clear message.

type Page = "governance" | "advisors" | "values";

function back(familyId: string, page: Page, error?: string, saved: SavedCode = "saved"): never {
  revalidatePath(`/families/${familyId}`, "layout");
  const params = new URLSearchParams(error ? { error } : { saved });
  redirect(`/families/${familyId}/branches/${page}?${params.toString()}`);
}

async function db(familyId: string, page: Page, manager = false) {
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db || !(manager ? ctx.canManage : ctx.canEdit)) {
    back(familyId, page, manager ? "Only a Manager can do that." : "You don't have permission to change this.");
  }
  return ctx.db;
}

function text(form: FormData, name: string) {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}
const optional = (form: FormData, name: string) => text(form, name) || null;
function date(form: FormData, name: string): string | null | false {
  const v = text(form, name);
  if (!v) return null;
  return isDate(v) ? v : false;
}
// "" means the whole family; otherwise a branch id.
const scope = (form: FormData) => text(form, "branch_id") || null;

// ---------------------------------------------------------------------------
// Governance bodies

export async function addBody(familyId: string, form: FormData) {
  const page = "governance";
  const d = await db(familyId, page);
  const kind = text(form, "kind");
  const branchId = scope(form);
  if (!oneOf(kind, BODY_KINDS)) back(familyId, page, "Please choose what kind of body it is.");
  // With no name given, use the kind, and for a branch the branch's name,
  // e.g. "Pieter Visser Branch council".
  let name = text(form, "name");
  if (!name) {
    const { data: branch } = branchId ? await d.from("branches").select("name").eq("id", branchId).maybeSingle() : { data: null };
    name = branch ? `${branch.name} ${BODY_KINDS[kind].toLowerCase()}` : BODY_KINDS[kind];
  }
  const established = date(form, "established_on");
  if (!name) back(familyId, page, "Please give the body a name.");
  if (established === false) back(familyId, page, "Please enter the date as day, month and year.");
  const { error } = await d.from("governance_bodies").insert({
    kind,
    name,
    branch_id: branchId,
    purpose: optional(form, "purpose"),
    meets: optional(form, "meets"),
    established_on: established,
  });
  back(familyId, page, error ? governanceError(error.message) : undefined, "body_added");
}

export async function saveBody(familyId: string, bodyId: string, form: FormData) {
  const page = "governance";
  const d = await db(familyId, page);
  const name = text(form, "name");
  const established = date(form, "established_on");
  if (!name) back(familyId, page, "Please give the body a name.");
  if (established === false) back(familyId, page, "Please enter the date as day, month and year.");
  const { error } = await d
    .from("governance_bodies")
    .update({ name, purpose: optional(form, "purpose"), meets: optional(form, "meets"), established_on: established })
    .eq("id", bodyId);
  back(familyId, page, error ? governanceError(error.message) : undefined, "body_saved");
}

export async function removeBody(familyId: string, bodyId: string) {
  const page = "governance";
  const d = await db(familyId, page, true);
  const { error } = await d.from("governance_bodies").delete().eq("id", bodyId);
  back(familyId, page, error ? governanceError(error.message) : undefined, "body_removed");
}

export async function addSeat(familyId: string, bodyId: string, form: FormData) {
  const page = "governance";
  const d = await db(familyId, page);
  const personId = text(form, "person_id");
  const role = text(form, "role") || "member";
  const from = date(form, "from_date");
  if (!personId) back(familyId, page, "Please choose a person.");
  if (!oneOf(role, MEMBER_ROLES)) back(familyId, page, "Please choose a role.");
  if (from === false) back(familyId, page, "Please enter the date as day, month and year.");
  const { error } = await d.from("body_members").insert({ body_id: bodyId, person_id: personId, role, from_date: from });
  back(familyId, page, error ? governanceError(error.message) : undefined, "seat_added");
}

// Ending a seat keeps it in the body's history.
export async function endSeat(familyId: string, seatId: string) {
  const page = "governance";
  const d = await db(familyId, page);
  const today = new Date().toISOString().slice(0, 10);
  const { error } = await d.from("body_members").update({ to_date: today }).eq("id", seatId);
  back(familyId, page, error ? governanceError(error.message) : undefined, "seat_ended");
}

export async function removeSeat(familyId: string, seatId: string) {
  const page = "governance";
  const d = await db(familyId, page, true);
  const { error } = await d.from("body_members").delete().eq("id", seatId);
  back(familyId, page, error ? governanceError(error.message) : undefined, "seat_removed");
}

// ---------------------------------------------------------------------------
// Circles of advisors

// Adds an advisor to the family's or a branch's circle: an advisor already
// recorded, or a new one (so their details are only entered once).
export async function addAdvisorRole(familyId: string, form: FormData) {
  const page = "advisors";
  const d = await db(familyId, page);
  const advisesOn = text(form, "advises_on");
  const from = date(form, "from_date");
  if (!advisesOn) back(familyId, page, "Please say what they advise on.");
  if (from === false) back(familyId, page, "Please enter the date as day, month and year.");

  let advisorId = text(form, "advisor_id");
  if (!advisorId) {
    const fullName = text(form, "full_name");
    const profession = text(form, "profession") || "other";
    if (!fullName) back(familyId, page, "Please choose an advisor already recorded, or type the new advisor's name.");
    if (!oneOf(profession, PROFESSIONS)) back(familyId, page, "Please choose a profession.");
    const { data, error } = await d
      .from("advisors")
      .insert({ full_name: fullName, firm: optional(form, "firm"), profession, email: optional(form, "email"), phone: optional(form, "phone") })
      .select("id")
      .single();
    if (error || !data) back(familyId, page, governanceError(error?.message));
    advisorId = data.id;
  }
  const { error } = await d.from("advisor_roles").insert({ advisor_id: advisorId, branch_id: scope(form), advises_on: advisesOn, from_date: from });
  back(familyId, page, error ? governanceError(error.message) : undefined, "advisor_added");
}

export async function saveAdvisor(familyId: string, advisorId: string, form: FormData) {
  const page = "advisors";
  const d = await db(familyId, page);
  const fullName = text(form, "full_name");
  const profession = text(form, "profession") || "other";
  if (!fullName) back(familyId, page, "Please give the advisor's name.");
  if (!oneOf(profession, PROFESSIONS)) back(familyId, page, "Please choose a profession.");
  const { error } = await d
    .from("advisors")
    .update({ full_name: fullName, firm: optional(form, "firm"), profession, email: optional(form, "email"), phone: optional(form, "phone") })
    .eq("id", advisorId);
  back(familyId, page, error ? governanceError(error.message) : undefined, "advisor_saved");
}

export async function removeAdvisorRole(familyId: string, roleId: string) {
  const page = "advisors";
  const d = await db(familyId, page, true);
  const { error } = await d.from("advisor_roles").delete().eq("id", roleId);
  back(familyId, page, error ? governanceError(error.message) : undefined, "advisor_role_removed");
}

export async function removeAdvisor(familyId: string, advisorId: string) {
  const page = "advisors";
  const d = await db(familyId, page, true);
  const { error } = await d.from("advisors").delete().eq("id", advisorId);
  back(familyId, page, error ? governanceError(error.message) : undefined, "advisor_removed");
}

// ---------------------------------------------------------------------------
// Purpose, values and other statements

export async function addStatement(familyId: string, form: FormData) {
  const page = "values";
  const d = await db(familyId, page);
  const kind = text(form, "kind");
  const title = text(form, "title") || (oneOf(kind, STATEMENT_KINDS) ? STATEMENT_KINDS[kind] : "");
  const body = text(form, "body");
  if (!oneOf(kind, STATEMENT_KINDS)) back(familyId, page, "Please choose what kind of statement it is.");
  if (!body) back(familyId, page, "Please write the statement.");
  const { error } = await d.from("family_statements").insert({ kind, title, body, branch_id: scope(form) });
  back(familyId, page, error ? governanceError(error.message) : undefined, "statement_added");
}

export async function saveStatement(familyId: string, statementId: string, form: FormData) {
  const page = "values";
  const d = await db(familyId, page);
  const title = text(form, "title");
  const body = text(form, "body");
  if (!title || !body) back(familyId, page, "Please fill in the title and the wording.");
  const { error } = await d.from("family_statements").update({ title, body }).eq("id", statementId);
  back(familyId, page, error ? governanceError(error.message) : undefined, "statement_saved");
}

export async function adoptStatement(familyId: string, statementId: string) {
  const page = "values";
  const d = await db(familyId, page, true);
  const { error } = await d.from("family_statements").update({ status: "adopted" }).eq("id", statementId);
  back(familyId, page, error ? governanceError(error.message) : undefined, "statement_adopted");
}

export async function withdrawStatement(familyId: string, statementId: string) {
  const page = "values";
  const d = await db(familyId, page, true);
  const { error } = await d.from("family_statements").update({ status: "draft" }).eq("id", statementId);
  back(familyId, page, error ? governanceError(error.message) : undefined, "statement_withdrawn");
}

export async function removeStatement(familyId: string, statementId: string) {
  const page = "values";
  const d = await db(familyId, page, true);
  const { error } = await d.from("family_statements").delete().eq("id", statementId);
  back(familyId, page, error ? governanceError(error.message) : undefined, "statement_removed");
}
