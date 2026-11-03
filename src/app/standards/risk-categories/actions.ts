"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSignedIn } from "@/lib/auth";
import type { SavedCode } from "@/lib/messages";

// Risk categories are shared by every family. Only the Super User and the
// System Admin change them; the hub database enforces this too.

const PAGE = "/standards/risk-categories";
function back(error?: string, saved: SavedCode = "saved"): never {
  revalidatePath(PAGE);
  redirect(`${PAGE}?${new URLSearchParams(error ? { error } : { saved }).toString()}`);
}
async function approver() {
  const session = await requireSignedIn();
  if (session.systemRole !== "super_user" && session.systemRole !== "system_admin")
    back("Only the Super User or System Admin can change the risk categories.");
  return session.supabase;
}
function text(form: FormData, name: string) {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}
// One subcategory per line.
const lines = (s: string) => [...new Set(s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))];

export async function addCategory(form: FormData) {
  const db = await approver();
  const name = text(form, "name");
  if (!name) back("Please give the category a name.");
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "c_$1").slice(0, 40);
  if (key.length < 2) back("Please give the category a name with letters in it.");
  const { error } = await db.from("risk_categories").insert({
    key,
    name,
    description: text(form, "description") || null,
    subcategories: lines(text(form, "subcategories")),
    sort: Number(text(form, "sort")) || 200,
  });
  back(error ? (/duplicate key/.test(error.message) ? "There is already a category with that name." : "That couldn't be saved. Please try again.") : undefined, "category_added");
}

export async function saveCategory(key: string, form: FormData) {
  const db = await approver();
  const name = text(form, "name");
  if (!name) back("Please give the category a name.");
  const { error } = await db
    .from("risk_categories")
    .update({
      name,
      description: text(form, "description") || null,
      subcategories: lines(text(form, "subcategories")),
      sort: Number(text(form, "sort")) || 100,
      active: form.get("active") === "on",
      to_confirm: form.get("to_confirm") === "on",
    })
    .eq("key", key);
  back(error ? "That couldn't be saved. Please try again." : undefined, "category_saved");
}
