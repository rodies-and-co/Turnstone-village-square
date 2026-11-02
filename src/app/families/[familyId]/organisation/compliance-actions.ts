"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getFamilyContext } from "@/lib/family-context";
import { isDate } from "@/lib/governance";
import type { SavedCode } from "@/lib/messages";
import { friendlyError } from "@/lib/people";
import { askToRemove } from "@/lib/removal";

// Recording what was done about a filing or notice in the compliance
// calendar. Managers and Administrators record; removing a record takes two
// people, like every removal.

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
};

// Back to the page the form was on (the family calendar or an entity's tab).
function go(familyId: string, back: string, error?: string, saved: SavedCode = "saved"): never {
  const safe = back.startsWith(`/families/${familyId}/organisation`) ? back : `/families/${familyId}/organisation/compliance`;
  revalidatePath(`/families/${familyId}/organisation`, "layout");
  const params = new URLSearchParams(error ? { error } : { saved });
  redirect(`${safe}${safe.includes("?") ? "&" : "?"}${params.toString()}`);
}

export async function recordFiling(familyId: string, entityId: string, form: FormData) {
  const back = text(form, "back");
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db || !ctx.canEdit) go(familyId, back, "You don't have permission to record filings.");
  const status = text(form, "status");
  const key = text(form, "obligation_key");
  const due = text(form, "due_date");
  const doneOn = text(form, "done_on");
  if (!["filed", "not_applicable"].includes(status)) go(familyId, back, "Please say whether it was filed or doesn't apply.");
  if (!/^[a-z0-9_]{2,60}$/.test(key) || !isDate(due)) go(familyId, back, "That item couldn't be found. Please reload the page and try again.");
  if (status === "filed" && !isDate(doneOn)) go(familyId, back, "Please give the date it was filed.");
  if (status === "not_applicable" && !text(form, "notes")) go(familyId, back, "Please say why it doesn't apply.");

  const record = {
    entity_id: entityId,
    obligation_key: key,
    obligation_name: text(form, "obligation_name") || key,
    due_date: due,
    event_key: text(form, "event_key") || null,
    status,
    done_on: status === "filed" ? doneOn : null,
    reference: text(form, "reference") || null,
    notes: text(form, "notes") || null,
  };
  const existing = text(form, "filing_id");
  const { error } = existing
    ? await ctx.db.from("compliance_filings").update(record).eq("id", existing).eq("entity_id", entityId)
    : await ctx.db.from("compliance_filings").insert(record);
  const clash = error && /duplicate key/.test(error.message) ? "That has already been recorded. Please reload the page." : null;
  go(familyId, back, error ? (clash ?? friendlyError(error.message)) : undefined, status === "filed" ? "filing_recorded" : "filing_not_applicable");
}

export async function removeFiling(familyId: string, entityId: string, filingId: string, back: string) {
  const ctx = await getFamilyContext(familyId);
  const error = await askToRemove(ctx, "compliance_filings", filingId, { entity_id: entityId });
  go(familyId, back, error ?? undefined, "removal_requested");
}
