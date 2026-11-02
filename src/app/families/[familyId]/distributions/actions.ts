"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getFamilyContext } from "@/lib/family-context";
import { isDate, oneOf } from "@/lib/governance";
import {
  DISTRIBUTION_FORMS,
  DIVIDEND_FORMS,
  DIVIDEND_KINDS,
  POOLS,
  distributionWording,
  dividendWording,
  meetingsError,
  parseTarget,
} from "@/lib/meetings";
import type { SavedCode } from "@/lib/messages";
import { askToRemove } from "@/lib/removal";
import { draftDecision } from "../meetings/draft";

// Distributions (trusts and foundations) and dividends (companies). Each is
// drafted into a meeting or written resolution and declared when that
// decision passes (see the family database); its payment is then recorded.

function go(path: string, error?: string, saved: SavedCode = "saved"): never {
  revalidatePath(path.split("?")[0], "layout");
  const params = new URLSearchParams(error ? { error } : { saved });
  redirect(`${path}${path.includes("?") ? "&" : "?"}${params.toString()}`);
}
const page = (f: string, entity?: string) =>
  `/families/${f}/distributions${entity ? `?entity=${entity}` : ""}`;
function text(form: FormData, name: string) {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}
const optional = (form: FormData, name: string) => text(form, name) || null;
const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
const isAmount = (s: string, places: number) =>
  new RegExp(`^\\d{1,14}(\\.\\d{1,${places}})?$`).test(s.replace(/[ ,]/g, ""));
const num = (s: string) => Number(s.replace(/[ ,]/g, ""));

function payoutError(message: string | undefined) {
  const m = message ?? "";
  if (/^(Distributions|Dividends): /.test(m))
    return m.replace(/^(Distributions|Dividends): /, "");
  return meetingsError(m);
}

async function editor(familyId: string, to: string) {
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db || !ctx.canEdit)
    go(
      to,
      "Only a Manager or Administrator can record distributions and dividends.",
    );
  return ctx;
}

// If the record can't be saved after its decision was drafted, the item is
// withdrawn so nothing is left pretending to decide it.
async function withdraw(
  ctx: Awaited<ReturnType<typeof getFamilyContext>>,
  decisionId: string,
) {
  await ctx
    .db!.from("decisions")
    .update({ outcome: "withdrawn" })
    .eq("id", decisionId);
}

