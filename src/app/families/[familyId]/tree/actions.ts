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
import type { SavedCode } from "@/lib/messages";
import { askToRemove } from "@/lib/removal";

// Every change goes to the family's own database as the signed-in person, so
// the database decides whether it is allowed. These checks only give a clear
// message earlier.

function personUrl(familyId: string, personId: string, tab: string, extra: Record<string, string> = {}) {
  const params = new URLSearchParams({ tab, ...extra });
  return `/families/${familyId}/tree/${personId}?${params.toString()}`;
}

// Back to the person's page, with an error or a confirmation message.
function done(familyId: string, personId: string, tab: string, error?: string, saved: SavedCode = "saved"): never {
  revalidatePath(`/families/${familyId}/tree`);
  redirect(personUrl(familyId, personId, tab, error ? { error } : { saved }));
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
  const { date_of_birth, ...person } = parsed.value;
  const { data, error } = await ctx.db
    .from("people")
    .insert({ ...person, branch_id: branch })
    .select("id")
    .single();
  if (error || !data) redirect(`${back}?error=${encodeURIComponent(friendlyError(error?.message))}`);

  if (date_of_birth) {
    const { error: dobError } = await ctx.db.from("person_details").insert({ person_id: data.id, date_of_birth });
    if (dobError) done(familyId, data.id, "overview", `The person was added, but the date of birth wasn't saved: ${friendlyError(dobError.message)}`);
  }

  revalidatePath(`/families/${familyId}/tree`);
  redirect(personUrl(familyId, data.id, "overview", { saved: "person_added" }));
}

export async function updatePerson(familyId: string, personId: string, form: FormData) {
  const ctx = await editorContext(familyId);
  if (!ctx?.db) done(familyId, personId, "overview", "You don't have permission to change this record.");

  const parsed = parsePersonForm(form);
  if (!parsed.ok) done(familyId, personId, "overview", parsed.error);

  const { date_of_birth, ...changes } = parsed.value as typeof parsed.value & { branch_id?: string | null };
  // Only Managers may move someone to another branch (it changes what Viewers see).
  if (ctx.canManage) changes.branch_id = text(form, "branch_id") || null;

  // The full date of birth is a personal detail, kept in person_details. Save
  // it first: the database then keeps the year on the person's record in step.
  const { error: dobError } = date_of_birth
    ? await ctx.db.from("person_details").upsert({ person_id: personId, date_of_birth }, { onConflict: "person_id" })
    : await ctx.db.from("person_details").update({ date_of_birth: null }).eq("person_id", personId);
  if (dobError) done(familyId, personId, "overview", friendlyError(dobError.message));

  const { error } = await ctx.db.from("people").update(changes).eq("id", personId);
  done(familyId, personId, "overview", error ? friendlyError(error.message) : undefined);
}

export async function removePerson(familyId: string, personId: string) {
  const ctx = await getFamilyContext(familyId);
  const error = await askToRemove(ctx, "people", personId);
  done(familyId, personId, "overview", error ?? undefined, "removal_requested");
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
  done(familyId, personId, "identity", error ? friendlyError(error.message) : undefined, "details_saved");
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
  done(familyId, personId, "identity", error ? friendlyError(error.message) : undefined, "passport_added");
}

// Removing takes two people: this asks, and a Manager who didn't ask
// approves it on the family Overview. The database checks this too.
async function removeRow(familyId: string, personId: string, tab: string, table: string, id: string) {
  const ctx = await getFamilyContext(familyId);
  const error = await askToRemove(ctx, table, id);
  done(familyId, personId, tab, error ?? undefined, "removal_requested");
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
  done(familyId, personId, "addresses", error ? friendlyError(error.message) : undefined, "phone_added");
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
  let shared = Boolean(addressId);
  if (!addressId) {
    const parsed = parseAddress(form);
    if (!parsed.ok) done(familyId, personId, "addresses", parsed.error);
    const key = addressMatchKey(parsed.value);
    const { data: existing } = await db.from("addresses").select("id").eq("match_key", key).maybeSingle();
    if (existing) {
      addressId = existing.id;
      shared = true;
    } else {
      const { data, error } = await db.from("addresses").insert(parsed.value).select("id").single();
      if (error || !data) done(familyId, personId, "addresses", friendlyError(error?.message));
      addressId = data.id;
    }
  }

  const { error } = await db.from("person_addresses").insert({ person_id: personId, address_id: addressId, kind });
  done(familyId, personId, "addresses", error ? friendlyError(error.message) : undefined, shared ? "address_shared" : "address_added");
}

export async function removePersonAddress(familyId: string, personId: string, id: string) {
  await removeRow(familyId, personId, "addresses", "person_addresses", id);
}

// ---------------------------------------------------------------------------
// Family links
// ---------------------------------------------------------------------------

