"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { branchNameFor } from "@/lib/branches";
import { getFamilyContext } from "@/lib/family-context";
import type { SavedCode } from "@/lib/messages";
import { askToRemove } from "@/lib/removal";
import { friendlyError } from "@/lib/people";

// Every answer on the Branches page is a Manager's. The family database
// checks this too; these checks only give a clear message earlier.

function back(
  familyId: string,
  error?: string,
  saved: SavedCode = "saved",
): never {
  revalidatePath(`/families/${familyId}`, "layout");
  const params = new URLSearchParams(error ? { error } : { saved });
  redirect(`/families/${familyId}/branches?${params.toString()}`);
}

async function managerDb(familyId: string) {
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db || !ctx.canManage)
    back(
      familyId,
      "Only a Manager can answer branch questions or change branches.",
    );
  return ctx.db;
}

function text(form: FormData, name: string) {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

// ---------------------------------------------------------------------------
// Wealth creators

export async function addWealthCreator(familyId: string, form: FormData) {
  const db = await managerDb(familyId);
  const personId = text(form, "person_id");
  if (!personId) back(familyId, "Please choose a person.");
  const { error } = await db
    .from("wealth_creators")
    .insert({ person_id: personId });
  back(
    familyId,
    error ? friendlyError(error.message) : undefined,
    "wealth_creator_added",
  );
}

export async function removeWealthCreator(familyId: string, personId: string) {
  await managerDb(familyId);
  const error = await askToRemove(
    await getFamilyContext(familyId),
    "wealth_creators",
    personId,
  );
  back(familyId, error ?? undefined, "removal_requested");
}

// ---------------------------------------------------------------------------
// "Does this child of a wealth creator start a branch?"

export async function startBranch(familyId: string, personId: string) {
  const db = await managerDb(familyId);
  const { data: person } = await db
    .from("people")
    .select("id, known_as, full_names, surname, branch_id")
    .eq("id", personId)
    .maybeSingle();
  if (!person) back(familyId, "That person couldn't be found.");
  const name = branchNameFor(person);
  // The branch and its head (moved out of any other branch, which the
  // question on the page says) are saved together, or not at all.
  const { error } = await db.rpc("start_branch", {
    p_person: personId,
    p_name: name,
  });
  if (error) {
    back(
      familyId,
      /duplicate key/.test(error.message)
        ? `There is already a branch called “${name}”.`
        : `The branch wasn't created: ${friendlyError(error.message)}`,
    );
  }
  back(familyId, undefined, "branch_created");
}

export async function declineBranch(familyId: string, personId: string) {
  const db = await managerDb(familyId);
  const { error } = await db
    .from("branch_answers")
    .insert({ person_id: personId, question: "starts_branch" });
  // Already answered (e.g. a double click): that's fine.
  back(
    familyId,
    error && !/duplicate key/.test(error.message)
      ? friendlyError(error.message)
      : undefined,
    "answer_saved",
  );
}

// ---------------------------------------------------------------------------
// "Should this person join this branch?"

export async function joinBranch(
  familyId: string,
  personId: string,
  branchId: string,
) {
  const db = await managerDb(familyId);
  // One branch per person: only someone not yet in a branch is placed.
  const { data, error } = await db
    .from("people")
    .update({ branch_id: branchId })
    .eq("id", personId)
    .is("branch_id", null)
    .select("id");
  if (error) back(familyId, friendlyError(error.message));
  if (!data?.length) back(familyId, "That person is already in a branch.");
  back(familyId, undefined, "member_added");
}

// "No" to one branch, or "Neither" to all the branches offered.
export async function declineJoin(
  familyId: string,
  personId: string,
  branchIds: string[],
) {
  const db = await managerDb(familyId);
  const { error } = await db
    .from("branch_answers")
    .insert(
      branchIds.map((branch_id) => ({
        person_id: personId,
        question: "joins_branch",
        branch_id,
      })),
    );
  // Already answered (e.g. a double click): that's fine.
  back(
    familyId,
    error && !/duplicate key/.test(error.message)
      ? friendlyError(error.message)
      : undefined,
    "answer_saved",
  );
}

// Withdraw a "No", so the question is asked again.
export async function askAgain(familyId: string, answerId: string) {
  await managerDb(familyId);
  const error = await askToRemove(
    await getFamilyContext(familyId),
    "branch_answers",
    answerId,
  );
  back(familyId, error ?? undefined, "removal_requested");
}

// ---------------------------------------------------------------------------
// Looking after a branch

export async function renameBranch(
  familyId: string,
  branchId: string,
  form: FormData,
) {
  const db = await managerDb(familyId);
  const name = text(form, "name");
  if (!name) back(familyId, "Please give the branch a name.");
  const { error } = await db
    .from("branches")
    .update({ name })
    .eq("id", branchId);
  back(
    familyId,
    error
      ? /duplicate key/.test(error.message)
        ? `There is already a branch called “${name}”.`
        : friendlyError(error.message)
      : undefined,
    "branch_renamed",
  );
}

// Take a person out of a branch. The branch won't suggest them again.
export async function removeFromBranch(
  familyId: string,
  personId: string,
  branchId: string,
) {
  const db = await managerDb(familyId);
  // Only if they are still in this branch (someone may have moved them since).
  const { data, error } = await db
    .from("people")
    .update({ branch_id: null })
    .eq("id", personId)
    .eq("branch_id", branchId)
    .select("id");
  if (error) back(familyId, friendlyError(error.message));
  if (!data?.length) back(familyId, "That person is no longer in this branch.");
  const { error: e2 } = await db
    .from("branch_answers")
    .insert({
      person_id: personId,
      question: "joins_branch",
      branch_id: branchId,
    });
  if (e2 && !/duplicate key/.test(e2.message))
    back(
      familyId,
      `Taken out of the branch, but it may be suggested again: ${friendlyError(e2.message)}`,
    );
  back(familyId, undefined, "member_removed");
}

// Remove a branch. Its members stay in the Tree without a branch, and access
// given to Viewers for this branch ends.
export async function removeBranch(familyId: string, branchId: string) {
  await managerDb(familyId);
  const error = await askToRemove(
    await getFamilyContext(familyId),
    "branches",
    branchId,
  );
  back(familyId, error ?? undefined, "removal_requested");
}
