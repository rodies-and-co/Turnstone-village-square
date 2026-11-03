"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getFamilyContext } from "@/lib/family-context";
import { isDate } from "@/lib/governance";
import type { SavedCode } from "@/lib/messages";
import { askToRemove } from "@/lib/removal";
import { RESPONSES, ratingProblem, type Rating } from "@/lib/risk";

// The risk register. Managers and Administrators add and change; a rating
// counts once a Manager who didn't prepare it approves it; only a Manager
// changes what a risk is about or closes it; removing takes two people. The
// family database checks all of this too.

function go(path: string, error?: string, saved: SavedCode = "saved"): never {
  revalidatePath(path.split("?")[0].split("#")[0], "layout");
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

// Only pages inside this family may be returned to.
function safeBack(familyId: string, back: string) {
  return back.startsWith(`/families/${familyId}/`) && !back.includes("//") ? back : `/families/${familyId}/risks`;
}
const riskPage = (familyId: string, riskId: string) => `/families/${familyId}/risks/${riskId}`;

async function editor(familyId: string, to: string) {
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db || !ctx.canEdit) go(to, "Only a Manager or Administrator can change the risk register.");
  return ctx;
}
type Ctx = Awaited<ReturnType<typeof editor>>;

function friendly(message: string | undefined) {
  const m = message ?? "";
  if (/^Risks: /.test(m)) return m.replace(/^Risks: /, "");
  if (/row-level security/.test(m)) return "You don't have permission to change this.";
  if (/risk_reviews_one_draft/.test(m)) return "This risk already has a rating waiting for approval. Change that one, or approve it first.";
  if (/risk_reviews_check|residual/.test(m)) return "After controls the risk can't score higher than before them.";
  if (/risks_suggestion_key_key/.test(m)) return "This suggestion is already in the register.";
  if (/closed_reason|risks_check/.test(m)) return "Please give the date and the reason for closing it.";
  return m ? "That couldn't be saved. Please check the details and try again." : "Something went wrong.";
}

async function teamIds(ctx: Ctx) {
  const { data } = await ctx.supabase.rpc("family_team", { p_family: ctx.family.id });
  return new Set(((data ?? []) as { user_id: string }[]).map((t) => t.user_id));
}
async function categoryKeys(ctx: Ctx) {
  const { data } = await ctx.supabase.from("risk_categories").select("key, subcategories").eq("active", true);
  return new Map(((data ?? []) as { key: string; subcategories: string[] }[]).map((c) => [c.key, c.subcategories]));
}

// "Category" is one field: "governance" or "governance|Decision-making".
async function category(ctx: Ctx, form: FormData, current?: { category: string; subcategory: string | null }) {
  const [key, sub] = text(form, "category").split("|");
  // A risk keeps the category it was filed under, even after it is retired.
  if (current && key === current.category && (sub || null) === current.subcategory) return { category: key, subcategory: sub || null };
  const cats = await categoryKeys(ctx);
  if (!key || !cats.has(key)) return { error: "Please choose the category." };
  if (sub && !cats.get(key)!.includes(sub)) return { error: "Please choose the category again: that subcategory isn't listed." };
  return { category: key, subcategory: sub || null };
}

// "About" is one field too: "", "entity:<id>", "branch:<id>" or "person:<id>".
function about(form: FormData) {
  const [kind, id] = text(form, "about").split(":");
  const v = uuid(id ?? "");
  return {
    entity_id: kind === "entity" ? v : null,
    branch_id: kind === "branch" ? v : null,
    person_id: kind === "person" ? v : null,
  };
}

