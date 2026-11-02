import "server-only";
import type { FamilyContext } from "@/lib/family-context";
import { formatDate } from "@/lib/governance";
import { bodyLabel, decisionRef, hasMembers, type Body } from "@/lib/meetings";

// Loads what the meetings pages show, from the family database. Every read
// goes through the family's access rules, so a Viewer sees only what they may.

export type EntityLite = {
  id: string;
  name: string;
  entity_type: string;
  board_quorum_rule: string | null;
  board_quorum_number: number | null;
  members_quorum_rule: string | null;
  members_quorum_number: number | null;
};
export type GovLite = {
  id: string;
  name: string;
  branch_id: string | null;
  quorum_rule: string | null;
  quorum_number: number | null;
};

export type Meeting = {
  id: string;
  body: Body;
  entity_id: string | null;
  governance_body_id: string | null;
  title: string;
  meeting_on: string;
  starts_at: string | null;
  location: string | null;
  video_link: string | null;
  agenda: string | null;
  status: "planned" | "held" | "confirmed" | "cancelled";
  quorum_met: boolean | null;
  number: number | null;
  minutes: string | null;
  minutes_status: "draft" | "circulated" | "approved";
  minutes_approved_on: string | null;
  minutes_signed_by: string | null;
  prepared_by: string | null;
  edited_by: string[];
  confirmed_by: string | null;
  confirmed_at: string | null;
  updated_at: string;
};

export type Resolution = {
  id: string;
  body: Body;
  entity_id: string | null;
  governance_body_id: string | null;
  title: string;
  background: string | null;
  required: "all" | "majority" | "three_quarters";
  status: "draft" | "circulated" | "passed" | "lapsed";
  circulated_on: string | null;
  passed_on: string | null;
  number: number | null;
  prepared_by: string | null;
  edited_by: string[];
  confirmed_by: string | null;
  confirmed_at: string | null;
  updated_at: string;
};

export type Decision = {
  id: string;
  meeting_id: string | null;
  resolution_id: string | null;
  item: number;
  title: string;
  background: string | null;
  wording: string;
  outcome: "proposed" | "carried" | "not_carried" | "withdrawn";
  votes_for: number | null;
  votes_against: number | null;
  abstentions: number | null;
  passed_on: string | null;
};

export type FileNote = {
  id: string;
  entity_id: string | null;
  governance_body_id: string | null;
  branch_id: string | null;
  title: string;
  kind: string;
  noted_on: string;
  noted_at: string | null;
  body: string;
  written_by: string | null;
  people: string[];
};

// Which bodies' records to show: everything, one entity's, or one body's.
export type Scope = { entityId?: string; govId?: string };

export async function loadBodies(ctx: FamilyContext) {
  const db = ctx.db!;
  const [{ data: ents }, { data: govs }] = await Promise.all([
    db
      .from("entities")
      .select(
        "id, name, entity_type, board_quorum_rule, board_quorum_number, members_quorum_rule, members_quorum_number",
      )
      .order("name"),
    db
      .from("governance_bodies")
      .select("id, name, branch_id, quorum_rule, quorum_number")
      .order("name"),
  ]);
  const entities = (ents ?? []) as EntityLite[];
  const bodies = (govs ?? []) as GovLite[];
  const label = (body: Body, entityId: string | null, govId: string | null) =>
    bodyLabel(
      body,
      entities.find((e) => e.id === entityId),
      bodies.find((b) => b.id === govId),
    );
  // Choices for "Who decides": "board:<entity>", "members:<entity>", "governance:<body>".
  const choices = (scope: Scope = {}): [string, string][] => [
    ...entities
      .filter(
        (e) => !scope.govId && (!scope.entityId || e.id === scope.entityId),
      )
      .flatMap((e) => [
        [`board:${e.id}`, label("board", e.id, null)] as [string, string],
        ...(hasMembers(e.entity_type)
          ? [
              [`members:${e.id}`, label("members", e.id, null)] as [
                string,
                string,
              ],
            ]
          : []),
      ]),
    ...bodies
      .filter((b) => !scope.entityId && (!scope.govId || b.id === scope.govId))
      .map((b) => [`governance:${b.id}`, b.name] as [string, string]),
  ];
  return { entities, bodies, label, choices };
}

