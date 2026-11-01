"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getFamilyContext } from "@/lib/family-context";
import {
  addressMatchKey,
  friendlyError,
  parseAddress,
  parseDetailsForm,
  parsePersonForm,
  parsePhone,
  ADDRESS_KINDS,
  PARENT_KINDS,
  PARTNERSHIP_END_REASONS,
  PARTNERSHIP_KINDS,
} from "@/lib/people";

// Every change goes to the family's own database as the signed-in person, so
// the database decides whether it is allowed. These checks only give a clear
// message earlier.

function personUrl(familyId: string, personId: string, tab: string, extra: Record<string, string> = {}) {
  const params = new URLSearchParams({ tab, ...extra });
  return `/families/${familyId}/tree/${personId}?${params.toString()}`;
}

function done(familyId: string, personId: string, tab: string, error?: string): never {
  revalidatePath(`/families/${familyId}/tree`);
  redirect(personUrl(familyId, personId, tab, error ? { error } : { saved: "1" }));
}

async function editorContext(familyId: string) {
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db || !ctx.canEdit) return null;
  return ctx;
}

function text(form: FormData, name: string) {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export async function createPerson(familyId: string, form: FormData) {
  const ctx = await editorContext(familyId);
  const back = `/families/${familyId}/tree/new`;
  if (!ctx?.db) redirect(`${back}?error=${encodeURIComponent("You don't have permission to add people.")}`);

  const parsed = parsePersonForm(form);
  if (!parsed.ok) redirect(`${back}?error=${encodeURIComponent(parsed.error)}`);

  const branch = text(form, "branch_id") || null;
  const { data, error } = await ctx.db
    .from("people")
    .insert({ ...parsed.value, branch_id: branch })
    .select("id")
    .single();
  if (error || !data) redirect(`${back}?error=${encodeURIComponent(friendlyError(error?.message))}`);

  revalidatePath(`/families/${familyId}/tree`);
  redirect(personUrl(familyId, data.id, "overview", { saved: "1" }));
}

export async function updatePerson(familyId: string, personId: string, form: FormData) {
  const ctx = await editorContext(familyId);
  if (!ctx?.db) done(familyId, personId, "overview", "You don't have permission to change this record.");

  const parsed = parsePersonForm(form);
  if (!parsed.ok) done(familyId, personId, "overview", parsed.error);

  const changes: Record<string, unknown> = { ...parsed.value };
  // Only Managers may move someone to another branch (it changes what Viewers see).
  if (ctx.canManage) changes.branch_id = text(form, "branch_id") || null;

  const { error } = await ctx.db.from("people").update(changes).eq("id", personId);
  done(familyId, personId, "overview", error ? friendlyError(error.message) : undefined);
}

export async function removePerson(familyId: string, personId: string) {
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db || !ctx.canManage) done(familyId, personId, "overview", "Only a Manager can remove a person.");
  const { error } = await ctx.db.from("people").delete().eq("id", personId);
  if (error) done(familyId, personId, "overview", friendlyError(error.message));
  revalidatePath(`/families/${familyId}/tree`);
  redirect(`/families/${familyId}/tree?removed=1`);
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export async function saveDetails(familyId: string, personId: string, form: FormData) {
  const ctx = await editorContext(familyId);
  if (!ctx?.db) done(familyId, personId, "identity", "You don't have permission to change this record.");
  const parsed = parseDetailsForm(form);
  if (!parsed.ok) done(familyId, personId, "identity", parsed.error);

  const { error } = await ctx.db
    .from("person_details")
    .upsert({ person_id: personId, ...parsed.value }, { onConflict: "person_id" });
  done(familyId, personId, "identity", error ? friendlyError(error.message) : undefined);
}

export async function addPassport(familyId: string, personId: string, form: FormData) {
  const ctx = await editorContext(familyId);
  if (!ctx?.db) done(familyId, personId, "identity", "You don't have permission to change this record.");
  const country = text(form, "country");
  const number = text(form, "number");
  const expires = text(form, "expires_on") || null;
  if (!country || !number) done(familyId, personId, "identity", "Please fill in the passport's country and number.");
  const { error } = await ctx.db
    .from("passports")
    .insert({ person_id: personId, country, number, expires_on: expires });
  done(familyId, personId, "identity", error ? friendlyError(error.message) : undefined);
}

// Removing is for Managers only; the database checks this too.
async function removeRow(familyId: string, personId: string, tab: string, table: string, id: string) {
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db || !ctx.canManage) done(familyId, personId, tab, "Only a Manager can remove this.");
  const { error } = await ctx.db.from(table).delete().eq("id", id);
  done(familyId, personId, tab, error ? friendlyError(error.message) : undefined);
}

export async function removePassport(familyId: string, personId: string, id: string) {
  await removeRow(familyId, personId, "identity", "passports", id);
}

// ---------------------------------------------------------------------------
// Addresses and contact details
// ---------------------------------------------------------------------------