function rating(form: FormData): { rating?: Rating & { reviewed_on: string; controls: string | null; notes: string | null }; error?: string; none?: true } {
  const keys = ["inherent_likelihood", "inherent_impact", "residual_likelihood", "residual_impact"] as const;
  const values = keys.map((k) => text(form, k));
  if (values.every((v) => !v)) return { none: true };
  const [il, ii, rl, ri] = values.map(Number);
  const r = { inherent_likelihood: il, inherent_impact: ii, residual_likelihood: rl, residual_impact: ri };
  const problem = ratingProblem(r);
  if (problem) return { error: problem };
  const on = text(form, "reviewed_on");
  if (on && !isDate(on)) return { error: "Please enter the date of the rating as day, month and year." };
  return { rating: { ...r, reviewed_on: on || new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" }), controls: optional(form, "controls"), notes: optional(form, "notes") } };
}

type Current = { category: string; subcategory: string | null; owner_id: string | null };
async function details(ctx: Ctx, form: FormData, current?: Current) {
  const title = text(form, "title");
  if (!title) return { error: "Please give the risk a title." };
  const cat = await category(ctx, form, current);
  if ("error" in cat) return { error: cat.error };
  const response = text(form, "response") || "treat";
  if (!(response in RESPONSES)) return { error: "Please choose how the risk is handled." };
  const owner = uuid(text(form, "owner_id"));
  if (owner && owner !== current?.owner_id && !(await teamIds(ctx)).has(owner)) return { error: "A risk's owner must be a Manager or Administrator of this family." };
  const review = text(form, "next_review_on");
  if (review && !isDate(review)) return { error: "Please enter the next review date as day, month and year." };
  return { value: { title, description: optional(form, "description"), ...cat, response, owner_id: owner, next_review_on: review || null } };
}

export async function addRisk(familyId: string, back: string, form: FormData) {
  const to = safeBack(familyId, back);
  const ctx = await editor(familyId, to);
  const d = await details(ctx, form);
  if (d.error || !d.value) go(to, d.error);
  const r = rating(form);
  if (r.error) go(to, r.error);
  const key = text(form, "suggestion_key");
  const suggestion = /^[a-z-]{3,40}(:[0-9a-f-]{36})?$/.test(key) ? key : null;
  const { data, error } = await ctx.db!.rpc("add_risk", {
    p_risk: { ...d.value, ...about(form), suggestion_key: suggestion },
    p_rating: r.rating ?? null,
  });
  if (error || !data) go(to, friendly(error?.message));
  go(riskPage(familyId, data as string), undefined, r.rating ? "risk_added" : "risk_added_unrated");
}

export async function updateRisk(familyId: string, riskId: string, form: FormData) {
  const to = riskPage(familyId, riskId);
  const ctx = await editor(familyId, to);
  const { data: current } = await ctx.db!.from("risks").select("category, subcategory, owner_id").eq("id", riskId).maybeSingle();
  if (!current) go(to, "That risk can't be found.");
  const d = await details(ctx, form, current as Current);
  if (d.error || !d.value) go(to, d.error);
  // Only a Manager may change what a risk is about (who sees it); the form
  // only offers it to Managers, and the database checks it.
  const change = ctx.canManage && form.has("about") ? { ...d.value, ...about(form) } : d.value;
  const { error } = await ctx.db!.from("risks").update(change).eq("id", riskId);
  go(to, error ? friendly(error.message) : undefined, "risk_saved");
}

export async function addRating(familyId: string, riskId: string, form: FormData) {
  const to = riskPage(familyId, riskId);
  const ctx = await editor(familyId, to);
  const r = rating(form);
  if (r.error || r.none || !r.rating) go(to, r.error ?? "Please choose a likelihood and an impact, before and after controls.");
  const { error } = await ctx.db!.from("risk_reviews").insert({ risk_id: riskId, ...r.rating });
  go(to, error ? friendly(error.message) : undefined, "rating_added");
}

export async function updateRating(familyId: string, riskId: string, reviewId: string, form: FormData) {
  const to = riskPage(familyId, riskId);
  const ctx = await editor(familyId, to);
  const r = rating(form);
  if (r.error || r.none || !r.rating) go(to, r.error ?? "Please choose a likelihood and an impact, before and after controls.");
  const { error } = await ctx.db!.from("risk_reviews").update(r.rating).eq("id", reviewId).eq("risk_id", riskId).eq("status", "draft");
  go(to, error ? friendly(error.message) : undefined, "rating_saved");
}

export async function approveRating(familyId: string, riskId: string, reviewId: string) {
  const to = riskPage(familyId, riskId);
  const ctx = await editor(familyId, to);
  if (!ctx.canManage) go(to, "Only a Manager can approve a rating.");
  const { data, error } = await ctx.db!.from("risk_reviews").update({ status: "approved" }).eq("id", reviewId).eq("risk_id", riskId).eq("status", "draft").select("id");
  if (!error && !data?.length) go(to, "That rating has changed or was already approved. Please look again.");
  go(to, error ? friendly(error.message) : undefined, "rating_approved");
}

export async function closeRisk(familyId: string, riskId: string, form: FormData) {
  const to = riskPage(familyId, riskId);
  const ctx = await editor(familyId, to);
  if (!ctx.canManage) go(to, "Only a Manager can close a risk.");
  const on = text(form, "closed_on");
  const reason = text(form, "closed_reason");
  if (!isDate(on)) go(to, "Please enter the date as day, month and year.");
  if (!reason) go(to, "Please say why the risk is closed.");
  const { error } = await ctx.db!.from("risks").update({ status: "closed", closed_on: on, closed_reason: reason }).eq("id", riskId);
  go(to, error ? friendly(error.message) : undefined, "risk_closed");
}

export async function reopenRisk(familyId: string, riskId: string) {
  const to = riskPage(familyId, riskId);
  const ctx = await editor(familyId, to);
  if (!ctx.canManage) go(to, "Only a Manager can reopen a risk.");
  const { error } = await ctx.db!.from("risks").update({ status: "open" }).eq("id", riskId);
  go(to, error ? friendly(error.message) : undefined, "risk_reopened");
}

export async function removeRisk(familyId: string, riskId: string) {
  const ctx = await getFamilyContext(familyId);
  const error = await askToRemove(ctx, "risks", riskId);
  go(error ? riskPage(familyId, riskId) : `/families/${familyId}/risks`, error ?? undefined, "removal_requested");
}

export async function removeRating(familyId: string, riskId: string, reviewId: string) {
  const ctx = await getFamilyContext(familyId);
  const error = await askToRemove(ctx, "risk_reviews", reviewId, { risk_id: riskId });
  go(riskPage(familyId, riskId), error ?? undefined, "removal_requested");
}

export async function dismissSuggestion(familyId: string, key: string, form: FormData) {
  const to = `/families/${familyId}/risks?view=suggestions`;
  const ctx = await editor(familyId, to);
  const reason = text(form, "reason");
  if (!reason) go(to, "Please say why this doesn't need to go in the register.");
  if (!/^[a-z-]{3,40}(:[0-9a-f-]{36})?$/.test(key)) go(to, "That isn't possible.");
  const { data: existing } = await ctx.db!.from("risk_suggestion_answers").select("id").eq("suggestion_key", key).maybeSingle();
  const { error } = existing
    ? await ctx.db!.from("risk_suggestion_answers").update({ dismissed: true, reason }).eq("id", existing.id)
    : await ctx.db!.from("risk_suggestion_answers").insert({ suggestion_key: key, reason });
  go(to, error ? friendly(error.message) : undefined, "suggestion_dismissed");
}

export async function askAgain(familyId: string, answerId: string) {
  const to = `/families/${familyId}/risks?view=suggestions`;
  const ctx = await editor(familyId, to);
  if (!ctx.canManage) go(to, "Only a Manager can ask a dismissed suggestion again.");
  const { error } = await ctx.db!.from("risk_suggestion_answers").update({ dismissed: false, reason: null }).eq("id", answerId);
  go(to, error ? friendly(error.message) : undefined, "suggestion_reopened");
}
