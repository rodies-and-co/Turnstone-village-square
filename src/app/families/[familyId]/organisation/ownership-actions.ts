"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getFamilyContext } from "@/lib/family-context";
import { isDate, oneOf } from "@/lib/governance";
import type { SavedCode } from "@/lib/messages";
import { INTERESTS, TRANSACTION_KINDS, holderColumns } from "@/lib/ownership";
import { friendlyError } from "@/lib/people";
import { askToRemove } from "@/lib/removal";

// Ownership: share classes and transactions for companies and LLCs;
// settlements, beneficiaries and classes for trusts and foundations.
// Managers and Administrators record; a Manager who didn't prepare a share
// transaction approves it; removing takes two people (see src/lib/removal.ts). The family database checks
// all of this too.

const ORG_KINDS = ["trust_company", "registered_agent", "corporate_services", "management_company", "law_firm", "accounting_firm", "bank", "company", "other"];

function go(path: string, error?: string, saved: SavedCode = "saved"): never {
  revalidatePath(path.split("?")[0], "layout");
  const params = new URLSearchParams(error ? { error } : { saved });
  redirect(`${path}${path.includes("?") ? "&" : "?"}${params.toString()}`);
}
const back = (familyId: string, entityId: string) => `/families/${familyId}/organisation/${entityId}?tab=ownership`;

function text(form: FormData, name: string) {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}
const optional = (form: FormData, name: string) => text(form, name) || null;

function ownershipError(message: string | undefined) {
  const m = message ?? "";
  // The database's own checks on shares explain themselves.
  if (/^Shares: |^Ownership: /.test(m)) return m.replace(/^(Shares|Ownership): /, "");
  if (/share_classes_name/.test(m)) return "There is already a share class with that name.";
  if (/beneficiary_classes_name/.test(m)) return "There is already a class with that name.";
  if (/beneficiary_class_members_current/.test(m)) return "They are already in that class.";
  if (/beneficiaries_current/.test(m)) return "That beneficiary is already recorded.";
  if (/outside_organisations_name/.test(m)) return "There is already an outside organisation with that name. Choose it from the list instead.";
  return friendlyError(m);
}

const whole = (s: string) => /^\d{1,15}$/.test(s.replace(/[ ,]/g, "")) && Number(s.replace(/[ ,]/g, "")) > 0;
const amount = (s: string) => /^\d{1,14}(\.\d{1,6})?$/.test(s.replace(/[ ,]/g, ""));
const num = (s: string) => Number(s.replace(/[ ,]/g, ""));

type Ctx = Awaited<ReturnType<typeof getFamilyContext>>;

// The holder chosen in a form ("person:<id>", "entity:<id>",
// "organisation:<id>", or "new" with a new organisation's name and kind).
async function chosenHolder(ctx: Ctx, form: FormData, field: string, prefix: "to_" | "from_" | "") {
  const choice = text(form, field);
  if (choice === "new") {
    const name = text(form, `${field}_new_name`);
    const kind = text(form, `${field}_new_kind`) || "company";
    if (!name) return { error: "Please type the new organisation's name." };
    if (!ORG_KINDS.includes(kind)) return { error: "Please choose what kind of organisation it is." };
    const { data, error } = await ctx
      .db!.from("outside_organisations")
      .insert({
        name,
        kind,
        jurisdiction: optional(form, `${field}_new_jurisdiction`),
        registration_number: optional(form, `${field}_new_registration`),
      })
      .select("id")
      .single();
    if (error || !data) return { error: ownershipError(error?.message) };
    return { value: holderColumns(`organisation:${data.id}`, prefix)! };
  }
  const cols = holderColumns(choice, prefix);
  return cols ? { value: cols } : { error: "Please choose who it is." };
}

async function editor(familyId: string, entityId: string) {
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db || !ctx.canEdit) go(back(familyId, entityId), "You don't have permission to change this entity.");
  return ctx;
}
async function manager(familyId: string, entityId: string, what: string) {
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db || !ctx.canManage) go(back(familyId, entityId), `Only a Manager can ${what}.`);
  return ctx;
}

// ---------------------------------------------------------------------------
// Share classes and transactions

