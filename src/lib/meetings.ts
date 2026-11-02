// Meetings, written resolutions and file notes: words and small rules shared
// by the pages. Pure (no database), so it can be tested on its own.

export type Body = "board" | "members" | "governance";

export const MEETING_STATUS = {
  planned: "Planned",
  held: "Held – waiting to be confirmed",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
} as const;

export const MINUTES_STATUS = {
  draft: "Draft",
  circulated: "Circulated",
  approved: "Approved and signed",
} as const;

export const RESOLUTION_STATUS = {
  draft: "Draft",
  circulated: "Circulated for signature",
  passed: "Passed",
  lapsed: "Lapsed",
} as const;

export const REQUIRED = {
  all: "Everyone entitled to vote",
  majority: "More than half the votes",
  three_quarters: "Three quarters of the votes",
} as const;

export const OUTCOMES = {
  proposed: "Proposed",
  carried: "Carried",
  not_carried: "Not carried",
  withdrawn: "Withdrawn",
} as const;

export const QUORUM_RULES = {
  number: "A set number",
  majority: "A majority",
  all: "Everyone",
} as const;

export const NOTE_KINDS = {
  phone_call: "Phone call",
  meeting: "Meeting or conversation",
  email: "Email or letter",
  visit: "Visit",
  other: "Other",
} as const;

export const BASIS = {
  decision: "A passed minute or written resolution",
  formation: "The formation documents (constitution, deed or charter)",
  instrument: "A deed or letter of appointment",
  earlier: "Recorded before decisions were kept here",
} as const;
export type Basis = keyof typeof BASIS;

// What the board of each kind of entity is called.
export function boardName(entityType: string) {
  return (
    {
      company: "Board of directors",
      llc: "Managers",
      trust: "Trustees",
      foundation: "Council",
      partnership: "General partners",
    }[entityType] ?? "Board"
  );
}
export function membersName(entityType: string) {
  return entityType === "llc" ? "Members" : "Shareholders (members)";
}
export const hasMembers = (entityType: string) =>
  entityType === "company" || entityType === "llc";

// "Board of directors of Visser Holdings Limited", "Hartley Family Council".
export function bodyLabel(
  body: Body,
  entity?: { name: string; entity_type: string } | null,
  gov?: { name: string } | null,
) {
  if (body === "governance") return gov?.name ?? "A governance body";
  if (!entity) return body === "board" ? "The board" : "The members";
  return `${body === "board" ? boardName(entity.entity_type) : membersName(entity.entity_type)} of ${entity.name}`;
}

// The reference of a decision in the registers: "Minute 3, item 2" or
// "Resolution 4, item 1"; before it has a number, the meeting date.
export function decisionRef(
  d: { item: number },
  parent:
    | { kind: "meeting"; number: number | null; meeting_on: string }
    | { kind: "resolution"; number: number | null },
  fmt: (d: string) => string | null,
) {
  if (parent.kind === "meeting")
    return parent.number
      ? `Minute ${parent.number}, item ${d.item}`
      : `Meeting of ${fmt(parent.meeting_on)}, item ${d.item}`;
  return parent.number
    ? `Resolution ${parent.number}, item ${d.item}`
    : `Written resolution, item ${d.item}`;
}

// The "Decided by" choice in a form: "decision:<id>", "formation" or
// "instrument" (with a note).
export function parseBasis(
  choice: string,
  note: string,
):
  | { basis: Basis; decision_id: string | null; basis_note: string | null }
  | { error: string } {
  if (choice.startsWith("decision:")) {
    const id = choice.slice("decision:".length);
    if (!/^[0-9a-f-]{36}$/i.test(id))
      return { error: "Please choose the decision." };
    return { basis: "decision", decision_id: id, basis_note: null };
  }
  if (choice === "formation")
    return { basis: "formation", decision_id: null, basis_note: null };
  if (choice === "instrument") {
    if (!note.trim())
      return {
        error:
          "Please give the deed or letter of appointment (its date and who signed it).",
      };
    return { basis: "instrument", decision_id: null, basis_note: note.trim() };
  }
  return {
    error:
      "Please say what it was decided by: a minute or resolution, the formation documents, or a deed of appointment.",
  };
}

// Whether the quorum was (or would be) met.
export function quorumText(q: {
  entitled: number;
  present: number;
  needed: number | null;
}) {
  if (q.needed === null) return "No quorum is recorded yet.";
  const met = q.present >= q.needed && q.present > 0;
  return `${q.present} of ${q.entitled} entitled to vote present; ${q.needed} needed. ${met ? "Quorum met." : "Quorum not met."}`;
}

// Database messages start with the area ("Meetings: …"); show the rest.
export function meetingsError(message: string | undefined) {
  const m = message ?? "";
  const known = /^(Meetings|Decisions|Resolutions|Shares|Appointments): /;
  if (known.test(m)) return m.replace(known, "");
  if (/meeting_attendees_once|resolution_signatories_once/.test(m))
    return "They are already on the list.";
  if (/meeting_attendees_one_chair/.test(m))
    return "The meeting already has a chair.";
  if (/decisions_(meeting|resolution)_item/.test(m))
    return "There is already an item with that number.";
  if (/video_link/.test(m)) return "The video link should start with https://.";
  if (/row-level security/.test(m))
    return "You don't have permission to change this.";
  return m
    ? "That couldn't be saved. Please check the details and try again."
    : "Something went wrong.";
}
