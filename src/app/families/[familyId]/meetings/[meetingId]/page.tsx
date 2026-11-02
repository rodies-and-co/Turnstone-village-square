import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell, PageTitle } from "@/components/AppShell";
import { ConfirmRemove, SubmitButton, Toast } from "@/components/feedback";
import { PrintButton } from "@/components/PrintButton";
import {
  Card,
  Checkbox,
  Chip,
  Facts,
  Field,
  Fold,
  Notice,
  Select,
} from "@/components/ui";
import { getFamilyContext } from "@/lib/family-context";
import { formatDate } from "@/lib/governance";
import {
  MEETING_STATUS,
  MINUTES_STATUS,
  OUTCOMES,
  quorumText,
} from "@/lib/meetings";
import { errorMessage, savedMessage } from "@/lib/messages";
import { displayNames, type PersonSummary } from "@/lib/people";
import {
  addAllVoters,
  addAttendee,
  addDecision,
  approveMinutes,
  removeAttendee,
  removeDecision,
  removeMeeting,
  saveMinutes,
  setMeetingStatus,
  setOutcome,
  updateAttendee,
  updateDecision,
  updateMeeting,
} from "../actions";
import { TextArea } from "../DecisionsArea";
import { loadBodies, type Decision, type Meeting } from "../meetings-data";

export const dynamic = "force-dynamic";

type Attendee = {
  id: string;
  person_id: string | null;
  organisation_id: string | null;
  holder_entity_id: string | null;
  represented_by: string | null;
  capacity: "voting" | "in_attendance";
  attendance: "present" | "apologies" | "absent";
  is_chair: boolean;
};
type H = {
  person_id: string | null;
  organisation_id: string | null;
  holder_entity_id: string | null;
};
const holderValue = (h: H) =>
  h.person_id
    ? `person:${h.person_id}`
    : h.organisation_id
      ? `organisation:${h.organisation_id}`
      : `entity:${h.holder_entity_id}`;

