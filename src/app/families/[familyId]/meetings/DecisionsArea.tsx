import Link from "next/link";
import type { ReactNode } from "react";
import { ConfirmRemove, SubmitButton } from "@/components/feedback";
import { PrintButton } from "@/components/PrintButton";
import {
  Card,
  Checkbox,
  Chip,
  Field,
  Fold,
  Rows,
  Row,
  Select,
} from "@/components/ui";
import type { FamilyContext } from "@/lib/family-context";
import { formatDate } from "@/lib/governance";
import {
  MEETING_STATUS,
  MINUTES_STATUS,
  NOTE_KINDS,
  OUTCOMES,
  REQUIRED,
  RESOLUTION_STATUS,
} from "@/lib/meetings";
import {
  createMeeting,
  createNote,
  createResolution,
  removeNote,
  updateNote,
} from "./actions";
import { loadBodies, loadRecords, refFor, type Scope } from "./meetings-data";

// Meetings, written resolutions, file notes and the three registers (the
// minute book, the register of written resolutions and the decisions
// register), for the whole family, one entity or one governance body.

export const VIEWS = [
  ["meetings", "Meetings"],
  ["resolutions", "Written resolutions"],
  ["notes", "File notes"],
  ["registers", "Registers"],
] as const;
export type View = (typeof VIEWS)[number][0];

export function TextArea({
  label,
  name,
  defaultValue,
  rows = 4,
  hint,
  id,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  rows?: number;
  hint?: string;
  id?: string;
}) {
  return (
    <div>
      <label
        htmlFor={id ?? name}
        className="mb-1 block text-sm font-medium text-ink"
      >
        {label}
      </label>
      <textarea
        id={id ?? name}
        name={name}
        rows={rows}
        defaultValue={defaultValue ?? ""}
        className="text-area"
      />
      {hint && <p className="mt-1 text-xs text-ink-3">{hint}</p>}
    </div>
  );
}

