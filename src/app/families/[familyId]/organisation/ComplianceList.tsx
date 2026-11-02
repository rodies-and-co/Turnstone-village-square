import Link from "next/link";
import { ConfirmRemove, SubmitButton } from "@/components/feedback";
import { Card, Chip, Field, Fold, Notice } from "@/components/ui";
import { STATUS_LABELS, describeRule, shortDate, type CalendarItem } from "@/lib/compliance";
import { recordFiling, removeFiling } from "./compliance-actions";
import type { EntityCalendar } from "./compliance-data";

const GROUPS = [
  ["overdue", "Overdue", "Past the due date and not recorded as filed."],
  ["due_soon", "Due in the next 60 days", null],
  ["upcoming", "Later", "Up to 15 months ahead."],
  ["done", "Done", "Filed, or recorded as not applicable, over the last year."],
] as const;

type Row = CalendarItem & { entityId: string; entityName: string };

function itemKey(r: Row) {
  return `${r.entityId}-${r.obligation.key}-${r.due}-${r.event?.key ?? ""}`;
}

// One filing or notice, with what to do about it.
function Item({ r, familyId, canEdit, back, showEntity }: { r: Row; familyId: string; canEdit: boolean; back: string; showEntity: boolean }) {
  const id = itemKey(r).replace(/[^a-zA-Z0-9-]/g, "");
  const done = r.status === "filed" || r.status === "not_applicable";
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[15px] font-medium text-ink">
            <Chip>{STATUS_LABELS[r.status]}</Chip>
            {r.obligation.name}
            {r.obligation.to_confirm && <span className="text-sm font-normal text-ink-3">(rule to confirm)</span>}
          </div>
          <div className="text-sm text-ink-2">
            {showEntity && (
              <>
                <Link href={`/families/${familyId}/organisation/${r.entityId}?tab=compliance`} className="underline decoration-border underline-offset-4 hover:decoration-ink">
                  {r.entityName}
                </Link>
                {" · "}
              </>
            )}
            Due {shortDate(r.due)}
            {r.period ? ` · ${r.period}` : ""}
            {r.event ? ` · after: ${r.event.label} (${shortDate(r.event.date)})` : ""}
            {r.obligation.authority ? ` · ${r.obligation.authority}` : ""}
          </div>
          <div className="text-xs text-ink-3">
            {describeRule(r.obligation)}
            {r.obligation.notes ? `. ${r.obligation.notes}` : ""}
          </div>
          {r.filing && (
            <div className="mt-1 text-sm text-ink">
              {r.filing.status === "filed" ? `Filed ${shortDate(r.filing.done_on!)}` : "Not applicable"}
              {r.filing.reference ? ` · ref. ${r.filing.reference}` : ""}
            </div>
          )}
        </div>
        {canEdit && r.filing && (
          <ConfirmRemove action={removeFiling.bind(null, familyId, r.entityId, r.filing.id, back)} what={`the record for ${r.obligation.name}`} />
        )}
      </div>
      {canEdit && (
        <Fold label={done ? "Change what was recorded" : "Record it"}>
          <form action={recordFiling.bind(null, familyId, r.entityId)} className="space-y-4">
            <input type="hidden" name="back" value={back} />
            <input type="hidden" name="obligation_key" value={r.obligation.key} />
            <input type="hidden" name="obligation_name" value={r.obligation.name} />
            <input type="hidden" name="due_date" value={r.due} />
            <input type="hidden" name="event_key" value={r.event?.key ?? ""} />
            <input type="hidden" name="filing_id" value={r.filing?.id ?? ""} />
            <fieldset>
              <legend className="mb-1 text-sm font-medium text-ink">What happened</legend>
              <div className="flex flex-wrap gap-x-6">
                <label className="flex min-h-11 items-center gap-2 text-ink">
                  <input type="radio" name="status" value="filed" defaultChecked={r.filing?.status !== "not_applicable"} className="h-5 w-5" />
                  Filed or done
                </label>
                <label className="flex min-h-11 items-center gap-2 text-ink">
                  <input type="radio" name="status" value="not_applicable" defaultChecked={r.filing?.status === "not_applicable"} className="h-5 w-5" />
                  Doesn&apos;t apply
                </label>
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field id={`done-${id}`} label="Date filed" name="done_on" type="date" defaultValue={r.filing?.done_on} />
              <Field id={`ref-${id}`} label="Reference" name="reference" defaultValue={r.filing?.reference} />
              <Field id={`notes-${id}`} label="Notes (why, if it doesn't apply)" name="notes" />
            </div>
            <SubmitButton>Save</SubmitButton>
          </form>
        </Fold>
      )}
    </li>
  );
}

// The compliance calendar: one entity, or every entity of the family.
export function ComplianceList({
  calendars,
  familyId,
  canEdit,
  back,
  showEntity,
}: {
  calendars: EntityCalendar[];
  familyId: string;
  canEdit: boolean;
  back: string;
  showEntity: boolean;
}) {
  const rows: Row[] = calendars.flatMap((c) => c.items.map((i) => ({ ...i, entityId: c.entityId, entityName: c.entityName })));
  const problems = calendars.flatMap((c) => c.problems.map((p) => ({ ...p, entityId: c.entityId, entityName: c.entityName })));
  const noStandard = calendars.filter((c) => !c.standardName);
  const drafts = calendars.filter((c) => c.standardDraft);
  const doneSince = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  return (
    <>
      {(problems.length > 0 || noStandard.length > 0 || drafts.length > 0) && (
        <Card title="Can't be worked out yet" description="Some dates can't be worked out until a detail is recorded, or the rules are approved.">
          <ul className="space-y-2 text-ink">
            {problems.map((p) => (
              <li key={`${p.entityId}-${p.obligation.key}`}>
                {showEntity ? <strong className="font-medium">{p.entityName}: </strong> : null}
                {p.obligation.name}: {p.reason}
              </li>
            ))}
            {noStandard.map((c) => (
              <li key={`ns-${c.entityId}`}>
                {showEntity ? <strong className="font-medium">{c.entityName}: </strong> : null}No Entity Standard matches, so no filings are known.
              </li>
            ))}
            {drafts.map((c) => (
              <li key={`d-${c.entityId}`}>
                {showEntity ? <strong className="font-medium">{c.entityName}: </strong> : null}The rules ({c.standardName}) are still a draft, so these dates may change.
              </li>
            ))}
          </ul>
        </Card>
      )}
      {GROUPS.map(([status, title, description]) => {
        const list =
          status === "done"
            ? rows.filter((r) => (r.status === "filed" || r.status === "not_applicable") && r.due >= doneSince).reverse()
            : rows.filter((r) => r.status === status);
        if (status !== "due_soon" && status !== "overdue" && list.length === 0) return null;
        return (
          <Card key={status} title={`${title} (${list.length})`} description={description ?? undefined}>
            {list.length === 0 ? (
              <p className="border-y border-border py-3 text-ink-3">{status === "overdue" ? "Nothing is overdue." : "Nothing is due in the next 60 days."}</p>
            ) : (
              <ul className="divide-y divide-border border-y border-border">
                {list.map((r) => (
                  <Item key={itemKey(r)} r={r} familyId={familyId} canEdit={canEdit} back={back} showEntity={showEntity} />
                ))}
              </ul>
            )}
          </Card>
        );
      })}
      {rows.length === 0 && problems.length === 0 && <Notice>No filings are due in the next 15 months.</Notice>}
    </>
  );
}