export default async function MeetingPage({
  params,
  searchParams,
}: {
  params: Promise<{ familyId: string; meetingId: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { familyId, meetingId } = await params;
  const sp = await searchParams;
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db) notFound();
  const db = ctx.db;
  const { data: row } = await db
    .from("meetings")
    .select("*")
    .eq("id", meetingId)
    .maybeSingle();
  if (!row) notFound();
  const m = row as Meeting;

  const [
    { data: att },
    { data: dec },
    { data: q },
    { data: peopleRows },
    { data: orgRows },
    { data: entRows },
    voters,
    bodies,
  ] = await Promise.all([
    db
      .from("meeting_attendees")
      .select("*")
      .eq("meeting_id", meetingId)
      .order("created_at"),
    db.from("decisions").select("*").eq("meeting_id", meetingId).order("item"),
    db.rpc("meeting_quorum", { p_meeting: meetingId }),
    db
      .from("people")
      .select("id, full_names, surname, known_as, birth_year")
      .order("surname"),
    db.from("outside_organisations").select("id, name").order("name"),
    db.from("entities").select("id, name").order("name"),
    ctx.canEdit
      ? db
          .rpc("body_voters", {
            p_body: m.body,
            p_entity: m.entity_id,
            p_gov: m.governance_body_id,
            p_on: m.meeting_on,
          })
          .then((r) => (r.data ?? []) as H[])
      : Promise.resolve([] as H[]),
    loadBodies(ctx),
  ]);
  const attendees = (att ?? []) as Attendee[];
  const decisions = (dec ?? []) as Decision[];
  const quorum = (
    (q ?? []) as { entitled: number; present: number; needed: number | null }[]
  )[0] ?? { entitled: 0, present: 0, needed: null };
  const names = displayNames((peopleRows ?? []) as PersonSummary[]);
  const orgs = new Map(
    ((orgRows ?? []) as { id: string; name: string }[]).map((o) => [
      o.id,
      o.name,
    ]),
  );
  const ents = new Map(
    ((entRows ?? []) as { id: string; name: string }[]).map((e) => [
      e.id,
      e.name,
    ]),
  );
  const nameOf = (h: H) =>
    h.person_id
      ? (names.get(h.person_id) ?? "Someone you can't see")
      : h.organisation_id
        ? (orgs.get(h.organisation_id) ?? "A service provider")
        : (ents.get(h.holder_entity_id ?? "") ?? "An entity you can't see");

  const body = bodies.label(m.body, m.entity_id, m.governance_body_id);
  const editable =
    ctx.canEdit && (m.status === "planned" || m.status === "held");
  const me = ctx.user?.id ?? "";
  const iChanged = m.prepared_by === me || m.edited_by.includes(me);
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Europe/London",
  });
  const listed = new Set(attendees.map(holderValue));
  const missingVoters = voters.filter((v) => !listed.has(holderValue(v)));
  const familyName = /family$/i.test(ctx.family.name.trim())
    ? ctx.family.name
    : `${ctx.family.name} family`;
  const listHref = m.entity_id
    ? `/families/${familyId}/organisation/${m.entity_id}?tab=decisions`
    : `/families/${familyId}/meetings?who=${encodeURIComponent(`governance:${m.governance_body_id}`)}`;
  const present = attendees.filter((a) => a.attendance === "present");
  const chair = attendees.find((a) => a.is_chair);
  const statusForm = (
    status: string,
    text: string,
    variant: "primary" | "secondary" = "secondary",
    pending = "Saving…",
  ) => (
    <form
      action={setMeetingStatus.bind(
        null,
        familyId,
        meetingId,
        status,
        m.updated_at,
      )}
    >
      <SubmitButton variant={variant} pendingText={pending}>
        {text}
      </SubmitButton>
    </form>
  );

  return (
    <AppShell
      family={{ id: familyId, name: ctx.family.name }}
      section="meetings"
      crumbs={[
        ["My families", "/"],
        [familyName, `/families/${familyId}`],
        ["Meetings & resolutions", `/families/${familyId}/meetings`],
        [m.title],
      ]}
      user={{
        name: ctx.displayName,
        roleLabel: ctx.roleLabel,
        hasTwoFactor: ctx.hasTwoFactor,
      }}
    >
      {sp.error && (
        <Toast
          key={`e-${sp.error}-${Date.now()}`}
          kind="error"
          message={errorMessage(sp.error)!}
        />
      )}
      {sp.saved && !sp.error && (
        <Toast
          key={`s-${sp.saved}-${Date.now()}`}
          message={savedMessage(sp.saved)!}
        />
      )}
      <PageTitle
        eyebrow={body}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {m.title}
            <Chip>{MEETING_STATUS[m.status]}</Chip>
          </span>
        }
        subtitle={[
          formatDate(m.meeting_on),
          m.starts_at?.slice(0, 5),
          m.location,
          m.number ? `Minute ${m.number}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <Link href={listHref} className="btn-quiet">
            Back to the list
          </Link>
        }
      />

      <div className="space-y-5">
        {sp.error && (
          <p className="alert print:hidden">
            Not saved: {errorMessage(sp.error)}
          </p>
        )}

        <div className="print:hidden">
          <Card title="Where this meeting is">
            <p className="text-ink">
              {m.status === "planned" &&
                "Planned. Once it has been held, record who was there and how each decision went, then mark it as held."}
              {m.status === "held" &&
                "Held. A Manager who didn't record it checks the record and confirms it. Its carried decisions count only once confirmed."}
              {m.status === "confirmed" &&
                `Confirmed on ${formatDate(m.confirmed_at?.slice(0, 10))} and entered in the minute book as minute ${m.number}. ${m.quorum_met ? "A quorum was present." : "No quorum was present, so no decision was carried."}`}
              {m.status === "cancelled" && "Cancelled. It stays on record."}
            </p>
            {m.status !== "confirmed" && m.status !== "cancelled" && (
              <p className="mt-2 text-sm text-ink-2">
                Quorum: {quorumText(quorum)}
              </p>
            )}
            {ctx.canEdit && (
              <div className="mt-4 flex flex-wrap gap-3">
                {m.status === "planned" &&
                  m.meeting_on <= today &&
                  statusForm("held", "Record as held", "primary")}
                {m.status === "planned" &&
                  statusForm("cancelled", "Cancel the meeting")}
                {m.status === "held" &&
                  (ctx.canManage && !iChanged ? (
                    statusForm(
                      "confirmed",
                      "Confirm the record",
                      "primary",
                      "Confirming…",
                    )
                  ) : (
                    <p className="text-sm text-ink-3">
                      {ctx.canManage
                        ? "You recorded or changed this meeting, so another Manager confirms it."
                        : "A Manager who didn't record it confirms the record."}
                    </p>
                  ))}
                {m.status === "held" &&
                  statusForm("planned", "Back to planned")}
                {m.status === "cancelled" &&
                  statusForm("planned", "Plan it again")}
              </div>
            )}
          </Card>
        </div>

        <div className="print:hidden">
          <Card title="Details">
            {editable ? (
              <form
                action={updateMeeting.bind(null, familyId, meetingId)}
                className="space-y-4"
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Name of the meeting"
                    name="title"
                    defaultValue={m.title}
                    required
                  />
                  <Field
                    label="Date"
                    name="meeting_on"
                    type="date"
                    defaultValue={m.meeting_on}
                    required
                  />
                  <Field
                    label="Time"
                    name="starts_at"
                    type="time"
                    defaultValue={m.starts_at?.slice(0, 5)}
                  />
                  <Field
                    label="Place"
                    name="location"
                    defaultValue={m.location}
                  />
                  <Field
                    label="Video link"
                    name="video_link"
                    defaultValue={m.video_link}
                    hint="Starts with https://"
                  />
                </div>
                <TextArea
                  label="Agenda"
                  name="agenda"
                  defaultValue={m.agenda}
                />
                <SubmitButton>Save the details</SubmitButton>
              </form>
            ) : (
              <Facts
                items={[
                  ["Who met", body],
                  ["Date", formatDate(m.meeting_on)],
                  ["Time", m.starts_at?.slice(0, 5)],
                  ["Place", m.location],
                  ["Video link", m.video_link],
                  [
                    "Agenda",
                    m.agenda ? (
                      <span className="whitespace-pre-wrap">{m.agenda}</span>
                    ) : null,
                  ],
                ]}
              />
            )}
          </Card>
        </div>

        <div className="print:hidden">
          <Card
            title="Who attended"
            description="Those entitled to vote on the day, and anyone else in attendance (who can't vote)."
          >
            {attendees.length === 0 ? (
              <p className="border-y border-border py-3 text-ink-3">
                Nobody added yet.
              </p>
            ) : (
              <ul className="divide-y divide-border border-y border-border">
                {attendees.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div>
                      <p className="text-[15px] font-medium text-ink">
                        {nameOf(a)}
                        {a.represented_by
                          ? `, represented by ${a.represented_by}`
                          : ""}
                        {a.is_chair ? " (chair)" : ""}
                      </p>
                      <p className="text-sm text-ink-3">
                        {a.capacity === "voting"
                          ? "Entitled to vote"
                          : "In attendance, not voting"}{" "}
                        ·{" "}
                        {
                          {
                            present: "Present",
                            apologies: "Sent apologies",
                            absent: "Absent",
                          }[a.attendance]
                        }
                      </p>
                    </div>
                    {editable && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Fold label="Change">
                          <form
                            action={updateAttendee.bind(
                              null,
                              familyId,
                              meetingId,
                              a.id,
                            )}
                            className="space-y-3"
                          >
                            <Select
                              id={`attendance-${a.id}`}
                              label="Attendance"
                              name="attendance"
                              defaultValue={a.attendance}
                              options={
                                a.capacity === "voting"
                                  ? {
                                      present: "Present",
                                      apologies: "Sent apologies",
                                      absent: "Absent",
                                    }
                                  : { present: "Present" }
                              }
                            />
                            {!a.person_id && (
                              <Field
                                id={`rep-${a.id}`}
                                label="Represented by"
                                name="represented_by"
                                defaultValue={a.represented_by}
                              />
                            )}
                            <Checkbox
                              label="Chair of the meeting"
                              name="is_chair"
                              defaultChecked={a.is_chair}
                            />
                            <SubmitButton>Save</SubmitButton>
                          </form>
                        </Fold>
                        <ConfirmRemove
                          action={removeAttendee.bind(
                            null,
                            familyId,
                            meetingId,
                            a.id,
                          )}
                          what={`${nameOf(a)} from this meeting`}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {editable && (
              <div className="mt-4 space-y-2">
                {missingVoters.length > 0 && (
                  <form action={addAllVoters.bind(null, familyId, meetingId)}>
                    <SubmitButton variant="secondary" pendingText="Adding…">
                      Add everyone entitled to vote ({missingVoters.length})
                    </SubmitButton>
                  </form>
                )}
                {missingVoters.length > 0 && (
                  <Fold label="Add one person entitled to vote">
                    <form
                      action={addAttendee.bind(null, familyId, meetingId)}
                      className="space-y-3"
                    >
                      <input type="hidden" name="capacity" value="voting" />
                      <Select
                        id="voter"
                        label="Who"
                        name="who"
                        options={missingVoters.map(
                          (v) =>
                            [holderValue(v), nameOf(v)] as [string, string],
                        )}
                        required
                      />
                      <Select
                        id="voter-attendance"
                        label="Attendance"
                        name="attendance"
                        options={{
                          present: "Present",
                          apologies: "Sent apologies",
                          absent: "Absent",
                        }}
                      />
                      <Field
                        id="voter-rep"
                        label="Represented by (for a firm or entity)"
                        name="represented_by"
                      />
                      <SubmitButton>Add</SubmitButton>
                    </form>
                  </Fold>
                )}
                <Fold label="Add someone in attendance (not voting)">
                  <form
                    action={addAttendee.bind(null, familyId, meetingId)}
                    className="space-y-3"
                  >
                    <input
                      type="hidden"
                      name="capacity"
                      value="in_attendance"
                    />
                    <Select
                      id="guest"
                      label="Who"
                      name="who"
                      required
                      options={[
                        ...[...names.entries()]
                          .sort((a, b) => a[1].localeCompare(b[1]))
                          .map(
                            ([id, n]) =>
                              [`person:${id}`, n] as [string, string],
                          ),
                        ...[...orgs.entries()].map(
                          ([id, n]) =>
                            [`organisation:${id}`, n] as [string, string],
                        ),
                      ].filter(([v]) => !listed.has(v))}
                      hint="For example the company secretary or an adviser. Someone not in the Tree is added there first, as non-family."
                    />
                    <Field
                      id="guest-rep"
                      label="Represented by (for a firm)"
                      name="represented_by"
                    />
                    <SubmitButton>Add</SubmitButton>
                  </form>
                </Fold>
              </div>
            )}
          </Card>
        </div>

        <div className="print:hidden">
          <Card
            title="Decisions"
            description="Each item to be decided, with its wording. Once the meeting is held, record how each went."
          >
            {decisions.length === 0 ? (
              <p className="border-y border-border py-3 text-ink-3">
                No decisions yet.
              </p>
            ) : (
              <ul className="divide-y divide-border border-y border-border">
                {decisions.map((d) => (
                  <li key={d.id} className="space-y-2 py-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="text-[15px] font-semibold text-ink">
                        {d.item}. {d.title}
                      </h3>
                      <Chip>{OUTCOMES[d.outcome]}</Chip>
                      {d.passed_on && (
                        <span className="text-sm text-ink-3">
                          Counts from {formatDate(d.passed_on)}
                        </span>
                      )}
                    </div>
                    {d.background && (
                      <p className="whitespace-pre-wrap text-sm text-ink-2">
                        {d.background}
                      </p>
                    )}
                    <p className="whitespace-pre-wrap text-ink">{d.wording}</p>
                    {(d.votes_for !== null ||
                      d.votes_against !== null ||
                      d.abstentions !== null) && (
                      <p className="text-sm text-ink-3">
                        For {d.votes_for ?? 0} · Against {d.votes_against ?? 0}{" "}
                        · Abstained {d.abstentions ?? 0}
                      </p>
                    )}
                    {editable && (
                      <div className="flex flex-wrap items-start gap-3">
                        <Fold label="Record how it went">
                          <form
                            action={setOutcome.bind(
                              null,
                              familyId,
                              "meeting",
                              meetingId,
                              d.id,
                            )}
                            className="space-y-3"
                          >
                            <Select
                              id={`outcome-${d.id}`}
                              label="Outcome"
                              name="outcome"
                              defaultValue={d.outcome}
                              options={
                                m.status === "held"
                                  ? OUTCOMES
                                  : {
                                      proposed: "Proposed",
                                      withdrawn: "Withdrawn",
                                    }
                              }
                              hint={
                                m.status === "held"
                                  ? undefined
                                  : "Carried or not carried is recorded once the meeting is held."
                              }
                            />
                            <div className="grid gap-3 sm:grid-cols-3">
                              <Field
                                id={`for-${d.id}`}
                                label="For"
                                name="votes_for"
                                defaultValue={d.votes_for}
                              />
                              <Field
                                id={`against-${d.id}`}
                                label="Against"
                                name="votes_against"
                                defaultValue={d.votes_against}
                              />
                              <Field
                                id={`abst-${d.id}`}
                                label="Abstained"
                                name="abstentions"
                                defaultValue={d.abstentions}
                              />
                            </div>
                            <SubmitButton>Save the outcome</SubmitButton>
                          </form>
                        </Fold>
                        <Fold label="Change the wording">
                          <form
                            action={updateDecision.bind(
                              null,
                              familyId,
                              "meeting",
                              meetingId,
                              d.id,
                            )}
                            className="space-y-3"
                          >
                            <Field
                              id={`title-${d.id}`}
                              label="Title"
                              name="title"
                              defaultValue={d.title}
                              required
                            />
                            <TextArea
                              id={`bg-${d.id}`}
                              label="Background"
                              name="background"
                              defaultValue={d.background}
                            />
                            <TextArea
                              id={`wording-${d.id}`}
                              label="Wording"
                              name="wording"
                              defaultValue={d.wording}
                            />
                            <SubmitButton>Save</SubmitButton>
                          </form>
                        </Fold>
                        <ConfirmRemove
                          action={removeDecision.bind(
                            null,
                            familyId,
                            "meeting",
                            meetingId,
                            d.id,
                          )}
                          what={`item ${d.item}, "${d.title}"`}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {editable && (
              <Fold label="Add a decision">
                <form
                  action={addDecision.bind(
                    null,
                    familyId,
                    "meeting",
                    meetingId,
                  )}
                  className="space-y-3"
                >
                  <Field
                    label="Title"
                    name="title"
                    required
                    hint="e.g. Allotment of shares, Appointment of a director"
                  />
                  <TextArea
                    label="Background"
                    name="background"
                    hint="Why the decision is needed."
                  />
                  <TextArea
                    label="Wording"
                    name="wording"
                    hint={
                      'What was decided, e.g. "It was resolved that 1,000 Ordinary shares be allotted to …"'
                    }
                  />
                  <SubmitButton>Add the decision</SubmitButton>
                </form>
              </Fold>
            )}
          </Card>
        </div>

        {(m.status === "held" || m.status === "confirmed") && (
          <div className="print:hidden">
            <Card
              title="Minutes"
              description="Drafted after the meeting, circulated, then approved – usually signed by the chair of the next meeting."
            >
              <p className="mb-3 text-sm text-ink-2">
                Status: {MINUTES_STATUS[m.minutes_status]}
                {m.minutes_status === "approved" &&
                  ` on ${formatDate(m.minutes_approved_on)}${m.minutes_signed_by ? `, signed by ${names.get(m.minutes_signed_by) ?? "the chair"}` : ""}.`}
              </p>
              {ctx.canEdit && m.minutes_status !== "approved" && (
                <form
                  action={saveMinutes.bind(null, familyId, meetingId)}
                  className="space-y-3"
                >
                  <TextArea
                    label="Minutes"
                    name="minutes"
                    defaultValue={m.minutes}
                    rows={10}
                    hint="The discussion. Decisions and attendance are added to the printed minutes automatically."
                  />
                  <Select
                    label="Status"
                    name="minutes_status"
                    defaultValue={
                      m.minutes_status === "circulated" ? "circulated" : "draft"
                    }
                    options={{ draft: "Draft", circulated: "Circulated" }}
                  />
                  <SubmitButton>Save the minutes</SubmitButton>
                </form>
              )}
              {ctx.canEdit &&
                m.status === "confirmed" &&
                m.minutes_status !== "approved" && (
                  <Fold label="Record the minutes as approved and signed">
                    <form
                      action={approveMinutes.bind(null, familyId, meetingId)}
                      className="space-y-3"
                    >
                      <Field
                        label="Date approved"
                        name="minutes_approved_on"
                        type="date"
                        defaultValue={today}
                        required
                      />
                      <Select
                        label="Signed by"
                        name="minutes_signed_by"
                        includeBlank="Not recorded"
                        options={[...names.entries()].sort((a, b) =>
                          a[1].localeCompare(b[1]),
                        )}
                        hint="Usually the chair of the meeting at which they were approved."
                      />
                      <SubmitButton>Record as approved</SubmitButton>
                    </form>
                  </Fold>
                )}
              {m.status === "held" && (
                <p className="mt-3 text-sm text-ink-3">
                  Minutes are recorded as approved once the record is confirmed.
                </p>
              )}
            </Card>
          </div>
        )}

        {(m.status === "held" || m.status === "confirmed") && (
          <article className="rounded-xl border border-border bg-white p-6 sm:p-8 print:border-0 print:p-0">
            <style>
              {
                "@media print { @page { size: A4 portrait; margin: 16mm; } [data-page-title] { display: none; } }"
              }
            </style>
            <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm text-ink-3">
                  {m.number
                    ? `Minute ${m.number}`
                    : "Draft – not yet confirmed"}
                </p>
                <h2 className="text-2xl font-semibold text-ink">
                  Minutes of a meeting of the{" "}
                  {body.charAt(0).toLowerCase() + body.slice(1)}
                </h2>
                <p className="text-ink-2">
                  Held on {formatDate(m.meeting_on)}
                  {m.starts_at ? ` at ${m.starts_at.slice(0, 5)}` : ""}
                  {m.location ? ` (${m.location})` : ""}.
                </p>
              </div>
              <PrintButton />
            </header>
            <MinuteSection title="Present">
              {present
                .filter((a) => a.capacity === "voting")
                .map(
                  (a) =>
                    `${nameOf(a)}${a.represented_by ? ` (represented by ${a.represented_by})` : ""}${a.is_chair ? " – Chair" : ""}`,
                )
                .join("; ") || "—"}
            </MinuteSection>
            {present.some((a) => a.capacity === "in_attendance") && (
              <MinuteSection title="In attendance">
                {present
                  .filter((a) => a.capacity === "in_attendance")
                  .map((a) => nameOf(a))
                  .join("; ")}
              </MinuteSection>
            )}
            {attendees.some((a) => a.attendance === "apologies") && (
              <MinuteSection title="Apologies">
                {attendees
                  .filter((a) => a.attendance === "apologies")
                  .map((a) => nameOf(a))
                  .join("; ")}
              </MinuteSection>
            )}
            <MinuteSection title="Quorum">
              {m.status === "confirmed"
                ? m.quorum_met
                  ? "A quorum being present, the meeting proceeded."
                  : "No quorum was present. No business was transacted."
                : quorumText(quorum)}
            </MinuteSection>
            {decisions
              .filter((d) => d.outcome !== "withdrawn")
              .map((d) => (
                <section key={d.id} className="mb-4 break-inside-avoid">
                  <h3 className="font-semibold text-ink">
                    {d.item}. {d.title}
                  </h3>
                  {d.background && (
                    <p className="mt-1 whitespace-pre-wrap text-ink">
                      {d.background}
                    </p>
                  )}
                  <p className="mt-1 whitespace-pre-wrap text-ink">
                    {d.wording}
                  </p>
                  <p className="mt-1 text-sm text-ink-2">
                    {OUTCOMES[d.outcome]}.
                  </p>
                </section>
              ))}
            {m.minutes && (
              <MinuteSection title="Discussion">
                {<span className="whitespace-pre-wrap">{m.minutes}</span>}
              </MinuteSection>
            )}
            <div className="mt-10 grid gap-8 sm:grid-cols-2 print:grid-cols-2">
              <div className="border-t border-ink pt-2 text-sm text-ink">
                Chair{chair ? `: ${nameOf(chair)}` : ""}
                {m.minutes_signed_by
                  ? ` · Signed by ${names.get(m.minutes_signed_by) ?? ""}`
                  : ""}
              </div>
              <div className="border-t border-ink pt-2 text-sm text-ink">
                Date
                {m.minutes_approved_on
                  ? `: ${formatDate(m.minutes_approved_on)}`
                  : ""}
              </div>
            </div>
          </article>
        )}

        {!ctx.canEdit && (
          <Notice>Only Managers and Administrators can change meetings.</Notice>
        )}

        {ctx.canEdit && m.status !== "confirmed" && (
          <div className="print:hidden">
            <Card title="Remove this meeting">
              <Fold label="Remove the meeting" danger>
                <p className="text-sm text-ink-2">
                  Only for a meeting recorded in error. It is removed once
                  another Manager approves the request on the family Overview.
                </p>
                <form
                  action={removeMeeting.bind(null, familyId, meetingId)}
                  className="mt-3"
                >
                  <SubmitButton pendingText="Asking…">
                    Ask to remove this meeting
                  </SubmitButton>
                </form>
              </Fold>
            </Card>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function MinuteSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-4 grid gap-1 sm:grid-cols-[10rem_1fr] print:grid-cols-[10rem_1fr]">
      <h3 className="font-semibold text-ink">{title}</h3>
      <div className="text-ink">{children}</div>
    </section>
  );
}