export async function addPhone(familyId: string, personId: string, form: FormData) {
  const ctx = await editorContext(familyId);
  if (!ctx?.db) done(familyId, personId, "addresses", "You don't have permission to change this record.");
  const parsed = parsePhone(form);
  if (!parsed.ok) done(familyId, personId, "addresses", parsed.error);
  const { error } = await ctx.db.from("phone_numbers").insert({ person_id: personId, ...parsed.value });
  done(familyId, personId, "addresses", error ? friendlyError(error.message) : undefined);
}

export async function removePhone(familyId: string, personId: string, id: string) {
  await removeRow(familyId, personId, "addresses", "phone_numbers", id);
}

// Uses an address already in the family's list, or adds a new one. A new
// address that matches an existing one is reused, so it is never stored twice.
export async function addAddress(familyId: string, personId: string, form: FormData) {
  const ctx = await editorContext(familyId);
  if (!ctx?.db) done(familyId, personId, "addresses", "You don't have permission to change this record.");
  const db = ctx.db;

  const kind = text(form, "kind") || "home";
  if (!(kind in ADDRESS_KINDS)) done(familyId, personId, "addresses", "Please choose what the address is used for.");

  let addressId = text(form, "address_id");
  if (!addressId) {
    const parsed = parseAddress(form);
    if (!parsed.ok) done(familyId, personId, "addresses", parsed.error);
    const key = addressMatchKey(parsed.value);
    const { data: existing } = await db.from("addresses").select("id").eq("match_key", key).maybeSingle();
    if (existing) {
      addressId = existing.id;
    } else {
      const { data, error } = await db.from("addresses").insert(parsed.value).select("id").single();
      if (error || !data) done(familyId, personId, "addresses", friendlyError(error?.message));
      addressId = data.id;
    }
  }

  const { error } = await db.from("person_addresses").insert({ person_id: personId, address_id: addressId, kind });
  done(familyId, personId, "addresses", error ? friendlyError(error.message) : undefined);
}

export async function removePersonAddress(familyId: string, personId: string, id: string) {
  await removeRow(familyId, personId, "addresses", "person_addresses", id);
}

// ---------------------------------------------------------------------------
// Family links
// ---------------------------------------------------------------------------

export async function addLink(familyId: string, personId: string, form: FormData) {
  const ctx = await editorContext(familyId);
  if (!ctx?.db) done(familyId, personId, "relationships", "You don't have permission to change this record.");
  const other = text(form, "other_id");
  const link = text(form, "link");
  if (!other) done(familyId, personId, "relationships", "Please choose the other person.");

  let error: { message: string } | null = null;
  if (link === "parent" || link === "child") {
    const kind = text(form, "parent_kind") || "birth";
    if (!(kind in PARENT_KINDS)) done(familyId, personId, "relationships", "Please choose the kind of parent.");
    const row = link === "parent" ? { parent_id: other, child_id: personId, kind } : { parent_id: personId, child_id: other, kind };
    ({ error } = await ctx.db.from("parent_child").insert(row));
  } else if (link === "partner") {
    const kind = text(form, "partnership_kind") || "marriage";
    if (!(kind in PARTNERSHIP_KINDS)) done(familyId, personId, "relationships", "Please choose the kind of partnership.");
    const endReason = text(form, "end_reason") || null;
    if (endReason && !(endReason in PARTNERSHIP_END_REASONS)) done(familyId, personId, "relationships", "Please choose from the list.");
    const end = text(form, "end_date") || null;
    if (endReason && !end) done(familyId, personId, "relationships", "Please add the date the partnership ended.");
    ({ error } = await ctx.db.from("partnerships").insert({
      person_a: personId,
      person_b: other,
      kind,
      start_date: text(form, "start_date") || null,
      end_date: end,
      end_reason: endReason,
    }));
  } else {
    done(familyId, personId, "relationships", "Please choose the kind of link.");
  }
  done(familyId, personId, "relationships", error ? friendlyError(error.message) : undefined);
}

export async function removeParentLink(familyId: string, personId: string, id: string) {
  await removeRow(familyId, personId, "relationships", "parent_child", id);
}

export async function removePartnership(familyId: string, personId: string, id: string) {
  await removeRow(familyId, personId, "relationships", "partnerships", id);
}

// ---------------------------------------------------------------------------
// Finances
// ---------------------------------------------------------------------------

export async function addTaxNumber(familyId: string, personId: string, form: FormData) {
  const ctx = await editorContext(familyId);
  if (!ctx?.db) done(familyId, personId, "finances", "You don't have permission to change this record.");
  const country = text(form, "country");
  const number = text(form, "number");
  if (!country || !number) done(familyId, personId, "finances", "Please fill in the country and the tax number.");
  const { error } = await ctx.db.from("tax_numbers").insert({ person_id: personId, country, number });
  done(familyId, personId, "finances", error ? friendlyError(error.message) : undefined);
}

export async function removeTaxNumber(familyId: string, personId: string, id: string) {
  await removeRow(familyId, personId, "finances", "tax_numbers", id);
}
