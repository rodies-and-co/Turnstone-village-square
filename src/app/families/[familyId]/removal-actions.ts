"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getFamilyContext } from "@/lib/family-context";
import type { SavedCode } from "@/lib/messages";
import { removalError } from "@/lib/removal";

// Approving, turning down or withdrawing a removal request. The family
// database checks who may do each (decide_removal / withdraw_removal).

function go(
  familyId: string,
  error?: string,
  saved: SavedCode = "saved",
): never {
  revalidatePath(`/families/${familyId}`, "layout");
  const params = new URLSearchParams(error ? { error } : { saved });
  redirect(`/families/${familyId}?${params.toString()}#removals`);
}

export async function approveRemoval(familyId: string, requestId: string) {
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db || !ctx.canManage)
    go(familyId, "Only a Manager can approve a removal.");
  const { error } = await ctx.db.rpc("decide_removal", {
    p_request: requestId,
    p_approve: true,
  });
  go(
    familyId,
    error ? removalError(error.message) : undefined,
    "removal_approved",
  );
}

export async function rejectRemoval(
  familyId: string,
  requestId: string,
  form: FormData,
) {
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db || !ctx.canManage)
    go(familyId, "Only a Manager can turn down a removal.");
  const note = form.get("note");
  const { error } = await ctx.db.rpc("decide_removal", {
    p_request: requestId,
    p_approve: false,
    p_note: typeof note === "string" ? note : null,
  });
  go(
    familyId,
    error ? removalError(error.message) : undefined,
    "removal_rejected",
  );
}

export async function withdrawRemoval(familyId: string, requestId: string) {
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db || !ctx.canEdit)
    go(familyId, "You don't have permission to do that.");
  const { error } = await ctx.db.rpc("withdraw_removal", {
    p_request: requestId,
  });
  go(
    familyId,
    error ? removalError(error.message) : undefined,
    "removal_withdrawn",
  );
}
