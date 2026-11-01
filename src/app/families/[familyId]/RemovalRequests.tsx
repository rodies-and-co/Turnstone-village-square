import { ConfirmRemove, SubmitButton } from "@/components/feedback";
import { Card, Chip, Field, Fold, Row, Rows } from "@/components/ui";
import type { FamilyContext } from "@/lib/family-context";
import { approveRemoval, rejectRemoval, withdrawRemoval } from "./removal-actions";

type Request = {
  id: string;
  summary: string;
  reason: string | null;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  requested_by: string;
  requested_at: string;
  decided_at: string | null;
  decision_note: string | null;
};

const when = (d: string) => new Date(d).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" });
const STATUS = { approved: "Removed", rejected: "Turned down", withdrawn: "Withdrawn", pending: "Waiting" } as const;

// Removals waiting for a second person, on the family Overview. Shown to
// Managers and Administrators (the database shows the requests to no one else).
export async function RemovalRequests({ ctx, familyId }: { ctx: FamilyContext; familyId: string }) {
  if (!ctx.db || !ctx.canEdit) return null;
  const columns = "id, summary, reason, status, requested_by, requested_at, decided_at, decision_note";
  const [{ data: pending }, { data: done }] = await Promise.all([
    ctx.db.from("removal_requests").select(columns).eq("status", "pending").order("requested_at"),
    ctx.db.from("removal_requests").select(columns).neq("status", "pending").order("decided_at", { ascending: false }).limit(10),
  ]);
  const waiting = (pending ?? []) as Request[];
  const recent = (done ?? []) as Request[];
  const me = ctx.user?.id ?? null;

  return (
    <div id="removals">
      <Card
        title="Removals waiting for approval"
        description="Nothing is removed by one person alone. Whoever asks can't approve: another Manager does. A copy of what was removed is kept."
      >
        {waiting.length === 0 ? (
          <p className="border-y border-border py-3 text-ink-3">Nothing is waiting.</p>
        ) : (
          <Rows>
            {waiting.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
                <div className="min-w-0">
                  <div className="text-[15px] font-medium text-ink">{r.summary}</div>
                  <div className="text-sm text-ink-3">
                    Asked {when(r.requested_at)}
                    {r.requested_by === me ? " by you" : ""}
                    {r.reason ? ` · ${r.reason}` : ""}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {ctx.canManage && r.requested_by !== me && (
                    <ConfirmRemove action={approveRemoval.bind(null, familyId, r.id)} what={r.summary} label="Approve and remove" asks={false} primary />
                  )}
                  {r.requested_by === me && (
                    <>
                      <p className="text-sm text-ink-3">You asked, so another Manager approves.</p>
                      <form action={withdrawRemoval.bind(null, familyId, r.id)}>
                        <SubmitButton variant="quiet" pendingText="Withdrawing…">
                          Withdraw
                        </SubmitButton>
                      </form>
                    </>
                  )}
                  {ctx.canManage && (
                    <Fold label="Turn down">
                      <form action={rejectRemoval.bind(null, familyId, r.id)} className="space-y-3">
                        <Field id={`note-${r.id}`} label="Why (optional)" name="note" />
                        <SubmitButton variant="secondary" pendingText="Saving…">
                          Turn down
                        </SubmitButton>
                      </form>
                    </Fold>
                  )}
                </div>
              </li>
            ))}
          </Rows>
        )}
        {recent.length > 0 && (
          <Fold label="Recently dealt with">
            <Rows>
              {recent.map((r) => (
                <Row
                  key={r.id}
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      <Chip>{STATUS[r.status]}</Chip> {r.summary}
                    </span>
                  }
                  meta={[r.decided_at ? when(r.decided_at) : null, r.decision_note].filter(Boolean).join(" · ")}
                />
              ))}
            </Rows>
          </Fold>
        )}
      </Card>
    </div>
  );
}
