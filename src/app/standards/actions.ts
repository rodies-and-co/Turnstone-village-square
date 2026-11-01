"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSignedIn } from "@/lib/auth";
import type { SavedCode } from "@/lib/messages";
import { friendlyError } from "@/lib/people";

// Entity Standards: only the Super User and the System Admin change, approve
// or retire them. The hub database enforces this too.

function back(id: string, error?: string, saved: SavedCode = "saved"): never {
  revalidatePath("/standards", "layout");
  redirect(`/standards/${id}?${new URLSearchParams(error ? { error } : { saved }).toString()}`);
}

async function approver(id: string) {
  const session = await requireSignedIn();
  if (session.systemRole !== "super_user" && session.systemRole !== "system_admin") {
    back(id, "Only the Super User or System Admin can change Entity Standards.");
  }
  return session.supabase;
}

const NUMBERS = ["min_directors", "min_resident_directors", "min_trustees", "min_council_members", "min_resident_council_members", "min_designated_members"] as const;
const FLAGS = [
  "secretary_required",
  "registered_office_required",
  "registered_agent_required",
  "nominated_officer_required",
  "management_company_required",
  "public_officer_required",
  "auditor_required",
  "accounting_officer_required",
  "licensed_trustee_required",
  "enforcer_required",
  "identity_verification_required",
] as const;
const TEXTS = ["statute", "bo_change_deadline", "registry_notice", "agm", "officers_notes", "registers", "filings", "event_deadlines", "to_confirm", "review_note"] as const;

export async function saveStandard(id: string, form: FormData) {
  const db = await approver(id);
  const v = (n: string) => {
    const x = form.get(n);
    return typeof x === "string" ? x.trim() : "";
  };
  const changes: Record<string, unknown> = {};
  for (const n of NUMBERS) {
    const x = Number(v(n) || "0");
    if (!Number.isInteger(x) || x < 0 || x > 50) back(id, "Numbers of officers should be whole numbers from 0 to 50.");
    changes[n] = x;
  }
  for (const f of FLAGS) changes[f] = form.get(f) === "on";
  for (const t of TEXTS) changes[t] = v(t) || null;
  const share = v("share_capital");
  if (!["required", "optional", "none"].includes(share)) back(id, "Please choose the share capital rule.");
  changes.share_capital = share;
  const rule = v("bo_rule");
  if (!["more_than", "at_least", "everyone"].includes(rule)) back(id, "Please choose the beneficial ownership rule.");
  changes.bo_rule = rule;
  const threshold = v("bo_threshold_percent");
  if (rule !== "everyone") {
    const t = Number(threshold);
    if (!threshold || !(t > 0 && t <= 100)) back(id, "Please give the beneficial ownership threshold as a percentage, e.g. 25.");
    changes.bo_threshold_percent = t;
  } else changes.bo_threshold_percent = null;
  const retention = v("record_retention_years");
  changes.record_retention_years = retention ? Number(retention) : null;
  const checked = v("last_legal_check");
  changes.last_legal_check = checked || null;

  // A draft is changed in place. An approved standard is never changed: the
  // changes become a new draft version, so entities keep the rules that
  // applied when they were set up until the new version is approved.
  const { data: current } = await db.from("entity_standards").select("*").eq("id", id).maybeSingle();
  if (!current) back(id, "That standard couldn't be found.");
  if (current.status === "draft") {
    const { error } = await db.from("entity_standards").update(changes).eq("id", id);
    back(id, error ? friendlyError(error.message) : undefined, "standard_saved");
  }
  const { data: versions } = await db
    .from("entity_standards")
    .select("version")
    .ilike("jurisdiction", current.jurisdiction)
    .eq("entity_type", current.entity_type)
    .ilike("sub_type", current.sub_type);
  const next = Math.max(0, ...(versions ?? []).map((v: { version: number }) => v.version)) + 1;
  const copy = { ...current };
  for (const k of ["id", "created_at", "updated_at", "reviewed_by", "reviewed_at", "created_by", "effective_from"]) delete copy[k];
  const { data: created, error } = await db
    .from("entity_standards")
    .insert({ ...copy, ...changes, status: "draft", version: next, based_on: current.id })
    .select("id")
    .single();
  if (error || !created) back(id, friendlyError(error?.message));
  back(created.id, undefined, "standard_new_version");
}

export async function approveStandard(id: string) {
  const db = await approver(id);
  const { error } = await db.from("entity_standards").update({ status: "approved" }).eq("id", id).eq("status", "draft");
  back(id, error ? friendlyError(error.message) : undefined, "standard_approved");
}

export async function retireStandard(id: string) {
  const db = await approver(id);
  const { error } = await db.from("entity_standards").update({ status: "retired" }).eq("id", id);
  back(id, error ? friendlyError(error.message) : undefined, "standard_retired");
}
