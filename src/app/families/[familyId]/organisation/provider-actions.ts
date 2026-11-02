"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getFamilyContext } from "@/lib/family-context";
import { isDate } from "@/lib/governance";
import type { SavedCode } from "@/lib/messages";
import { addressMatchKey, friendlyError, parseAddress } from "@/lib/people";
import { askToRemove } from "@/lib/removal";

// Service providers: the firms that serve the family's entities, each
// recorded once. Managers and Administrators add and change; removing one
// takes two people, like every removal.

const KINDS = ["trust_company", "registered_agent", "corporate_services", "management_company", "law_firm", "accounting_firm", "bank", "company", "other"];

function go(familyId: string, error?: string, saved: SavedCode = "saved", anchor = ""): never {
  revalidatePath(`/families/${familyId}/organisation`, "layout");
  const params = new URLSearchParams(error ? { error } : { saved });
  redirect(`/families/${familyId}/organisation/providers?${params.toString()}${anchor}`);
}
const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
};
const optional = (form: FormData, name: string) => text(form, name) || null;

function providerError(message: string | undefined) {
  if (/outside_organisations_name/.test(message ?? "")) return "There is already a service provider with that name.";
  if (/email/.test(message ?? "") && /check/.test(message ?? "")) return "That email address doesn't look right.";
  if (/phone/.test(message ?? "") && /check/.test(message ?? "")) return "That phone number doesn't look right.";
  return friendlyError(message);
}

function details(form: FormData) {
  const kind = text(form, "kind") || "other";
  const incorporated = text(form, "incorporated_on");
  if (!text(form, "name")) return { error: "Please give the provider's name." };
  if (!KINDS.includes(kind)) return { error: "Please choose what kind of provider it is." };
  if (incorporated && !isDate(incorporated)) return { error: "Please enter the date as day, month and year." };
  const licensed = form.get("licensed") === "on";
  return {
    value: {
      name: text(form, "name"),
      kind,
      jurisdiction: optional(form, "jurisdiction"),
      registration_number: optional(form, "registration_number"),
      incorporated_on: incorporated || null,
      licensed,
      licence_number: optional(form, "licence_number"),
      regulator: optional(form, "regulator"),
      contact_name: optional(form, "contact_name"),
      email: optional(form, "email"),
      phone: optional(form, "phone"),
      notes: optional(form, "notes"),
    },
  };
}

// The address typed in (if any): an existing address is reused, never stored twice.
async function addressId(ctx: Awaited<ReturnType<typeof getFamilyContext>>, form: FormData) {
  if (!text(form, "line1") && !text(form, "city")) return { id: undefined };
  const parsed = parseAddress(form);
  if (!parsed.ok) return { error: parsed.error };
  const { data: existing } = await ctx.db!.from("addresses").select("id").eq("match_key", addressMatchKey(parsed.value)).maybeSingle();
  if (existing) return { id: existing.id as string };
  const { data, error } = await ctx.db!.from("addresses").insert(parsed.value).select("id").single();
  if (error || !data) return { error: friendlyError(error?.message) };
  return { id: data.id as string };
}

export async function addProvider(familyId: string, form: FormData) {
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db || !ctx.canEdit) go(familyId, "You don't have permission to add service providers.");
  const d = details(form);
  if ("error" in d) go(familyId, d.error);
  const a = await addressId(ctx, form);
  if ("error" in a) go(familyId, a.error);
  const { data, error } = await ctx.db.from("outside_organisations").insert({ ...d.value, address_id: a.id ?? null }).select("id").single();
  go(familyId, error ? providerError(error.message) : undefined, "provider_added", data ? `#p-${data.id}` : "");
}

export async function updateProvider(familyId: string, providerId: string, form: FormData) {
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db || !ctx.canEdit) go(familyId, "You don't have permission to change service providers.");
  const d = details(form);
  if ("error" in d) go(familyId, d.error);
  const a = await addressId(ctx, form);
  if ("error" in a) go(familyId, a.error);
  const { error } = await ctx.db
    .from("outside_organisations")
    .update({ ...d.value, ...(a.id ? { address_id: a.id } : {}) })
    .eq("id", providerId);
  go(familyId, error ? providerError(error.message) : undefined, "provider_saved", `#p-${providerId}`);
}

export async function removeProvider(familyId: string, providerId: string) {
  const ctx = await getFamilyContext(familyId);
  const error = await askToRemove(ctx, "outside_organisations", providerId);
  go(familyId, error ?? undefined, "removal_requested", `#p-${providerId}`);
}
