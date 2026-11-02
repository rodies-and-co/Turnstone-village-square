"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getFamilyContext } from "@/lib/family-context";
import { isDate, oneOf } from "@/lib/governance";
import { NOTE_KINDS, OUTCOMES, REQUIRED, meetingsError } from "@/lib/meetings";
import type { SavedCode } from "@/lib/messages";
import { askToRemove } from "@/lib/removal";

// Meetings, written resolutions and file notes. Managers and Administrators
// record; a Manager who didn't record a meeting confirms it, and one who
// didn't prepare a resolution (or record its signatures) confirms it passed.
// Removing takes two people. The family database checks all of this too.

function go(path: string, error?: string, saved: SavedCode = "saved"): never {
  revalidatePath(path.split("?")[0], "layout");
  const params = new URLSearchParams(error ? { error } : { saved });
  redirect(`${path}${path.includes("?") ? "&" : "?"}${params.toString()}`);
}
const meetingPath = (f: string, id: string) => `/families/${f}/meetings/${id}`;
const resolutionPath = (f: string, id: string) =>
  `/families/${f}/meetings/resolutions/${id}`;

function text(form: FormData, name: string) {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}
const optional = (form: FormData, name: string) => text(form, name) || null;
const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
const wholeOrNull = (s: string) =>
  s === "" ? null : /^\d{1,6}$/.test(s) ? Number(s) : NaN;

// Only pages inside this family may be returned to.
function safeBack(familyId: string, back: string) {
  return back.startsWith(`/families/${familyId}/`) && !back.includes("//")
    ? back
    : `/families/${familyId}/meetings`;
}

async function editor(familyId: string, to: string) {
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db || !ctx.canEdit)
    go(
      to,
      "Only a Manager or Administrator can change meetings and resolutions.",
    );
  return ctx;
}

// "board:<entity>", "members:<entity>" or "governance:<body>".
function parseBody(choice: string) {
  const [body, id] = choice.split(":");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  if (body === "board" || body === "members")
    return { body, entity_id: id, governance_body_id: null };
  if (body === "governance")
    return { body, entity_id: null, governance_body_id: id };
  return null;
}
// "person:<id>", "organisation:<id>" or "entity:<id>".
function parseHolder(choice: string) {
  const [kind, id] = choice.split(":");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  if (kind === "person")
    return { person_id: id, organisation_id: null, holder_entity_id: null };
  if (kind === "organisation")
    return { person_id: null, organisation_id: id, holder_entity_id: null };
  if (kind === "entity")
    return { person_id: null, organisation_id: null, holder_entity_id: id };
  return null;
}

// --- Meetings ---------------------------------------------------------------

