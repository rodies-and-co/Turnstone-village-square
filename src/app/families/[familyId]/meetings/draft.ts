import "server-only";
import type { FamilyContext } from "@/lib/family-context";
import { formatDate } from "@/lib/governance";
import {
  boardName,
  hasMembers,
  membersName,
  meetingsError,
  type Target,
  wayOf,
  type Way,
} from "@/lib/meetings";

// Drafting a decision for an officer or share change: the item is added to an
// open meeting or written resolution of the entity (or a new written
// resolution, with everyone entitled to vote asked to sign). The change
// follows by itself once the decision passes (see the family database).

export type DraftItem = {
  title: string;
  wording: string;
  action:
    | "appoint"
    | "end_appointment"
    | "note_resignation"
    | "share_transaction"
    | "distribution"
    | "dividend";
  appointment_id?: string;
  proposed?: Record<string, unknown>;
  noted?: boolean; // a note (e.g. a resignation) rather than a decision, in a meeting
};

// The open meetings and resolutions of this entity's board and members, and
// new written resolutions, as choices for "Decided by".
export type { Way };

export async function decisionTargets(
  ctx: FamilyContext,
  entity: { id: string; entity_type: string },
  // Only these ways (e.g. who may remove a director); everything when not given.
  allow?: Way[] | null,
): Promise<[string, string][]> {
  const ok = (kind: "meeting" | "resolution", body: string) =>
    !allow || allow.includes(wayOf(kind, body) as Way);
  const db = ctx.db!;
  const [{ data: m }, { data: r }] = await Promise.all([
    db
      .from("meetings")
      .select("id, body, title, meeting_on, status")
      .eq("entity_id", entity.id)
      .in("status", ["planned", "held"])
      .order("meeting_on"),
    db
      .from("written_resolutions")
      .select("id, body, title, status")
      .eq("entity_id", entity.id)
      .eq("status", "draft")
      .order("created_at"),
  ]);
  const who = (body: string) =>
    body === "members"
      ? membersName(entity.entity_type)
      : boardName(entity.entity_type);
  return [
    ...(
      (m ?? []) as {
        id: string;
        body: string;
        title: string;
        meeting_on: string;
        status: string;
      }[]
    )
      .filter((x) => ok("meeting", x.body))
      .map(
        (x) =>
          [
            `meeting:${x.id}`,
            `${x.title} of ${formatDate(x.meeting_on)} – ${who(x.body)} (${x.status === "held" ? "held, not yet confirmed" : "planned"})`,
          ] as [string, string],
      ),
    ...((r ?? []) as { id: string; body: string; title: string }[])
      .filter((x) => ok("resolution", x.body))
      .map(
        (x) =>
          [
            `resolution:${x.id}`,
            `Draft written resolution: ${x.title} – ${who(x.body)}`,
          ] as [string, string],
      ),
    ...(ok("resolution", "board")
      ? ([
          [
            "new_resolution:board",
            `A new written resolution of the ${boardName(entity.entity_type).toLowerCase()}`,
          ],
        ] as [string, string][])
      : []),
    ...(hasMembers(entity.entity_type) && ok("resolution", "members")
      ? ([
          [
            "new_resolution:members",
            `A new written resolution of the ${membersName(entity.entity_type).toLowerCase()}`,
          ],
        ] as [string, string][])
      : []),
  ];
}

// Adds the item; returns where it went, or an error message.
export async function draftDecision(
  ctx: FamilyContext,
  entityId: string,
  target: Target,
  item: DraftItem,
): Promise<
  { decisionId: string; href: string; inMeeting: boolean } | { error: string }
> {
  const db = ctx.db!;
  let column: "meeting_id" | "resolution_id";
  let parentId: string;
  let inMeeting = false;
  if (target.kind === "new_resolution") {
    const { data, error } = await db
      .from("written_resolutions")
      .insert({
        body: target.body,
        entity_id: entityId,
        title: item.title,
        required: target.body === "board" ? "all" : "majority",
      })
      .select("id")
      .single();
    if (error || !data) return { error: meetingsError(error?.message) };
    column = "resolution_id";
    parentId = data.id;
    // Everyone entitled to vote today is asked to sign.
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "Europe/London",
    });
    const { data: voters } = await db.rpc("body_voters", {
      p_body: target.body,
      p_entity: entityId,
      p_gov: null,
      p_on: today,
    });
    const rows = (
      (voters ?? []) as {
        person_id: string | null;
        organisation_id: string | null;
        holder_entity_id: string | null;
      }[]
    ).map((v) => ({
      resolution_id: parentId,
      person_id: v.person_id,
      organisation_id: v.organisation_id,
      holder_entity_id: v.holder_entity_id,
    }));
    if (rows.length) {
      const { error: e } = await db.from("resolution_signatories").insert(rows);
      if (e)
        return {
          error: `A new draft resolution was created, but its signatories weren't added: ${meetingsError(e.message)}`,
        };
    }
  } else if (target.kind === "meeting") {
    const { data } = await db
      .from("meetings")
      .select("id, status")
      .eq("id", target.id)
      .eq("entity_id", entityId)
      .maybeSingle();
    if (!data || !["planned", "held"].includes(data.status))
      return {
        error:
          "That meeting can't take new items (it may be confirmed or cancelled). Choose another.",
      };
    column = "meeting_id";
    parentId = data.id;
    inMeeting = true;
  } else {
    const { data } = await db
      .from("written_resolutions")
      .select("id, status")
      .eq("id", target.id)
      .eq("entity_id", entityId)
      .maybeSingle();
    if (!data || data.status !== "draft")
      return {
        error:
          "That resolution has already been circulated. Choose another, or a new one.",
      };
    column = "resolution_id";
    parentId = data.id;
  }
  const { data: items } = await db
    .from("decisions")
    .select("item")
    .eq(column, parentId)
    .order("item", { ascending: false })
    .limit(1);
  const { data: d, error } = await db
    .from("decisions")
    .insert({
      [column]: parentId,
      item: ((items?.[0]?.item as number | undefined) ?? 0) + 1,
      title: item.title,
      wording: item.wording,
      action: item.action,
      appointment_id: item.appointment_id ?? null,
      proposed: item.proposed ?? null,
      outcome: item.noted && inMeeting ? "noted" : "proposed",
    })
    .select("id")
    .single();
  if (error || !d)
    return {
      error:
        target.kind === "new_resolution"
          ? `A new draft resolution was created, but the decision couldn't be added to it: ${meetingsError(error?.message)}`
          : meetingsError(error?.message),
    };
  const href =
    column === "meeting_id"
      ? `/families/${ctx.family.id}/meetings/${parentId}`
      : `/families/${ctx.family.id}/meetings/resolutions/${parentId}`;
  return { decisionId: d.id, href, inMeeting };
}

// Is this target one of the allowed ways? (Checked again when the removal is drafted.)
export async function targetAllowed(
  ctx: FamilyContext,
  entityId: string,
  target: Target,
  allow: Way[] | null,
): Promise<boolean> {
  if (!allow) return true;
  if (target.kind === "new_resolution")
    return allow.includes(wayOf("resolution", target.body) as Way);
  const { data } = await ctx
    .db!.from(target.kind === "meeting" ? "meetings" : "written_resolutions")
    .select("body")
    .eq("id", target.id)
    .eq("entity_id", entityId)
    .maybeSingle();
  return Boolean(data && allow.includes(wayOf(target.kind, data.body) as Way));
}