export async function loadRecords(ctx: FamilyContext, scope: Scope = {}) {
  const db = ctx.db!;
  let mq = db
    .from("meetings")
    .select("*")
    .order("meeting_on", { ascending: false });
  let rq = db
    .from("written_resolutions")
    .select("*")
    .order("created_at", { ascending: false });
  let nq = db
    .from("file_notes")
    .select("*, file_note_people(person_id)")
    .order("noted_on", { ascending: false });
  if (scope.entityId) {
    mq = mq.eq("entity_id", scope.entityId);
    rq = rq.eq("entity_id", scope.entityId);
    nq = nq.eq("entity_id", scope.entityId);
  }
  if (scope.govId) {
    mq = mq.eq("governance_body_id", scope.govId);
    rq = rq.eq("governance_body_id", scope.govId);
    nq = nq.eq("governance_body_id", scope.govId);
  }
  const [{ data: m }, { data: r }, { data: n }] = await Promise.all([
    mq,
    rq,
    nq,
  ]);
  const meetings = (m ?? []) as Meeting[];
  const resolutions = (r ?? []) as Resolution[];
  const ids = [...meetings.map((x) => x.id), ...resolutions.map((x) => x.id)];
  const { data: d } = ids.length
    ? await db
        .from("decisions")
        .select("*")
        .or(
          `meeting_id.in.(${meetings.map((x) => x.id).join(",") || "00000000-0000-0000-0000-000000000000"}),resolution_id.in.(${resolutions.map((x) => x.id).join(",") || "00000000-0000-0000-0000-000000000000"})`,
        )
        .order("item")
    : { data: [] };
  const notes = (
    (n ?? []) as (Omit<FileNote, "people"> & {
      file_note_people: { person_id: string }[];
    })[]
  ).map(({ file_note_people, ...note }) => ({
    ...note,
    people: file_note_people.map((p) => p.person_id),
  }));
  return { meetings, resolutions, decisions: (d ?? []) as Decision[], notes };
}

// A decision's reference, e.g. "Minute 3, item 2".
export function refFor(
  d: Decision,
  meetings: Meeting[],
  resolutions: Resolution[],
) {
  if (d.meeting_id) {
    const m = meetings.find((x) => x.id === d.meeting_id);
    return m
      ? decisionRef(
          d,
          { kind: "meeting", number: m.number, meeting_on: m.meeting_on },
          formatDate,
        )
      : `Item ${d.item}`;
  }
  const r = resolutions.find((x) => x.id === d.resolution_id);
  return decisionRef(
    d,
    { kind: "resolution", number: r?.number ?? null },
    formatDate,
  );
}

// The choices for "Decided by" on a share transaction or an appointment of
// this entity: its board's and members' decisions that are passed or still
// open (not those not carried or withdrawn), newest first.
export async function decisionChoices(
  ctx: FamilyContext,
  entityId: string,
  opts: { passedOnly?: boolean } = {},
) {
  const { meetings, resolutions, decisions } = await loadRecords(ctx, {
    entityId,
  });
  const open = (d: Decision) => {
    if (d.passed_on) return true;
    if (
      opts.passedOnly ||
      d.outcome === "withdrawn" ||
      d.outcome === "not_carried"
    )
      return false;
    const m = meetings.find((x) => x.id === d.meeting_id);
    const r = resolutions.find((x) => x.id === d.resolution_id);
    return m
      ? m.status !== "cancelled" && m.status !== "confirmed"
      : r
        ? r.status === "draft" || r.status === "circulated"
        : false;
  };
  const date = (d: Decision) =>
    d.passed_on ??
    meetings.find((x) => x.id === d.meeting_id)?.meeting_on ??
    "";
  return decisions
    .filter(open)
    .sort((a, b) => date(b).localeCompare(date(a)))
    .map((d) => {
      const who = d.meeting_id
        ? meetings.find((x) => x.id === d.meeting_id)?.body
        : resolutions.find((x) => x.id === d.resolution_id)?.body;
      const by = who === "members" ? "Members" : "Board";
      const when = d.passed_on
        ? `passed ${formatDate(d.passed_on)}`
        : "not passed yet";
      return [
        `decision:${d.id}`,
        `${by}: ${refFor(d, meetings, resolutions)} – ${d.title} (${when})`,
      ] as [string, string];
    });
}

// How a share transaction or appointment was decided, in words.
export async function basisLabels(ctx: FamilyContext, entityId: string) {
  const { meetings, resolutions, decisions } = await loadRecords(ctx, {
    entityId,
  });
  const byId = new Map(decisions.map((d) => [d.id, d]));
  return (row: {
    basis: string | null;
    decision_id: string | null;
    basis_note: string | null;
  }) => {
    if (row.basis === "decision" && row.decision_id) {
      const d = byId.get(row.decision_id);
      return d
        ? `${refFor(d, meetings, resolutions)}: ${d.title}${d.passed_on ? "" : " (not passed yet)"}`
        : "A decision you can't see";
    }
    if (row.basis === "formation") return "The formation documents";
    if (row.basis === "instrument")
      return row.basis_note ?? "A deed of appointment";
    if (row.basis === "earlier")
      return "Recorded before decisions were kept here";
    return null;
  };
}