export async function addShareClass(familyId: string, entityId: string, form: FormData) {
  const to = back(familyId, entityId);
  const ctx = await editor(familyId, entityId);
  const name = text(form, "name");
  const currency = text(form, "currency").toUpperCase();
  const par = text(form, "par_value");
  const authorised = text(form, "authorised");
  const limited = form.get("limited") === "on";
  if (!name) go(to, "Please name the class, e.g. Ordinary.");
  if (!/^[A-Z]{3}$/.test(currency)) go(to, "The currency should be three letters, e.g. GBP.");
  if (par && !amount(par)) go(to, "The par value should be a number, e.g. 1 or 0.01.");
  if (authorised && !whole(authorised)) go(to, "The number of authorised shares should be a whole number.");
  if (limited && !authorised) go(to, "Please give the number of shares authorised, or untick the limit.");

  const { data, error } = await ctx
    .db!.from("share_classes")
    .insert({ entity_id: entityId, name, currency, par_value: par ? num(par) : null, limited, voting: form.get("voting") === "on", notes: optional(form, "notes") })
    .select("id")
    .single();
  if (error || !data) go(to, ownershipError(error?.message));
  if (authorised) {
    const date = text(form, "authorised_on");
    if (date && !isDate(date)) go(to, "Please enter the date as day, month and year.");
    const { error: e } = await ctx.db!.from("share_transactions").insert({
      entity_id: entityId,
      class_id: data.id,
      kind: "authorise",
      transaction_date: date || new Date().toISOString().slice(0, 10),
      shares: num(authorised),
      resolution: optional(form, "resolution"),
    });
    if (e) go(to, `The class was added, but the authorised shares weren't: ${ownershipError(e.message)}`);
    go(to, undefined, "share_class_added_authorised");
  }
  go(to, undefined, "share_class_added");
}

export async function removeShareClass(familyId: string, entityId: string, classId: string) {
  const ctx = await getFamilyContext(familyId);
  const error = await askToRemove(ctx, "share_classes", classId, { entity_id: entityId });
  go(back(familyId, entityId), error ?? undefined, "removal_requested");
}

export async function recordShareTransaction(familyId: string, entityId: string, form: FormData) {
  const to = back(familyId, entityId);
  const ctx = await editor(familyId, entityId);
  const kind = text(form, "kind");
  const classId = text(form, "class_id");
  const date = text(form, "transaction_date");
  const shares = text(form, "shares");
  const consideration = text(form, "consideration");
  if (!oneOf(kind, TRANSACTION_KINDS)) go(to, "Please choose what happened.");
  if (!classId) go(to, "Please choose the class of shares.");
  if (!isDate(date)) go(to, "Please enter the date as day, month and year.");
  if (!whole(shares)) go(to, "The number of shares should be a whole number.");
  if (consideration && !amount(consideration)) go(to, "The amount paid should be a number.");

  let holders: Record<string, string | null> = {};
  if (kind !== "authorise") {
    const receiver = await chosenHolder(ctx, form, "to", "to_");
    if ("error" in receiver) go(to, receiver.error);
    holders = { ...receiver.value };
  }
  if (kind === "transfer") {
    const giver = await chosenHolder(ctx, form, "from", "from_");
    if ("error" in giver) go(to, giver.error);
    holders = { ...holders, ...giver.value };
  }

  const { error } = await ctx.db!.from("share_transactions").insert({
    entity_id: entityId,
    class_id: classId,
    kind,
    transaction_date: date,
    shares: num(shares),
    ...holders,
    certificate_number: kind === "authorise" ? null : optional(form, "certificate_number"),
    balance_certificate_number: kind === "transfer" ? optional(form, "balance_certificate_number") : null,
    consideration: consideration ? num(consideration) : null,
    resolution: optional(form, "resolution"),
    notes: optional(form, "notes"),
  });
  go(to, error ? ownershipError(error.message) : undefined, "share_transaction_recorded");
}

// Approves the draft exactly as the Manager saw it: if it was changed since
// the page was loaded, nothing is approved and the Manager is asked to look again.
export async function approveShareTransaction(familyId: string, entityId: string, transactionId: string, seenVersion: string) {
  const ctx = await manager(familyId, entityId, "approve a share transaction");
  const { data, error } = await ctx
    .db!.from("share_transactions")
    .update({ status: "approved" })
    .eq("id", transactionId)
    .eq("entity_id", entityId)
    .eq("status", "draft")
    .eq("updated_at", seenVersion)
    .select("id");
  if (!error && !data?.length) go(back(familyId, entityId), "Not approved: the transaction was changed or approved since you opened the page. Please look at it again.");
  go(back(familyId, entityId), error ? ownershipError(error.message) : undefined, "share_transaction_approved");
}

export async function removeShareTransaction(familyId: string, entityId: string, transactionId: string) {
  const ctx = await getFamilyContext(familyId);
  const error = await askToRemove(ctx, "share_transactions", transactionId, { entity_id: entityId });
  go(back(familyId, entityId), error ?? undefined, "removal_requested");
}

// ---------------------------------------------------------------------------
// Trusts and foundations