function meetingFields(form: FormData) {
  const date = text(form, "meeting_on");
  const time = text(form, "starts_at");
  const link = text(form, "video_link");
  if (!text(form, "title"))
    return { error: "Please give the meeting a name, e.g. Board meeting." };
  if (!isDate(date))
    return { error: "Please enter the date as day, month and year." };
  if (time && !/^\d{2}:\d{2}$/.test(time))
    return { error: "Please enter the time as hours and minutes, e.g. 14:30." };
  if (link && !/^https:\/\//.test(link))
    return { error: "The video link should start with https://." };
  return {
    value: {
      title: text(form, "title"),
      meeting_on: date,
      starts_at: time || null,
      location: optional(form, "location"),
      video_link: link || null,
      agenda: optional(form, "agenda"),
    },
  };
}

export async function createMeeting(
  familyId: string,
  back: string,
  form: FormData,
) {
  const to = safeBack(familyId, back);
  const ctx = await editor(familyId, to);
  const body = parseBody(text(form, "body"));
  if (!body) go(to, "Please choose who is meeting.");
  const fields = meetingFields(form);
  if ("error" in fields) go(to, fields.error);
  const held = form.get("already_held") === "on";
  if (held && fields.value.meeting_on > today())
    go(
      to,
      'A meeting in the future can\'t have been held yet. Untick "Already held".',
    );
  const { data, error } = await ctx
    .db!.from("meetings")
    .insert({ ...body, ...fields.value, status: held ? "held" : "planned" })
    .select("id")
    .single();
  if (error || !data) go(to, meetingsError(error?.message));
  go(meetingPath(familyId, data.id), undefined, "meeting_added");
}

export async function updateMeeting(
  familyId: string,
  meetingId: string,
  form: FormData,
) {
  const to = meetingPath(familyId, meetingId);
  const ctx = await editor(familyId, to);
  const fields = meetingFields(form);
  if ("error" in fields) go(to, fields.error);
  const { error } = await ctx
    .db!.from("meetings")
    .update(fields.value)
    .eq("id", meetingId);
  go(to, error ? meetingsError(error.message) : undefined, "meeting_saved");
}

const STATUS_SAVED: Record<string, SavedCode> = {
  planned: "meeting_reopened",
  held: "meeting_held",
  cancelled: "meeting_cancelled",
  confirmed: "meeting_confirmed",
};

// Confirming checks the record wasn't changed since the Manager looked at it.
export async function setMeetingStatus(
  familyId: string,
  meetingId: string,
  status: string,
  seenVersion: string,
) {
  const to = meetingPath(familyId, meetingId);
  const ctx = await editor(familyId, to);
  if (!(status in STATUS_SAVED)) go(to, "That isn't possible.");
  if (status === "confirmed" && !ctx.canManage)
    go(to, "Only a Manager can confirm a meeting's record.");
  const { data, error } = await ctx
    .db!.from("meetings")
    .update({ status })
    .eq("id", meetingId)
    .eq("updated_at", seenVersion)
    .select("id");
  if (error) go(to, meetingsError(error.message));
  if (!data?.length)
    go(
      to,
      "The meeting was changed while you were looking at it. Please check it again.",
    );
  go(to, undefined, STATUS_SAVED[status]);
}

export async function addAttendee(
  familyId: string,
  meetingId: string,
  form: FormData,
) {
  const to = meetingPath(familyId, meetingId);
  const ctx = await editor(familyId, to);
  const holder = parseHolder(text(form, "who"));
  if (!holder) go(to, "Please choose who attended.");
  const capacity =
    text(form, "capacity") === "in_attendance" ? "in_attendance" : "voting";
  const attendance =
    capacity === "voting" &&
    ["apologies", "absent"].includes(text(form, "attendance"))
      ? text(form, "attendance")
      : "present";
  const { error } = await ctx
    .db!.from("meeting_attendees")
    .insert({
      meeting_id: meetingId,
      ...holder,
      capacity,
      attendance,
      represented_by: optional(form, "represented_by"),
    });
  go(to, error ? meetingsError(error.message) : undefined, "attendee_added");
}

// Adds everyone entitled to vote on the day who isn't listed yet, as present.
export async function addAllVoters(familyId: string, meetingId: string) {
  const to = meetingPath(familyId, meetingId);
  const ctx = await editor(familyId, to);
  const { data: m } = await ctx
    .db!.from("meetings")
    .select("body, entity_id, governance_body_id, meeting_on")
    .eq("id", meetingId)
    .maybeSingle();
  if (!m) go(to, "That meeting couldn't be found.");
  const [{ data: voters, error: e1 }, { data: listed }] = await Promise.all([
    ctx.db!.rpc("body_voters", {
      p_body: m.body,
      p_entity: m.entity_id,
      p_gov: m.governance_body_id,
      p_on: m.meeting_on,
    }),
    ctx
      .db!.from("meeting_attendees")
      .select("person_id, organisation_id, holder_entity_id")
      .eq("meeting_id", meetingId),
  ]);
  if (e1) go(to, meetingsError(e1.message));
  type H = {
    person_id: string | null;
    organisation_id: string | null;
    holder_entity_id: string | null;
  };
  const key = (h: H) =>
    `${h.person_id}|${h.organisation_id}|${h.holder_entity_id}`;
  const have = new Set(((listed ?? []) as H[]).map(key));
  const add = ((voters ?? []) as H[]).filter((v) => !have.has(key(v)));
  if (add.length === 0) go(to, "Everyone entitled to vote is already listed.");
  const { error } = await ctx
    .db!.from("meeting_attendees")
    .insert(
      add.map((v) => ({
        meeting_id: meetingId,
        person_id: v.person_id,
        organisation_id: v.organisation_id,
        holder_entity_id: v.holder_entity_id,
      })),
    );
  go(to, error ? meetingsError(error.message) : undefined, "attendees_added");
}

export async function updateAttendee(
  familyId: string,
  meetingId: string,
  attendeeId: string,
  form: FormData,
) {
  const to = meetingPath(familyId, meetingId);
  const ctx = await editor(familyId, to);
  const attendance = text(form, "attendance");
  if (!["present", "apologies", "absent"].includes(attendance))
    go(to, "Please choose whether they were present.");
  const chair = form.get("is_chair") === "on" && attendance === "present";
  if (chair) {
    const { error } = await ctx
      .db!.from("meeting_attendees")
      .update({ is_chair: false })
      .eq("meeting_id", meetingId)
      .neq("id", attendeeId)
      .eq("is_chair", true);
    if (error) go(to, meetingsError(error.message));
  }
  const { error } = await ctx
    .db!.from("meeting_attendees")
    .update({
      attendance,
      is_chair: chair,
      represented_by: optional(form, "represented_by"),
    })
    .eq("id", attendeeId)
    .eq("meeting_id", meetingId);
  go(to, error ? meetingsError(error.message) : undefined, "attendee_saved");
}

export async function removeAttendee(
  familyId: string,
  meetingId: string,
  attendeeId: string,
) {
  const ctx = await getFamilyContext(familyId);
  const error = await askToRemove(ctx, "meeting_attendees", attendeeId, {
    meeting_id: meetingId,
  });
  go(meetingPath(familyId, meetingId), error ?? undefined, "removal_requested");
}

// --- Decisions (items of a meeting or a resolution) ---------------------------

export async function addDecision(
  familyId: string,
  parent: "meeting" | "resolution",
  parentId: string,
  form: FormData,
) {
  const to =
    parent === "meeting"
      ? meetingPath(familyId, parentId)
      : resolutionPath(familyId, parentId);
  const ctx = await editor(familyId, to);
  const title = text(form, "title");
  const wording = text(form, "wording");
  if (!title)
    go(to, "Please give the decision a short title, e.g. Allotment of shares.");
  if (!wording) go(to, "Please give the wording of the decision.");
  const column = parent === "meeting" ? "meeting_id" : "resolution_id";
  const { data: items } = await ctx
    .db!.from("decisions")
    .select("item")
    .eq(column, parentId)
    .order("item", { ascending: false })
    .limit(1);
  const item = ((items?.[0]?.item as number | undefined) ?? 0) + 1;
  const { error } = await ctx
    .db!.from("decisions")
    .insert({
      [column]: parentId,
      item,
      title,
      wording,
      background: optional(form, "background"),
    });
  go(to, error ? meetingsError(error.message) : undefined, "decision_added");
}

export async function updateDecision(
  familyId: string,
  parent: "meeting" | "resolution",
  parentId: string,
  decisionId: string,
  form: FormData,
) {
  const to =
    parent === "meeting"
      ? meetingPath(familyId, parentId)
      : resolutionPath(familyId, parentId);
  const ctx = await editor(familyId, to);
  const title = text(form, "title");
  const wording = text(form, "wording");
  if (!title || !wording)
    go(to, "Please give the decision a title and its wording.");
  const { error } = await ctx
    .db!.from("decisions")
    .update({ title, wording, background: optional(form, "background") })
    .eq("id", decisionId)
    .eq(parent === "meeting" ? "meeting_id" : "resolution_id", parentId);
  go(to, error ? meetingsError(error.message) : undefined, "decision_saved");
}

export async function setOutcome(
  familyId: string,
  parent: "meeting" | "resolution",
  parentId: string,
  decisionId: string,
  form: FormData,
) {
  const to =
    parent === "meeting"
      ? meetingPath(familyId, parentId)
      : resolutionPath(familyId, parentId);
  const ctx = await editor(familyId, to);
  const outcome = text(form, "outcome");
  if (!oneOf(outcome, OUTCOMES)) go(to, "Please choose how the decision went.");
  const votes = ["votes_for", "votes_against", "abstentions"].map((k) =>
    wholeOrNull(text(form, k)),
  );
  if (votes.some((v) => Number.isNaN(v)))
    go(to, "Votes should be whole numbers.");
  const { error } = await ctx
    .db!.from("decisions")
    .update({
      outcome,
      votes_for: votes[0],
      votes_against: votes[1],
      abstentions: votes[2],
    })
    .eq("id", decisionId)
    .eq(parent === "meeting" ? "meeting_id" : "resolution_id", parentId);
  go(to, error ? meetingsError(error.message) : undefined, "outcome_saved");
}

export async function removeDecision(
  familyId: string,
  parent: "meeting" | "resolution",
  parentId: string,
  decisionId: string,
) {
  const ctx = await getFamilyContext(familyId);
  const error = await askToRemove(ctx, "decisions", decisionId, {
    [parent === "meeting" ? "meeting_id" : "resolution_id"]: parentId,
  });
  go(
    parent === "meeting"
      ? meetingPath(familyId, parentId)
      : resolutionPath(familyId, parentId),
    error ?? undefined,
    "removal_requested",
  );
}

// --- Minutes ------------------------------------------------------------------

export async function saveMinutes(
  familyId: string,
  meetingId: string,
  form: FormData,
) {
  const to = meetingPath(familyId, meetingId);
  const ctx = await editor(familyId, to);
  const status =
    text(form, "minutes_status") === "circulated" ? "circulated" : "draft";
  const { error } = await ctx
    .db!.from("meetings")
    .update({ minutes: optional(form, "minutes"), minutes_status: status })
    .eq("id", meetingId);
  go(to, error ? meetingsError(error.message) : undefined, "minutes_saved");
}

export async function approveMinutes(
  familyId: string,
  meetingId: string,
  form: FormData,
) {
  const to = meetingPath(familyId, meetingId);
  const ctx = await editor(familyId, to);
  const date = text(form, "minutes_approved_on");
  const signer = text(form, "minutes_signed_by");
  if (!isDate(date))
    go(
      to,
      "Please enter the date the minutes were approved, as day, month and year.",
    );
  if (date > today())
    go(to, "The minutes can't be approved on a date in the future.");
  const { error } = await ctx
    .db!.from("meetings")
    .update({
      minutes_status: "approved",
      minutes_approved_on: date,
      minutes_signed_by: signer || null,
    })
    .eq("id", meetingId);
  go(
    to,
    error
      ? meetingsError(
          /minutes_approved_on/.test(error.message)
            ? "The minutes can't be approved before the meeting."
            : error.message,
        )
      : undefined,
    "minutes_approved",
  );
}

export async function removeMeeting(familyId: string, meetingId: string) {
  const ctx = await getFamilyContext(familyId);
  const error = await askToRemove(ctx, "meetings", meetingId);
  go(meetingPath(familyId, meetingId), error ?? undefined, "removal_requested");
}

// --- Written resolutions ----------------------------------------------------------

export async function createResolution(
  familyId: string,
  back: string,
  form: FormData,
) {
  const to = safeBack(familyId, back);
  const ctx = await editor(familyId, to);
  const body = parseBody(text(form, "body"));
  if (!body) go(to, "Please choose who the resolution is for.");
  const title = text(form, "title");
  if (!title) go(to, "Please give the resolution a short title.");
  const required =
    body.body === "board" ? "all" : text(form, "required") || "all";
  if (!oneOf(required, REQUIRED)) go(to, "Please choose how many must sign.");
  const { data, error } = await ctx
    .db!.from("written_resolutions")
    .insert({
      ...body,
      title,
      background: optional(form, "background"),
      required,
    })
    .select("id")
    .single();
  if (error || !data) go(to, meetingsError(error?.message));
  go(resolutionPath(familyId, data.id), undefined, "resolution_added");
}

export async function updateResolution(
  familyId: string,
  resolutionId: string,
  form: FormData,
) {
  const to = resolutionPath(familyId, resolutionId);
  const ctx = await editor(familyId, to);
  const title = text(form, "title");
  if (!title) go(to, "Please give the resolution a short title.");
  const update: Record<string, string | null> = {
    title,
    background: optional(form, "background"),
  };
  const required = text(form, "required");
  if (required) {
    if (!oneOf(required, REQUIRED)) go(to, "Please choose how many must sign.");
    update.required = required;
  }
  const { error } = await ctx
    .db!.from("written_resolutions")
    .update(update)
    .eq("id", resolutionId);
  go(to, error ? meetingsError(error.message) : undefined, "resolution_saved");
}

const RESOLUTION_SAVED: Record<string, SavedCode> = {
  draft: "resolution_reopened",
  circulated: "resolution_circulated",
  lapsed: "resolution_lapsed",
  passed: "resolution_passed",
};

export async function setResolutionStatus(
  familyId: string,
  resolutionId: string,
  status: string,
  seenVersion: string,
  form: FormData,
) {
  const to = resolutionPath(familyId, resolutionId);
  const ctx = await editor(familyId, to);
  if (!(status in RESOLUTION_SAVED)) go(to, "That isn't possible.");
  if (status === "passed" && !ctx.canManage)
    go(to, "Only a Manager can confirm that a resolution has passed.");
  const update: Record<string, string> = { status };
  if (status === "circulated") {
    const date = text(form, "circulated_on") || today();
    if (!isDate(date))
      go(
        to,
        "Please enter the date it was circulated, as day, month and year.",
      );
    update.circulated_on = date;
  }
  const { data, error } = await ctx
    .db!.from("written_resolutions")
    .update(update)
    .eq("id", resolutionId)
    .eq("updated_at", seenVersion)
    .select("id");
  if (error) go(to, meetingsError(error.message));
  if (!data?.length)
    go(
      to,
      "The resolution was changed while you were looking at it. Please check it again.",
    );
  go(to, undefined, RESOLUTION_SAVED[status]);
}

export async function addSignatory(
  familyId: string,
  resolutionId: string,
  form: FormData,
) {
  const to = resolutionPath(familyId, resolutionId);
  const ctx = await editor(familyId, to);
  const holder = parseHolder(text(form, "who"));
  if (!holder) go(to, "Please choose who is to sign.");
  const { error } = await ctx
    .db!.from("resolution_signatories")
    .insert({ resolution_id: resolutionId, ...holder });
  go(to, error ? meetingsError(error.message) : undefined, "signatory_added");
}

// Adds everyone entitled to vote today who isn't listed yet.
export async function addAllSignatories(
  familyId: string,
  resolutionId: string,
) {
  const to = resolutionPath(familyId, resolutionId);
  const ctx = await editor(familyId, to);
  const { data: w } = await ctx
    .db!.from("written_resolutions")
    .select("body, entity_id, governance_body_id")
    .eq("id", resolutionId)
    .maybeSingle();
  if (!w) go(to, "That resolution couldn't be found.");
  const [{ data: voters, error: e1 }, { data: listed }] = await Promise.all([
    ctx.db!.rpc("body_voters", {
      p_body: w.body,
      p_entity: w.entity_id,
      p_gov: w.governance_body_id,
      p_on: today(),
    }),
    ctx
      .db!.from("resolution_signatories")
      .select("person_id, organisation_id, holder_entity_id")
      .eq("resolution_id", resolutionId),
  ]);
  if (e1) go(to, meetingsError(e1.message));
  type H = {
    person_id: string | null;
    organisation_id: string | null;
    holder_entity_id: string | null;
  };
  const key = (h: H) =>
    `${h.person_id}|${h.organisation_id}|${h.holder_entity_id}`;
  const have = new Set(((listed ?? []) as H[]).map(key));
  const add = ((voters ?? []) as H[]).filter((v) => !have.has(key(v)));
  if (add.length === 0) go(to, "Everyone entitled to vote is already listed.");
  const { error } = await ctx
    .db!.from("resolution_signatories")
    .insert(
      add.map((v) => ({
        resolution_id: resolutionId,
        person_id: v.person_id,
        organisation_id: v.organisation_id,
        holder_entity_id: v.holder_entity_id,
      })),
    );
  go(to, error ? meetingsError(error.message) : undefined, "signatories_added");
}

export async function recordSignature(
  familyId: string,
  resolutionId: string,
  signatoryId: string,
  form: FormData,
) {
  const to = resolutionPath(familyId, resolutionId);
  const ctx = await editor(familyId, to);
  const date = text(form, "signed_on");
  if (date && !isDate(date))
    go(to, "Please enter the date it was signed, as day, month and year.");
  const { error } = await ctx
    .db!.from("resolution_signatories")
    .update({
      signed_on: date || null,
      signed_for_by: optional(form, "signed_for_by"),
    })
    .eq("id", signatoryId)
    .eq("resolution_id", resolutionId);
  go(
    to,
    error ? meetingsError(error.message) : undefined,
    date ? "signature_recorded" : "signature_cleared",
  );
}

export async function removeSignatory(
  familyId: string,
  resolutionId: string,
  signatoryId: string,
) {
  const ctx = await getFamilyContext(familyId);
  const error = await askToRemove(ctx, "resolution_signatories", signatoryId, {
    resolution_id: resolutionId,
  });
  go(
    resolutionPath(familyId, resolutionId),
    error ?? undefined,
    "removal_requested",
  );
}

export async function removeResolution(familyId: string, resolutionId: string) {
  const ctx = await getFamilyContext(familyId);
  const error = await askToRemove(ctx, "written_resolutions", resolutionId);
  go(
    resolutionPath(familyId, resolutionId),
    error ?? undefined,
    "removal_requested",
  );
}

// --- File notes -------------------------------------------------------------------

export async function createNote(
  familyId: string,
  back: string,
  form: FormData,
) {
  const to = safeBack(familyId, back);
  const ctx = await editor(familyId, to);
  const title = text(form, "title");
  const body = text(form, "body");
  const kind = text(form, "kind") || "other";
  const date = text(form, "noted_on") || today();
  const time = text(form, "noted_at");
  if (!title) go(to, "Please give the note a short title.");
  if (!body) go(to, "Please write the note.");
  if (!oneOf(kind, NOTE_KINDS))
    go(to, "Please choose what kind of note it is.");
  if (!isDate(date)) go(to, "Please enter the date as day, month and year.");
  if (time && !/^\d{2}:\d{2}$/.test(time))
    go(to, "Please enter the time as hours and minutes, e.g. 14:30.");
  const [kindOf, id] = text(form, "about").split(":");
  const about =
    id && /^[0-9a-f-]{36}$/i.test(id)
      ? kindOf === "entity"
        ? { entity_id: id }
        : kindOf === "governance"
          ? { governance_body_id: id }
          : kindOf === "branch"
            ? { branch_id: id }
            : {}
      : {};
  const { data, error } = await ctx
    .db!.from("file_notes")
    .insert({
      ...about,
      title,
      body,
      kind,
      noted_on: date,
      noted_at: time || null,
    })
    .select("id")
    .single();
  if (error || !data) go(to, meetingsError(error?.message));
  const people = form
    .getAll("people")
    .map(String)
    .filter((p) => /^[0-9a-f-]{36}$/i.test(p));
  if (people.length) {
    const { error: e } = await ctx
      .db!.from("file_note_people")
      .insert(people.map((person_id) => ({ note_id: data.id, person_id })));
    if (e)
      go(
        to,
        `The note was saved, but the people weren't linked: ${meetingsError(e.message)}`,
      );
  }
  go(to, undefined, "note_added");
}

export async function updateNote(
  familyId: string,
  back: string,
  noteId: string,
  form: FormData,
) {
  const to = safeBack(familyId, back);
  const ctx = await editor(familyId, to);
  const title = text(form, "title");
  const body = text(form, "body");
  if (!title || !body) go(to, "Please give the note a title and its text.");
  const { error } = await ctx
    .db!.from("file_notes")
    .update({ title, body })
    .eq("id", noteId);
  go(to, error ? meetingsError(error.message) : undefined, "note_saved");
}

export async function removeNote(
  familyId: string,
  back: string,
  noteId: string,
) {
  const ctx = await getFamilyContext(familyId);
  const error = await askToRemove(ctx, "file_notes", noteId);
  go(safeBack(familyId, back), error ?? undefined, "removal_requested");
}

// --- Quorums (from the articles, or the body's own rules) ------------------------

function parseQuorum(
  form: FormData,
  prefix: string,
): { rule: string | null; number: number | null } | { error: string } {
  const rule = text(form, `${prefix}_rule`);
  const n = text(form, `${prefix}_number`);
  if (!rule) return { rule: null, number: null };
  if (!["number", "majority", "all"].includes(rule))
    return { error: "Please choose the quorum." };
  if (rule !== "number") return { rule, number: null };
  if (!/^\d{1,3}$/.test(n) || Number(n) < 1)
    return { error: "Please give the quorum as a whole number, e.g. 2." };
  return { rule, number: Number(n) };
}

export async function saveEntityQuorum(
  familyId: string,
  entityId: string,
  form: FormData,
) {
  const to = `/families/${familyId}/organisation/${entityId}`;
  const ctx = await editor(familyId, to);
  const board = parseQuorum(form, "board_quorum");
  const members = parseQuorum(form, "members_quorum");
  if ("error" in board) go(to, board.error);
  if ("error" in members) go(to, members.error);
  const { error } = await ctx
    .db!.from("entities")
    .update({
      board_quorum_rule: board.rule,
      board_quorum_number: board.number,
      members_quorum_rule: members.rule,
      members_quorum_number: members.number,
    })
    .eq("id", entityId);
  go(to, error ? meetingsError(error.message) : undefined, "quorum_saved");
}

export async function saveBodyQuorum(
  familyId: string,
  bodyId: string,
  form: FormData,
) {
  const to = `/families/${familyId}/branches/governance`;
  const ctx = await editor(familyId, to);
  const q = parseQuorum(form, "quorum");
  if ("error" in q) go(to, q.error);
  const { error } = await ctx
    .db!.from("governance_bodies")
    .update({ quorum_rule: q.rule, quorum_number: q.number })
    .eq("id", bodyId);
  go(to, error ? meetingsError(error.message) : undefined, "quorum_saved");
}