// When a child is added to a wealth creator, the Branches page asks whether
// that child starts a branch. Tell the person so straight away. Same rules as
// the Branches page: birth or adoptive link, a family member, not already
// heading a branch, and not already answered "No".
async function branchQuestionFor(
  db: NonNullable<NonNullable<Awaited<ReturnType<typeof editorContext>>>["db"]>,
  parents: string[],
  child: string,
  kind: string,
) {
  if (kind !== "birth" && kind !== "adopted") return false;
  const [{ data: creators }, { data: heads }, { data: person }, { data: answered }] = await Promise.all([
    db.from("wealth_creators").select("person_id").in("person_id", parents),
    db.from("branches").select("id").eq("head_person_id", child).limit(1),
    db.from("people").select("member_type").eq("id", child).maybeSingle(),
    db.from("branch_answers").select("id").eq("person_id", child).eq("question", "starts_branch").limit(1),
  ]);
  return Boolean((creators ?? []).length) && !(heads ?? []).length && person?.member_type !== "non_family" && !(answered ?? []).length;
}

// One family link is stored once and shows on both people's records: "Parent
// of" on one is "Child of" on the other, and a spouse or partner shows on both.
export async function addLink(familyId: string, personId: string, form: FormData) {
  const tab = "relationships";
  const ctx = await editorContext(familyId);
  if (!ctx?.db) done(familyId, personId, tab, "You don't have permission to change this record.");
  const db = ctx.db;
  const relation = text(form, "relation");
  const other = text(form, "other_id");
  if (!other) done(familyId, personId, tab, "Please choose the other person.");
  if (other === personId) done(familyId, personId, tab, "Please choose someone else.");

  if (relation === "parent_of" || relation === "child_of") {
    const kind = text(form, "parent_kind") || "birth";
    if (!(kind in PARENT_KINDS)) done(familyId, personId, tab, "Please choose the kind of parent.");
    const child = relation === "parent_of" ? other : personId;
    const parent = relation === "parent_of" ? personId : other;
    const { error } = await db.from("parent_child").insert({ parent_id: parent, child_id: child, kind });
    if (error) done(familyId, personId, tab, friendlyError(error.message));

    // Optionally the parent's spouse or partner as the other parent, but only
    // if they really are recorded as the parent's spouse or partner.
    const second = text(form, "also_parent");
    if (second && second !== parent && second !== child) {
      const { data: partnership } = await db
        .from("partnerships")
        .select("id")
        .eq("person_a", parent < second ? parent : second)
        .eq("person_b", parent < second ? second : parent)
        .is("end_date", null)
        .limit(1)
        .maybeSingle();
      if (!partnership) done(familyId, personId, tab, "The first link was added. The second parent wasn't, because they aren't recorded as a current spouse or partner.");
      // Already recorded as a parent? Then there is nothing more to add.
      const { data: already } = await db.from("parent_child").select("id").eq("parent_id", second).eq("child_id", child).maybeSingle();
      if (already) done(familyId, personId, tab, undefined, (await branchQuestionFor(db, [parent, second], child, kind)) ? "link_added_branch_question" : "link_added");
      const { error: e2 } = await db.from("parent_child").insert({ parent_id: second, child_id: child, kind });
      if (e2) done(familyId, personId, tab, `The first link was added, but not the second parent: ${friendlyError(e2.message)}`);
      done(familyId, personId, tab, undefined, (await branchQuestionFor(db, [parent, second], child, kind)) ? "link_added_branch_question" : "links_added");
    }
    done(familyId, personId, tab, undefined, (await branchQuestionFor(db, [parent], child, kind)) ? "link_added_branch_question" : "link_added");
  }

  if (relation === "partner_of") {
    const kind = text(form, "partnership_kind") || "marriage";
    if (!(kind in PARTNERSHIP_KINDS)) done(familyId, personId, tab, "Please choose whether they are married, in a civil partnership or partners.");
    const endReason = text(form, "end_reason") || null;
    if (endReason && !(endReason in PARTNERSHIP_END_REASONS)) done(familyId, personId, tab, "Please choose from the list.");
    const start = text(form, "start_date") || null;
    const end = text(form, "end_date") || null;
    if (endReason && !end) done(familyId, personId, tab, "Please add the date it ended.");
    if (end && !endReason) done(familyId, personId, tab, "Please say why it ended.");
    if (start && end && end < start) done(familyId, personId, tab, "The end date can't be before the start date.");
    const { error } = await db.from("partnerships").insert({
      person_a: personId,
      person_b: other,
      kind,
      start_date: start,
      end_date: end,
      end_reason: endReason,
    });
    done(familyId, personId, tab, error ? friendlyError(error.message) : undefined, "link_added");
  }

  done(familyId, personId, tab, "Please choose the relationship.");
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
  done(familyId, personId, "finances", error ? friendlyError(error.message) : undefined, "tax_added");
}

export async function removeTaxNumber(familyId: string, personId: string, id: string) {
  await removeRow(familyId, personId, "finances", "tax_numbers", id);
}