export async function addSettlement(familyId: string, entityId: string, form: FormData) {
  const to = back(familyId, entityId);
  const ctx = await editor(familyId, entityId);
  const kind = text(form, "kind") || "initial";
  const date = text(form, "settled_on");
  const value = text(form, "amount");
  const currency = text(form, "currency").toUpperCase();
  if (!["initial", "additional"].includes(kind)) go(to, "Please choose the kind of settlement.");
  if (date && !isDate(date)) go(to, "Please enter the date as day, month and year.");
  if (value && !amount(value)) go(to, "The value should be a number.");
  if (value && !/^[A-Z]{3}$/.test(currency)) go(to, "Please give the currency of the value, e.g. ZAR.");
  const holder = await chosenHolder(ctx, form, "holder", "");
  if ("error" in holder) go(to, holder.error);
  const { error } = await ctx.db!.from("settlements").insert({
    entity_id: entityId,
    kind,
    ...holder.value,
    settled_on: date || null,
    description: optional(form, "description"),
    amount: value ? num(value) : null,
    currency: value ? currency : currency || null,
    notes: optional(form, "notes"),
  });
  go(to, error ? ownershipError(error.message) : undefined, "settlement_added");
}

export async function removeSettlement(familyId: string, entityId: string, id: string) {
  const ctx = await getFamilyContext(familyId);
  const error = await askToRemove(ctx, "settlements", id, { entity_id: entityId });
  go(back(familyId, entityId), error ?? undefined, "removal_requested");
}

export async function addBeneficiary(familyId: string, entityId: string, form: FormData) {
  const to = back(familyId, entityId);
  const ctx = await editor(familyId, entityId);
  const interest = text(form, "interest") || "discretionary";
  const share = text(form, "share_percent");
  const added = text(form, "added_on");
  if (!oneOf(interest, INTERESTS)) go(to, "Please choose the kind of interest.");
  if (share && (!amount(share) || num(share) <= 0 || num(share) > 100)) go(to, "The share should be a percentage between 0 and 100.");
  if (added && !isDate(added)) go(to, "Please enter the date as day, month and year.");
  let who: Record<string, string | null>;
  if (text(form, "holder") === "cause") {
    const cause = text(form, "cause");
    if (!cause) go(to, "Please describe the charitable cause.");
    who = { cause };
  } else {
    const holder = await chosenHolder(ctx, form, "holder", "");
    if ("error" in holder) go(to, holder.error);
    who = holder.value;
  }
  const { error } = await ctx.db!.from("beneficiaries").insert({
    entity_id: entityId,
    ...who,
    interest,
    share_percent: share ? num(share) : null,
    added_on: added || null,
    notes: optional(form, "notes"),
  });
  go(to, error ? ownershipError(error.message) : undefined, "beneficiary_added");
}

export async function endBeneficiary(familyId: string, entityId: string, id: string) {
  const ctx = await editor(familyId, entityId);
  const { error } = await ctx.db!.from("beneficiaries").update({ ceased_on: new Date().toISOString().slice(0, 10) }).eq("id", id).eq("entity_id", entityId);
  go(back(familyId, entityId), error ? ownershipError(error.message) : undefined, "beneficiary_ended");
}

export async function removeBeneficiary(familyId: string, entityId: string, id: string) {
  const ctx = await getFamilyContext(familyId);
  const error = await askToRemove(ctx, "beneficiaries", id, { entity_id: entityId });
  go(back(familyId, entityId), error ?? undefined, "removal_requested");
}

export async function addBeneficiaryClass(familyId: string, entityId: string, form: FormData) {
  const to = back(familyId, entityId);
  const ctx = await editor(familyId, entityId);
  const name = text(form, "name");
  if (!name) go(to, "Please name the class, e.g. The descendants of Tom Hartley.");
  const { error } = await ctx.db!.from("beneficiary_classes").insert({ entity_id: entityId, name, description: optional(form, "description") });
  go(to, error ? ownershipError(error.message) : undefined, "beneficiary_class_added");
}

export async function removeBeneficiaryClass(familyId: string, entityId: string, id: string) {
  const ctx = await getFamilyContext(familyId);
  const error = await askToRemove(ctx, "beneficiary_classes", id, { entity_id: entityId });
  go(back(familyId, entityId), error ?? undefined, "removal_requested");
}

export async function addClassMember(familyId: string, entityId: string, classId: string, form: FormData) {
  const to = back(familyId, entityId);
  const ctx = await editor(familyId, entityId);
  const personId = text(form, "person_id");
  const added = text(form, "added_on");
  if (!personId) go(to, "Please choose the person.");
  if (added && !isDate(added)) go(to, "Please enter the date as day, month and year.");
  const { error } = await ctx.db!.from("beneficiary_class_members").insert({ entity_id: entityId, class_id: classId, person_id: personId, added_on: added || null });
  go(to, error ? ownershipError(error.message) : undefined, "class_member_added");
}

export async function endClassMember(familyId: string, entityId: string, id: string) {
  const ctx = await editor(familyId, entityId);
  const { error } = await ctx
    .db!.from("beneficiary_class_members")
    .update({ ceased_on: new Date().toISOString().slice(0, 10) })
    .eq("id", id)
    .eq("entity_id", entityId);
  go(back(familyId, entityId), error ? ownershipError(error.message) : undefined, "class_member_ended");
}