function Sub({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-6 break-inside-avoid">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-3">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Table({
  head,
  rows,
  empty,
}: {
  head: string[];
  rows: ReactNode[][];
  empty: string;
}) {
  if (rows.length === 0)
    return <p className="border-y border-border py-3 text-ink-3">{empty}</p>;
  return (
    <div className="overflow-x-auto print:overflow-visible">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-ink">
            {head.map((h) => (
              <th
                key={h}
                scope="col"
                className="py-1.5 pr-4 text-left font-semibold text-ink"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border">
              {r.map((c, j) => (
                <td key={j} className="py-1.5 pr-4 align-top text-ink">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export async function DecisionsArea({
  ctx,
  familyId,
  scope,
  view,
  here,
  names,
}: {
  ctx: FamilyContext;
  familyId: string;
  scope: Scope;
  view: View;
  // This page's address, without the view (e.g. ".../organisation/<id>?tab=decisions").
  here: string;
  names: Map<string, string>;
}) {
  const { label, choices, entities, bodies } = await loadBodies(ctx);
  const { meetings, resolutions, decisions, notes } = await loadRecords(
    ctx,
    scope,
  );
  const sep = here.includes("?") ? "&" : "?";
  const viewHref = (v: View) => `${here}${sep}view=${v}`;
  const back = viewHref(view);
  const whoChoices = choices(scope);
  const single = Boolean(scope.entityId || scope.govId);
  const bodyOf = (r: {
    body: "board" | "members" | "governance";
    entity_id: string | null;
    governance_body_id: string | null;
  }) => label(r.body, r.entity_id, r.governance_body_id);
  const meetingHref = (id: string) => `/families/${familyId}/meetings/${id}`;
  const resolutionHref = (id: string) =>
    `/families/${familyId}/meetings/resolutions/${id}`;
  const { data: branchRows } = await ctx
    .db!.from("branches")
    .select("id, name")
    .order("name");
  const branches = (branchRows ?? []) as { id: string; name: string }[];

  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Europe/London",
  });
  const upcoming = meetings
    .filter((m) => m.status === "planned" && m.meeting_on >= today)
    .reverse();
  const toConfirm = meetings.filter((m) => m.status === "held");
  const others = meetings.filter(
    (m) => !upcoming.includes(m) && !toConfirm.includes(m),
  );

  const meetingRow = (m: (typeof meetings)[number]) => (
    <Row
      key={m.id}
      title={
        <Link href={meetingHref(m.id)} className="hover:underline">
          {m.title}
          {m.number ? ` (Minute ${m.number})` : ""}
        </Link>
      }
      meta={[
        formatDate(m.meeting_on),
        single ? null : bodyOf(m),
        m.status === "confirmed"
          ? `Minutes: ${MINUTES_STATUS[m.minutes_status].toLowerCase()}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")}
    >
      <Chip>{MEETING_STATUS[m.status]}</Chip>
    </Row>
  );

  return (
    <div className="space-y-5">
      <nav aria-label="Decisions and notes" className="print:hidden">
        <ul className="flex flex-wrap gap-2">
          {VIEWS.map(([v, t]) => (
            <li key={v}>
              <Link
                href={viewHref(v)}
                aria-current={v === view ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm ${v === view ? "border-ink bg-ink text-white" : "border-border bg-card text-ink hover:border-ink"}`}
              >
                {t}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {view === "meetings" && (
        <>
          {ctx.canEdit && whoChoices.length > 0 && (
            <Card
              title="Plan or record a meeting"
              description="Plan a meeting ahead, or record one that has already been held. Attendance and decisions are added on the meeting's own page."
            >
              <Fold label="Add a meeting">
                <form
                  action={createMeeting.bind(null, familyId, back)}
                  className="space-y-4"
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Select
                      label="Who is meeting"
                      name="body"
                      options={whoChoices}
                      required
                    />
                    <Field
                      label="Name of the meeting"
                      name="title"
                      required
                      defaultValue="Board meeting"
                    />
                    <Field
                      label="Date"
                      name="meeting_on"
                      type="date"
                      required
                    />
                    <Field label="Time" name="starts_at" type="time" />
                    <Field label="Place" name="location" />
                    <Field
                      label="Video link"
                      name="video_link"
                      hint="Starts with https://"
                    />
                  </div>
                  <TextArea
                    label="Agenda"
                    name="agenda"
                    hint="What will be discussed. Sent out before the meeting with the board pack."
                  />
                  <Checkbox
                    label="Already held (record a past meeting)"
                    name="already_held"
                  />
                  <SubmitButton>Add the meeting</SubmitButton>
                </form>
              </Fold>
            </Card>
          )}
          {toConfirm.length > 0 && (
            <Card
              title="Waiting to be confirmed"
              description="Held meetings whose record a Manager who didn't record it checks and confirms. Their decisions count once confirmed."
            >
              <Rows>{toConfirm.map(meetingRow)}</Rows>
            </Card>
          )}
          <Card title="Coming up">
            {upcoming.length ? (
              <Rows>{upcoming.map(meetingRow)}</Rows>
            ) : (
              <p className="border-y border-border py-3 text-ink-3">
                No meetings planned.
              </p>
            )}
          </Card>
          <Card title="Past and cancelled meetings">
            {others.length ? (
              <Rows>{others.map(meetingRow)}</Rows>
            ) : (
              <p className="border-y border-border py-3 text-ink-3">
                None yet.
              </p>
            )}
          </Card>
        </>
      )}

      {view === "resolutions" && (
        <>
          {ctx.canEdit && whoChoices.length > 0 && (
            <Card
              title="Draft a written resolution"
              description="Decided without a meeting: everyone entitled to vote is asked to sign. A board resolution needs every member of the board."
            >
              <Fold label="Draft a resolution">
                <form
                  action={createResolution.bind(null, familyId, back)}
                  className="space-y-4"
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Select
                      label="Whose resolution"
                      name="body"
                      options={whoChoices}
                      required
                    />
                    <Field label="Title" name="title" required />
                    <Select
                      label="How many must sign"
                      name="required"
                      options={REQUIRED}
                      defaultValue="all"
                      hint="Board resolutions always need everyone."
                    />
                  </div>
                  <TextArea
                    label="Background"
                    name="background"
                    hint="A short description of why the decision is needed."
                  />
                  <SubmitButton>Draft the resolution</SubmitButton>
                </form>
              </Fold>
            </Card>
          )}
          <Card title="Written resolutions">
            {resolutions.length ? (
              <Rows>
                {resolutions.map((r) => (
                  <Row
                    key={r.id}
                    title={
                      <Link
                        href={resolutionHref(r.id)}
                        className="hover:underline"
                      >
                        {r.title}
                        {r.number ? ` (Resolution ${r.number})` : ""}
                      </Link>
                    }
                    meta={[
                      r.passed_on
                        ? `Passed ${formatDate(r.passed_on)}`
                        : r.circulated_on
                          ? `Circulated ${formatDate(r.circulated_on)}`
                          : null,
                      single ? null : bodyOf(r),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  >
                    <Chip>{RESOLUTION_STATUS[r.status]}</Chip>
                  </Row>
                ))}
              </Rows>
            ) : (
              <p className="border-y border-border py-3 text-ink-3">
                None yet.
              </p>
            )}
          </Card>
        </>
      )}

      {view === "notes" && (
        <>
          {ctx.canEdit && (
            <Card
              title="Write a file note"
              description="A record of a call, a conversation or a fact. It needs no approval."
            >
              <Fold label="Write a note">
                <form
                  action={createNote.bind(null, familyId, back)}
                  className="space-y-4"
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Title" name="title" required />
                    <Select
                      label="Kind"
                      name="kind"
                      options={NOTE_KINDS}
                      defaultValue="phone_call"
                    />
                    <Field
                      label="Date"
                      name="noted_on"
                      type="date"
                      defaultValue={today}
                      required
                    />
                    <Field label="Time" name="noted_at" type="time" />
                    {single ? (
                      <input
                        type="hidden"
                        name="about"
                        value={
                          scope.entityId
                            ? `entity:${scope.entityId}`
                            : `governance:${scope.govId}`
                        }
                      />
                    ) : (
                      <Select
                        label="About"
                        name="about"
                        includeBlank="The whole family"
                        options={[
                          ...entities.map(
                            (e) =>
                              [`entity:${e.id}`, e.name] as [string, string],
                          ),
                          ...bodies.map(
                            (b) =>
                              [`governance:${b.id}`, b.name] as [
                                string,
                                string,
                              ],
                          ),
                          ...branches.map(
                            (b) =>
                              [`branch:${b.id}`, `${b.name} branch`] as [
                                string,
                                string,
                              ],
                          ),
                        ]}
                      />
                    )}
                  </div>
                  <TextArea label="Note" name="body" rows={6} />
                  <div>
                    <label
                      htmlFor="note-people"
                      className="mb-1 block text-sm font-medium text-ink"
                    >
                      People it is about
                    </label>
                    <select
                      id="note-people"
                      name="people"
                      multiple
                      size={Math.min(6, Math.max(3, names.size))}
                      className="text-input h-auto"
                    >
                      {[...names.entries()]
                        .sort((a, b) => a[1].localeCompare(b[1]))
                        .map(([id, n]) => (
                          <option key={id} value={id}>
                            {n}
                          </option>
                        ))}
                    </select>
                    <p className="mt-1 text-xs text-ink-3">
                      Optional. Hold Ctrl (or Cmd on a Mac) to choose more than
                      one.
                    </p>
                  </div>
                  <SubmitButton>Save the note</SubmitButton>
                </form>
              </Fold>
            </Card>
          )}
          <Card title="File notes">
            {notes.length ? (
              <ul className="divide-y divide-border border-y border-border">
                {notes.map((n) => (
                  <li key={n.id} className="py-3">
                    <details>
                      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
                        <span>
                          <span className="block text-[15px] font-medium text-ink">
                            {n.title}
                          </span>
                          <span className="block text-sm text-ink-3">
                            {[
                              formatDate(n.noted_on) +
                                (n.noted_at
                                  ? `, ${n.noted_at.slice(0, 5)}`
                                  : ""),
                              NOTE_KINDS[n.kind as keyof typeof NOTE_KINDS],
                              single
                                ? null
                                : n.entity_id
                                  ? entities.find((e) => e.id === n.entity_id)
                                      ?.name
                                  : n.governance_body_id
                                    ? bodies.find(
                                        (b) => b.id === n.governance_body_id,
                                      )?.name
                                    : n.branch_id
                                      ? `${branches.find((b) => b.id === n.branch_id)?.name ?? "A"} branch`
                                      : "The whole family",
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                        <span className="text-sm text-ink-2">Read</span>
                      </summary>
                      <div className="mt-2 space-y-3">
                        <p className="whitespace-pre-wrap text-ink">{n.body}</p>
                        {n.people.length > 0 && (
                          <p className="text-sm text-ink-3">
                            About:{" "}
                            {n.people
                              .map(
                                (p) => names.get(p) ?? "someone you can't see",
                              )
                              .join(", ")}
                          </p>
                        )}
                        {ctx.canEdit && (
                          <div className="flex flex-wrap items-start gap-3">
                            <Fold label="Correct the note">
                              <form
                                action={updateNote.bind(
                                  null,
                                  familyId,
                                  back,
                                  n.id,
                                )}
                                className="space-y-3"
                              >
                                <Field
                                  label="Title"
                                  name="title"
                                  id={`title-${n.id}`}
                                  defaultValue={n.title}
                                  required
                                />
                                <TextArea
                                  label="Note"
                                  name="body"
                                  id={`body-${n.id}`}
                                  defaultValue={n.body}
                                  rows={6}
                                />
                                <SubmitButton>Save</SubmitButton>
                              </form>
                            </Fold>
                            <ConfirmRemove
                              action={removeNote.bind(
                                null,
                                familyId,
                                back,
                                n.id,
                              )}
                              what={`the note "${n.title}"`}
                            />
                          </div>
                        )}
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="border-y border-border py-3 text-ink-3">
                No notes yet.
              </p>
            )}
          </Card>
        </>
      )}

      {view === "registers" && (
        <article className="rounded-xl border border-border bg-white p-6 sm:p-8 print:border-0 print:p-0">
          <style>
            {
              "@media print { @page { size: A4 landscape; margin: 12mm; } [data-page-title] { display: none; } }"
            }
          </style>
          <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold text-ink">
                Minute book and registers
              </h2>
              <p className="text-sm text-ink-3">
                As at {formatDate(today)}. Only confirmed meetings and passed
                resolutions are entered.
              </p>
            </div>
            <PrintButton />
          </header>
          <Sub title="Minute book">
            <Table
              head={
                single
                  ? ["Minute", "Date", "Meeting", "Quorum", "Minutes"]
                  : ["Minute", "Date", "Meeting", "Body", "Quorum", "Minutes"]
              }
              empty="No confirmed meetings yet."
              rows={meetings
                .filter((m) => m.status === "confirmed")
                .sort(
                  (a, b) =>
                    bodyOf(a).localeCompare(bodyOf(b)) ||
                    (a.number ?? 0) - (b.number ?? 0),
                )
                .map((m) => [
                  <Link
                    key="n"
                    href={meetingHref(m.id)}
                    className="underline decoration-border underline-offset-4 hover:decoration-ink"
                  >
                    {m.number}
                  </Link>,
                  formatDate(m.meeting_on),
                  m.title,
                  ...(single ? [] : [bodyOf(m)]),
                  m.quorum_met ? "Present" : "Not present",
                  m.minutes_status === "approved"
                    ? `Approved ${formatDate(m.minutes_approved_on)}${m.minutes_signed_by ? `, signed by ${names.get(m.minutes_signed_by) ?? "the chair"}` : ""}`
                    : MINUTES_STATUS[m.minutes_status],
                ])}
            />
          </Sub>
          <Sub title="Register of written resolutions">
            <Table
              head={
                single
                  ? ["Number", "Passed", "Title", "Signatures needed"]
                  : ["Number", "Passed", "Title", "Body", "Signatures needed"]
              }
              empty="No passed resolutions yet."
              rows={resolutions
                .filter((r) => r.status === "passed")
                .sort(
                  (a, b) =>
                    bodyOf(a).localeCompare(bodyOf(b)) ||
                    (a.number ?? 0) - (b.number ?? 0),
                )
                .map((r) => [
                  <Link
                    key="n"
                    href={resolutionHref(r.id)}
                    className="underline decoration-border underline-offset-4 hover:decoration-ink"
                  >
                    {r.number}
                  </Link>,
                  formatDate(r.passed_on),
                  r.title,
                  ...(single ? [] : [bodyOf(r)]),
                  REQUIRED[r.required],
                ])}
            />
          </Sub>
          <Sub title="Decisions register">
            <Table
              head={
                single
                  ? ["Date", "Reference", "Decision", "Outcome"]
                  : ["Date", "Reference", "Decision", "Body", "Outcome"]
              }
              empty="No decisions recorded yet."
              rows={decisions
                .filter((d) => {
                  const m = meetings.find((x) => x.id === d.meeting_id);
                  const r = resolutions.find((x) => x.id === d.resolution_id);
                  return m ? m.status === "confirmed" : r?.status === "passed";
                })
                .sort((a, b) => {
                  const date = (d: (typeof decisions)[number]) =>
                    d.passed_on ??
                    meetings.find((x) => x.id === d.meeting_id)?.meeting_on ??
                    "";
                  return date(a).localeCompare(date(b)) || a.item - b.item;
                })
                .map((d) => {
                  const parent =
                    meetings.find((x) => x.id === d.meeting_id) ??
                    resolutions.find((x) => x.id === d.resolution_id)!;
                  return [
                    formatDate(
                      d.passed_on ??
                        meetings.find((x) => x.id === d.meeting_id)?.meeting_on,
                    ),
                    refFor(d, meetings, resolutions),
                    <span key="t">
                      <span className="font-medium">{d.title}</span>
                      <span className="block text-ink-2">{d.wording}</span>
                    </span>,
                    ...(single ? [] : [bodyOf(parent)]),
                    OUTCOMES[d.outcome],
                  ];
                })}
            />
          </Sub>
        </article>
      )}
    </div>
  );
}