export async function recordDistribution(
  familyId: string,
  entityId: string,
  form: FormData,
) {
  const to = page(familyId, entityId);
  const ctx = await editor(familyId, to);
  const db = ctx.db!;
  const recipient = text(form, "recipient");
  const pool = text(form, "pool");
  const formOf = text(form, "form") || "cash";
  const currency = text(form, "currency").toUpperCase();
  const amount = text(form, "amount");
  const target = parseTarget(text(form, "decide_in"));
  const [kind, id] = recipient.split(":");
  if (!id || !["beneficiary", "member"].includes(kind))
    go(to, "Please choose who receives the distribution.");
  if (!oneOf(pool, POOLS))
    go(
      to,
      "Please say whether it is paid from the income pool or the capital pool.",
    );
  if (!oneOf(formOf, DISTRIBUTION_FORMS))
    go(to, "Please choose how it is paid.");
  if (!/^[A-Z]{3}$/.test(currency))
    go(to, "The currency should be three letters, e.g. GBP.");
  if (!isAmount(amount, 2) || num(amount) <= 0)
    go(to, "The amount should be a number, e.g. 25000 or 25,000.00.");
  if (!target)
    go(to, "Please choose the meeting or written resolution that decides it.");

  const { data: ent } = await db
    .from("entities")
    .select("id, entity_type")
    .eq("id", entityId)
    .maybeSingle();
  if (!ent || !["trust", "foundation"].includes(ent.entity_type))
    go(to, "Only a trust or foundation makes distributions.");
  // The recipient's name, for the wording.
  let name = "the beneficiary";
  if (kind === "beneficiary") {
    const { data: b } = await db
      .from("beneficiaries")
      .select(
        "id, cause, person_id, organisation_id, holder_entity_id, people(full_names, surname), outside_organisations(name)",
      )
      .eq("id", id)
      .eq("entity_id", entityId)
      .maybeSingle();
    if (!b) go(to, "That beneficiary couldn't be found.");
    const p = (Array.isArray(b.people) ? b.people[0] : b.people) as {
      full_names: string;
      surname: string;
    } | null;
    const o = (
      Array.isArray(b.outside_organisations)
        ? b.outside_organisations[0]
        : b.outside_organisations
    ) as { name: string } | null;
    if (b.holder_entity_id) {
      const { data: e } = await db
        .from("entities")
        .select("name")
        .eq("id", b.holder_entity_id)
        .maybeSingle();
      name = e?.name ?? name;
    } else
      name =
        b.cause ?? (p ? `${p.full_names} ${p.surname}` : (o?.name ?? name));
  } else {
    const { data: m } = await db
      .from("beneficiary_class_members")
      .select("id, people(full_names, surname)")
      .eq("id", id)
      .eq("entity_id", entityId)
      .maybeSingle();
    if (!m) go(to, "That member of the class couldn't be found.");
    const p = (Array.isArray(m.people) ? m.people[0] : m.people) as {
      full_names: string;
      surname: string;
    } | null;
    name = p ? `${p.full_names} ${p.surname}` : name;
  }

  const words = distributionWording({
    name,
    currency,
    amount: num(amount),
    pool,
    form: formOf,
    entityType: ent.entity_type,
    clause: optional(form, "deed_clause"),
    purpose: optional(form, "purpose"),
    letterOfWishes: form.get("letter_of_wishes") === "on",
  });
  const made = await draftDecision(ctx, entityId, target, {
    ...words,
    action: "distribution",
  });
  if ("error" in made) go(to, made.error);
  const { error } = await db.from("distributions").insert({
    entity_id: entityId,
    beneficiary_id: kind === "beneficiary" ? id : null,
    class_member_id: kind === "member" ? id : null,
    pool,
    currency,
    amount: num(amount),
    form: formOf,
    purpose: optional(form, "purpose"),
    deed_clause: optional(form, "deed_clause"),
    letter_of_wishes: form.get("letter_of_wishes") === "on",
    decision_id: made.decisionId,
  });
  if (error) {
    await withdraw(ctx, made.decisionId);
    go(to, `${payoutError(error.message)} (The drafted item was withdrawn.)`);
  }
  go(made.href, undefined, "payout_drafted");
}

export async function recordDividend(
  familyId: string,
  entityId: string,
  form: FormData,
) {
  const to = page(familyId, entityId);
  const ctx = await editor(familyId, to);
  const db = ctx.db!;
  const classId = text(form, "class_id");
  const kind = text(form, "kind") || "final";
  const formOf = text(form, "form") || "cash";
  const enterAs = text(form, "enter_as") === "total" ? "total" : "per_share";
  const amount = text(form, "amount");
  const recordDate = text(form, "record_date");
  const paymentDate = text(form, "payment_date");
  const target = parseTarget(text(form, "decide_in"));
  if (!oneOf(kind, DIVIDEND_KINDS))
    go(to, "Please choose the kind of dividend.");
  if (!oneOf(formOf, DIVIDEND_FORMS)) go(to, "Please choose how it is paid.");
  if (!isAmount(amount, enterAs === "total" ? 2 : 6) || num(amount) <= 0)
    go(
      to,
      "The amount should be a number, e.g. 0.25 per share, or 25,000 in total.",
    );
  if (recordDate && !isDate(recordDate))
    go(to, "Please enter the record date as day, month and year.");
  if (paymentDate && !isDate(paymentDate))
    go(to, "Please enter the payment date as day, month and year.");
  if (!target)
    go(to, "Please choose the meeting or written resolution that decides it.");
  const { data: cls } = await db
    .from("share_classes")
    .select("id, name, currency")
    .eq("id", classId)
    .eq("entity_id", entityId)
    .maybeSingle();
  if (!cls) go(to, "Please choose the class of shares.");

  let perShare = num(amount);
  if (enterAs === "total") {
    // Per share from the shares in issue today (the register on the record
    // date decides who is paid).
    const { data: txs } = await db
      .from("share_transactions")
      .select("kind, shares")
      .eq("class_id", classId)
      .eq("status", "approved")
      .eq("kind", "issue");
    const issued = ((txs ?? []) as { shares: number | string }[]).reduce(
      (n, t) => n + Number(t.shares),
      0,
    );
    if (issued <= 0) go(to, "There are no shares of that class in issue yet.");
    perShare = Math.floor((num(amount) / issued) * 1_000_000) / 1_000_000;
    if (perShare <= 0) go(to, "That total is too small to pay per share.");
  }
  const words = dividendWording({
    kind,
    currency: cls.currency,
    perShare,
    className: cls.name,
    recordDate: recordDate || null,
    paymentDate: paymentDate || null,
    form: formOf,
  });
  const made = await draftDecision(ctx, entityId, target, {
    ...words,
    action: "dividend",
  });
  if ("error" in made) go(to, made.error);
  const { error } = await db.from("dividends").insert({
    entity_id: entityId,
    class_id: classId,
    kind,
    per_share: perShare,
    currency: cls.currency,
    record_date: recordDate || null,
    payment_date: paymentDate || null,
    form: formOf,
    notes: optional(form, "notes"),
    decision_id: made.decisionId,
  });
  if (error) {
    await withdraw(ctx, made.decisionId);
    go(to, `${payoutError(error.message)} (The drafted item was withdrawn.)`);
  }
  go(made.href, undefined, "payout_drafted");
}

