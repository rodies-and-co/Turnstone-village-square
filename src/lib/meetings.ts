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
  noted: "Noted",
} as const;
// The outcomes that can be chosen for a meeting's item ("Noted" items are
// notes, such as a resignation, made when the item is added).
export const MEETING_OUTCOMES = {
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

// --- Wording drafted for officer and share changes ---------------------------

const longDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
const n = (x: number) => x.toLocaleString("en-GB");

export function appointWording(o: {
  name: string;
  role: string;
  from?: string | null;
}) {
  return {
    title: `Appointment of ${o.name} as ${o.role.toLowerCase()}`,
    wording: `That ${o.name} be appointed as ${o.role.toLowerCase()}${o.from ? ` with effect from ${longDate(o.from)}` : ", with effect from the date of this decision"}, and that the register be updated.`,
  };
}

export function removalWording(o: {
  name: string;
  role: string;
  from?: string | null;
}) {
  return {
    title: `Removal of ${o.name} as ${o.role.toLowerCase()}`,
    wording: `That ${o.name} be removed as ${o.role.toLowerCase()}${o.from ? ` with effect from ${longDate(o.from)}` : ", with effect from the date of this decision"}, and that the register be updated.`,
  };
}

// A resignation is noted, not decided. In a meeting it reads as a note; in a
// written resolution it is resolved that it be noted.
export function resignationWording(o: {
  name: string;
  role: string;
  on: string;
  inMeeting: boolean;
  board: string;
}) {
  const r = `the resignation of ${o.name} as ${o.role.toLowerCase()} on ${longDate(o.on)}`;
  return {
    title: `Resignation of ${o.name} as ${o.role.toLowerCase()}`,
    wording: o.inMeeting
      ? `The ${o.board.toLowerCase()} noted ${r}.`
      : `That ${r} be noted.`,
  };
}

export function shareWording(o: {
  kind: "authorise" | "issue" | "transfer";
  shares: number;
  className: string;
  units?: "shares" | "units";
  to?: string;
  from?: string;
  consideration?: string | null;
}) {
  const u = o.units ?? "shares";
  const what = `${n(o.shares)} ${o.className} ${u}`;
  if (o.kind === "authorise")
    return {
      title: `Increase in the ${o.className} ${u} authorised`,
      wording: `That the number of ${o.className} ${u} the company may issue be increased by ${n(o.shares)}.`,
    };
  if (o.kind === "issue")
    return {
      title: `Allotment of ${what}`,
      wording: `That ${what} be allotted to ${o.to}${o.consideration ? ` for ${o.consideration}` : ""}, that the register of members be updated and that a share certificate be issued.`,
    };
  return {
    title: `Transfer of ${what}`,
    wording: `That the transfer of ${what} from ${o.from} to ${o.to} be approved and registered, and that new share certificates be issued.`,
  };
}

// The "Decided by" choices that draft a decision: an open meeting, an open
// written resolution, or a new written resolution of the board or members.
export type Target =
  | { kind: "meeting" | "resolution"; id: string }
  | { kind: "new_resolution"; body: "board" | "members" };
export function parseTarget(choice: string): Target | null {
  const [kind, id] = choice.split(":");
  if (
    (kind === "meeting" || kind === "resolution") &&
    /^[0-9a-f-]{36}$/i.test(id ?? "")
  )
    return { kind, id };
  if (kind === "new_resolution" && (id === "board" || id === "members"))
    return { kind, body: id };
  return null;
}

// What an item will change, in words.
export function actionText(action: string | null, inMeeting: boolean) {
  const when = inMeeting
    ? "When it is carried and the meeting confirmed"
    : "When the resolution passes";
  if (action === "appoint")
    return `${when}, the appointment is recorded on the Officers tab and in the registers.`;
  if (action === "end_appointment") return `${when}, the appointment ends.`;
  if (action === "share_transaction")
    return `${when}, the share transaction goes on the register of members.`;
  if (action === "note_resignation")
    return "A note: the resignation has been recorded and the appointment has ended.";
  return null;
}
