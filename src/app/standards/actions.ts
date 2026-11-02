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
  const authorised = v("authorised_capital");
  if (!["required", "optional", "none"].includes(authorised)) back(id, "Please choose whether authorised share capital is required.");
  changes.authorised_capital = authorised;
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

// ---------------------------------------------------------------------------
// Obligations (the filings calendar). Only on a draft; the hub checks this too.

const KEY = /^[a-z0-9_]{2,60}$/;
const obligationError = (m: string) => (/^Entity Standard: /.test(m) ? m.replace(/^Entity Standard: /, "") : friendlyError(m));
const int = (v: string, lo: number, hi: number) => (/^\d+$/.test(v) && Number(v) >= lo && Number(v) <= hi ? Number(v) : null);

export async function addObligation(id: string, form: FormData) {
  const supabase = await approver(id);
  const v = (n: string) => String(form.get(n) ?? "").trim();
  const name = v("name");
  const kind = v("kind");
  const basis = kind === "recurring" ? v("basis") : null;
  const event = kind === "event" ? v("event_type") : null;
  if (!name) back(id, "Please name the filing or notice.");
  if (!["recurring", "event"].includes(kind)) back(id, "Please say whether it recurs or follows an event.");
  if (kind === "recurring" && !["anniversary", "year_end", "fixed_date", "half_year"].includes(basis ?? "")) back(id, "Please choose what the due date is based on.");
  if (kind === "event" && !["officer_change", "member_change", "share_issue", "bo_change"].includes(event ?? "")) back(id, "Please choose the event.");
  const months = int(v("offset_months") || "0", 0, 36);
  const days = int(v("offset_days") || "0", 0, 365);
  if (months === null || days === null) back(id, "Months and days should be whole numbers.");
  const fixed = v("fixed_date"); // day/month
  const alt = v("alt_date");
  // Day/month, the British way: "31/05" is 31 May. Returns [month, day].
  const md = (s: string) => {
    const m = /^(\d{1,2})[/.-](\d{1,2})$/.exec(s);
    if (!m) return null;
    const [day, month] = [Number(m[1]), Number(m[2])];
    return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(2024, month, 0)).getUTCDate() ? [month, day] : null;
  };
  if ((basis === "fixed_date" || basis === "half_year") && !md(fixed)) back(id, "Please give the date as day/month, e.g. 31/05 for 31 May.");
  if (basis === "half_year" && !md(alt)) back(id, "Please give the second date as day/month, e.g. 30/11 for 30 November.");
  const key = (v("key") || name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")).slice(0, 60);
  if (!KEY.test(key)) back(id, "Please give a short key in small letters, e.g. annual_return.");
  const roles = form.getAll("event_roles").map(String).filter(Boolean);
  const [fm, fd] = md(fixed) ?? [null, null];
  const [am, ad] = md(alt) ?? [null, null];
  const { error } = await supabase.from("standard_obligations").insert({
    standard_id: id,
    key,
    name,
    authority: v("authority") || null,
    kind,
    basis,
    offset_months: months,
    offset_days: days,
    business_days: form.get("business_days") === "on",
    fixed_month: basis === "fixed_date" || basis === "half_year" ? fm : null,
    fixed_day: basis === "fixed_date" || basis === "half_year" ? fd : null,
    alt_month: basis === "half_year" ? am : null,
    alt_day: basis === "half_year" ? ad : null,
    event_type: event,
    event_roles: kind === "event" && roles.length ? roles : null,
    to_confirm: form.get("to_confirm") === "on",
    notes: v("notes") || null,
    sort: 1000,
  });
  back(id, error ? (/duplicate key/.test(error.message) ? "This standard already has an obligation with that key." : obligationError(error.message)) : undefined, "obligation_saved");
}

export async function confirmObligation(id: string, obligationId: string) {
  const supabase = await approver(id);
  const { error } = await supabase.from("standard_obligations").update({ to_confirm: false }).eq("id", obligationId).eq("standard_id", id);
  back(id, error ? obligationError(error.message) : undefined, "obligation_saved");
}

export async function removeObligation(id: string, obligationId: string) {
  const supabase = await approver(id);
  const { data, error } = await supabase.from("standard_obligations").delete().eq("id", obligationId).eq("standard_id", id).select("id");
  if (!error && !data?.length) back(id, "Nothing was removed. Obligations can only be changed on a draft.");
  back(id, error ? obligationError(error.message) : undefined, "obligation_removed");
}