export async function payDistribution(
  familyId: string,
  back: string,
  distributionId: string,
  form: FormData,
) {
  const to = back.startsWith(`/families/${familyId}/`) ? back : page(familyId);
  const ctx = await editor(familyId, to);
  const paidOn = text(form, "paid_on");
  if (!isDate(paidOn)) go(to, "Please give the date it was paid.");
  if (paidOn > today()) go(to, "The date paid can't be in the future.");
  const { data, error } = await ctx
    .db!.from("distributions")
    .update({
      status: "paid",
      paid_on: paidOn,
      receipt_reference: optional(form, "receipt_reference"),
    })
    .eq("id", distributionId)
    .eq("status", "declared")
    .select("id");
  if (error) go(to, payoutError(error.message));
  if (!data?.length)
    go(to, "Only a declared distribution can be recorded as paid.");
  go(to, undefined, "payout_paid");
}

export async function payDividendLine(
  familyId: string,
  back: string,
  dividendId: string,
  paymentId: string,
  form: FormData,
) {
  const to = back.startsWith(`/families/${familyId}/`) ? back : page(familyId);
  const ctx = await editor(familyId, to);
  const paidOn = text(form, "paid_on");
  if (paidOn && !isDate(paidOn)) go(to, "Please give the date it was paid.");
  const { error } = await ctx
    .db!.from("dividend_payments")
    .update({ paid_on: paidOn || null, voucher: optional(form, "voucher") })
    .eq("id", paymentId)
    .eq("dividend_id", dividendId);
  go(to, error ? payoutError(error.message) : undefined, "payout_paid");
}

// Every unpaid line paid on one date (e.g. one bank run).
export async function payDividendAll(
  familyId: string,
  back: string,
  dividendId: string,
  form: FormData,
) {
  const to = back.startsWith(`/families/${familyId}/`) ? back : page(familyId);
  const ctx = await editor(familyId, to);
  const paidOn = text(form, "paid_on");
  if (!isDate(paidOn)) go(to, "Please give the date they were paid.");
  const { error } = await ctx
    .db!.from("dividend_payments")
    .update({ paid_on: paidOn })
    .eq("dividend_id", dividendId)
    .is("paid_on", null);
  go(to, error ? payoutError(error.message) : undefined, "payout_paid");
}

export async function cancelPayout(
  familyId: string,
  back: string,
  table: "distributions" | "dividends",
  id: string,
) {
  const to = back.startsWith(`/families/${familyId}/`) ? back : page(familyId);
  const ctx = await editor(familyId, to);
  const { data, error } = await ctx
    .db!.from(table)
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("status", "proposed")
    .select("id");
  if (error) go(to, payoutError(error.message));
  if (!data?.length) go(to, "Only a proposal can be cancelled.");
  go(to, undefined, "payout_cancelled");
}

export async function removePayout(
  familyId: string,
  back: string,
  table: "distributions" | "dividends",
  id: string,
) {
  const to = back.startsWith(`/families/${familyId}/`) ? back : page(familyId);
  const ctx = await getFamilyContext(familyId);
  const error = await askToRemove(ctx, table, id);
  go(to, error ?? undefined, "removal_requested");
}
