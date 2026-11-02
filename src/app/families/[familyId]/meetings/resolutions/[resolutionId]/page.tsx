import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageTitle } from "@/components/AppShell";
import { ConfirmRemove, SubmitButton, Toast } from "@/components/feedback";
import { PrintButton } from "@/components/PrintButton";
import {
  Card,
  Chip,
  Facts,
  Field,
  Fold,
  Notice,
  Select,
} from "@/components/ui";
import { getFamilyContext } from "@/lib/family-context";
import { formatDate } from "@/lib/governance";
import { OUTCOMES, REQUIRED, RESOLUTION_STATUS } from "@/lib/meetings";
import { errorMessage, savedMessage } from "@/lib/messages";
import { displayNames, type PersonSummary } from "@/lib/people";
import {
  addAllSignatories,
  addDecision,
  addSignatory,
  recordSignature,
  removeDecision,
  removeResolution,
  removeSignatory,
  setOutcome,
  setResolutionStatus,
  updateDecision,
  updateResolution,
} from "../../actions";
import { TextArea } from "../../DecisionsArea";
import {
  loadBodies,
  type Decision,
  type Resolution,
} from "../../meetings-data";

export const dynamic = "force-dynamic";

type Signatory = {
  id: string;
  person_id: string | null;
  organisation_id: string | null;
  holder_entity_id: string | null;
  signed_for_by: string | null;
  votes: number | string;
  signed_on: string | null;
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

export default async function ResolutionPage({
  params,
  searchParams,
}: {
  params: Promise<{ familyId: string; resolutionId: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { familyId, resolutionId } = await params;
  const sp = await searchParams;
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db) notFound();
  const db = ctx.db;
  const { data: row } = await db
    .from("written_resolutions")
    .select("*")
    .eq("id", resolutionId)
    .maybeSingle();
  if (!row) notFound();
  const r = row as Resolution;
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Europe/London",
  });

  const [
    { data: sig },
    { data: dec },
    { data: peopleRows },
    { data: orgRows },
    { data: entRows },
    voters,
    bodies,
  ] = await Promise.all([
    db
      .from("resolution_signatories")
      .select("*")
      .eq("resolution_id", resolutionId)
      .order("created_at"),
    db
      .from("decisions")
      .select("*")
      .eq("resolution_id", resolutionId)
      .order("item"),
    db
      .from("people")
      .select("id, full_names, surname, known_as, birth_year")
      .order("surname"),
    db.from("outside_organisations").select("id, name").order("name"),
    db.from("entities").select("id, name").order("name"),
    ctx.canEdit && r.status === "draft"
      ? db
          .rpc("body_voters", {
            p_body: r.body,
            p_entity: r.entity_id,
            p_gov: r.governance_body_id,
            p_on: today,
          })
          .then((x) => (x.data ?? []) as H[])
      : Promise.resolve([] as H[]),
    loadBodies(ctx),
  ]);
  const signatories = (sig ?? []) as Signatory[];
  const decisions = (dec ?? []) as Decision[];
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
  const body = bodies.label(r.body, r.entity_id, r.governance_body_id);
  const draft = ctx.canEdit && r.status === "draft";
  const circulated = r.status === "circulated";
  const me = ctx.user?.id ?? "";
  const iChanged = r.prepared_by === me || r.edited_by.includes(me);
  const listed = new Set(signatories.map(holderValue));
  const missing = voters.filter((v) => !listed.has(holderValue(v)));
  const totalVotes = signatories.reduce((n, s) => n + Number(s.votes), 0);
  const signedVotes = signatories
    .filter((s) => s.signed_on)
    .reduce((n, s) => n + Number(s.votes), 0);
  const weighted = r.body === "members";
  const familyName = /family$/i.test(ctx.family.name.trim())
    ? ctx.family.name
    : `${ctx.family.name} family`;
  const listHref = r.entity_id
    ? `/families/${familyId}/organisation/${r.entity_id}?tab=decisions&view=resolutions`
    : `/families/${familyId}/meetings?view=resolutions&who=${encodeURIComponent(`governance:${r.governance_body_id}`)}`;
  const statusForm = (
    status: string,
    text: string,
    variant: "primary" | "secondary" = "secondary",
    withDate = false,
  ) => (
    <form
      action={setResolutionStatus.bind(
        null,
        familyId,
        resolutionId,
        status,
        r.updated_at,
      )}
      className="flex flex-wrap items-end gap-3"
    >
      {withDate && (
        <Field
          label="Date circulated"
          name="circulated_on"
          type="date"
          defaultValue={today}
        />
      )}
      <SubmitButton variant={variant}>{text}</SubmitButton>
    </form>
  );

  return (
    <AppShell
      family={{ id: familyId, name: ctx.family.name }}
      section="meetings"
      crumbs={[
        ["My families", "/"],
        [familyName, `/families/${familyId}`],
        [
          "Meetings & resolutions",
          `/families/${familyId}/meetings?view=resolutions`,
        ],
        [r.title],
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
        eyebrow={`Written resolution · ${body}`}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {r.title}
            <Chip>{RESOLUTION_STATUS[r.status]}</Chip>
          </span>
        }
        subtitle={[
          r.number ? `Resolution ${r.number}` : null,
          r.circulated_on ? `Circulated ${formatDate(r.circulated_on)}` : null,
          r.passed_on ? `Passed ${formatDate(r.passed_on)}` : null,
          `Needs: ${REQUIRED[r.required].toLowerCase()}`,
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
          <Card title="Where this resolution is">
            <p className="text-ink">
              {r.status === "draft" &&
                "Draft. Add its decisions and everyone entitled to vote, then circulate it for signature."}
              {circulated &&
                // Only editors see every signatory; a Viewer may not, so no totals for them.
                (ctx.canEdit
                  ? `Circulated for signature. ${signatories.filter((s) => s.signed_on).length} of ${signatories.length} have signed${weighted ? ` (${signedVotes.toLocaleString("en-GB")} of ${totalVotes.toLocaleString("en-GB")} votes)` : ""}. Once enough have signed, a Manager who didn't prepare it or record signatures confirms it passed.`
                  : "Circulated for signature. Once enough have signed, a Manager confirms it has passed. People you can't see in the Tree aren't listed below.")}
              {r.status === "passed" &&
                `Passed on ${formatDate(r.passed_on)}, the date the last signature needed was given. Entered in the register as resolution ${r.number}.`}
              {r.status === "lapsed" &&
                "Lapsed: it didn't get the signatures it needed. It stays on record."}
            </p>
            {ctx.canEdit && (
              <div className="mt-4 flex flex-wrap items-end gap-3">
                {r.status === "draft" &&
                  statusForm(
                    "circulated",
                    "Circulate for signature",
                    "primary",
                    true,
                  )}
                {circulated &&
                  (ctx.canManage && !iChanged ? (
                    statusForm("passed", "Confirm it has passed", "primary")
                  ) : (
                    <p className="text-sm text-ink-3">
                      {ctx.canManage
                        ? "You prepared this or recorded signatures, so another Manager confirms it."
                        : "A Manager who didn't prepare it confirms it has passed."}
                    </p>
                  ))}
                {circulated &&
                  signatories.every((s) => !s.signed_on) &&
                  statusForm("draft", "Back to draft")}
                {circulated && statusForm("lapsed", "Mark as lapsed")}
              </div>
            )}
          </Card>
        </div>

        <div className="print:hidden">
          <Card title="Details">
            {draft ? (
              <form
                action={updateResolution.bind(null, familyId, resolutionId)}
                className="space-y-4"
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Title"
                    name="title"
                    defaultValue={r.title}
                    required
                  />
                  {r.body !== "board" && (
                    <Select
                      label="How many must sign"
                      name="required"
                      options={REQUIRED}
                      defaultValue={r.required}
                    />
                  )}
                </div>
                <TextArea
                  label="Background"
                  name="background"
                  defaultValue={r.background}
                />
                <SubmitButton>Save</SubmitButton>
              </form>
            ) : (
              <Facts
                items={[
                  ["Whose", body],
                  ["Signatures needed", REQUIRED[r.required]],
                  [
                    "Background",
                    r.background ? (
                      <span className="whitespace-pre-wrap">
                        {r.background}
                      </span>
                    ) : null,
                  ],
                ]}
              />
            )}
          </Card>
        </div>

        <div className="print:hidden">
          <Card
            title="Decisions"
            description="What is resolved. The wording is fixed once the resolution is circulated."
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
                    </div>
                    {d.background && (
                      <p className="whitespace-pre-wrap text-sm text-ink-2">
                        {d.background}
                      </p>
                    )}
                    <p className="whitespace-pre-wrap text-ink">{d.wording}</p>
                    {draft && (
                      <div className="flex flex-wrap items-start gap-3">
                        <Fold label="Change the wording">
                          <form
                            action={updateDecision.bind(
                              null,
                              familyId,
                              "resolution",
                              resolutionId,
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
                        {d.outcome === "proposed" ? (
                          <form
                            action={setOutcome.bind(
                              null,
                              familyId,
                              "resolution",
                              resolutionId,
                              d.id,
                            )}
                          >
                            <input
                              type="hidden"
                              name="outcome"
                              value="withdrawn"
                            />
                            <SubmitButton variant="quiet">
                              Withdraw
                            </SubmitButton>
                          </form>
                        ) : (
                          <form
                            action={setOutcome.bind(
                              null,
                              familyId,
                              "resolution",
                              resolutionId,
                              d.id,
                            )}
                          >
                            <input
                              type="hidden"
                              name="outcome"
                              value="proposed"
                            />
                            <SubmitButton variant="quiet">
                              Put it back
                            </SubmitButton>
                          </form>
                        )}
                        <ConfirmRemove
                          action={removeDecision.bind(
                            null,
                            familyId,
                            "resolution",
                            resolutionId,
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
            {draft && (
              <Fold label="Add a decision">
                <form
                  action={addDecision.bind(
                    null,
                    familyId,
                    "resolution",
                    resolutionId,
                  )}
                  className="space-y-3"
                >
                  <Field
                    label="Title"
                    name="title"
                    required
                    hint="e.g. Transfer of shares"
                  />
                  <TextArea label="Background" name="background" />
                  <TextArea
                    label="Wording"
                    name="wording"
                    hint={
                      'What is resolved, e.g. "That the transfer of 5,000 Ordinary shares … be approved."'
                    }
                  />
                  <SubmitButton>Add the decision</SubmitButton>
                </form>
              </Fold>
            )}
          </Card>
        </div>

        <div className="print:hidden">
          <Card
            title="Who must sign"
            description={
              r.body === "members"
                ? "Every member entitled to vote. Each has as many votes as voting shares on the day it is circulated."
                : "Everyone entitled to vote on the day it is circulated."
            }
          >
            {signatories.length === 0 ? (
              <p className="border-y border-border py-3 text-ink-3">
                Nobody added yet.
              </p>
            ) : (
              <ul className="divide-y divide-border border-y border-border">
                {signatories.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div>
                      <p className="text-[15px] font-medium text-ink">
                        {nameOf(s)}
                        {s.signed_for_by
                          ? `, signed by ${s.signed_for_by}`
                          : ""}
                      </p>
                      <p className="text-sm text-ink-3">
                        {s.signed_on
                          ? `Signed ${formatDate(s.signed_on)}`
                          : r.status === "draft"
                            ? "Not yet circulated"
                            : "Not signed"}
                        {weighted && r.status !== "draft"
                          ? ` · ${Number(s.votes).toLocaleString("en-GB")} votes`
                          : ""}
                      </p>
                    </div>
                    {ctx.canEdit && circulated && (
                      <Fold
                        label={
                          s.signed_on
                            ? "Change the signature"
                            : "Record the signature"
                        }
                      >
                        <form
                          action={recordSignature.bind(
                            null,
                            familyId,
                            resolutionId,
                            s.id,
                          )}
                          className="space-y-3"
                        >
                          <Field
                            id={`signed-${s.id}`}
                            label="Date signed"
                            name="signed_on"
                            type="date"
                            defaultValue={s.signed_on ?? today}
                            hint="Leave empty to clear a signature recorded in error."
                          />
                          {!s.person_id && (
                            <Field
                              id={`for-${s.id}`}
                              label="Signed for them by"
                              name="signed_for_by"
                              defaultValue={s.signed_for_by}
                            />
                          )}
                          <SubmitButton>Save</SubmitButton>
                        </form>
                      </Fold>
                    )}
                    {draft && (
                      <ConfirmRemove
                        action={removeSignatory.bind(
                          null,
                          familyId,
                          resolutionId,
                          s.id,
                        )}
                        what={`${nameOf(s)} from the signatories`}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
            {draft && missing.length > 0 && (
              <div className="mt-4 space-y-2">
                <form
                  action={addAllSignatories.bind(null, familyId, resolutionId)}
                >
                  <SubmitButton variant="secondary" pendingText="Adding…">
                    Add everyone entitled to vote ({missing.length})
                  </SubmitButton>
                </form>
                <Fold label="Add one person">
                  <form
                    action={addSignatory.bind(null, familyId, resolutionId)}
                    className="space-y-3"
                  >
                    <Select
                      label="Who"
                      name="who"
                      options={missing.map(
                        (v) => [holderValue(v), nameOf(v)] as [string, string],
                      )}
                      required
                    />
                    <SubmitButton>Add</SubmitButton>
                  </form>
                </Fold>
              </div>
            )}
          </Card>
        </div>

        <article className="rounded-xl border border-border bg-white p-6 sm:p-8 print:border-0 print:p-0">
          <style>
            {
              "@media print { @page { size: A4 portrait; margin: 16mm; } [data-page-title] { display: none; } }"
            }
          </style>
          <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm text-ink-3">
                {r.number
                  ? `Resolution ${r.number}`
                  : r.status === "draft"
                    ? "Draft"
                    : "Not yet passed"}
              </p>
              <h2 className="text-2xl font-semibold text-ink">
                Written resolution of the{" "}
                {body.charAt(0).toLowerCase() + body.slice(1)}
              </h2>
              {r.circulated_on && (
                <p className="text-ink-2">
                  Circulated on {formatDate(r.circulated_on)}.
                </p>
              )}
            </div>
            <PrintButton />
          </header>
          {r.background && (
            <section className="mb-4">
              <h3 className="font-semibold text-ink">Background</h3>
              <p className="mt-1 whitespace-pre-wrap text-ink">
                {r.background}
              </p>
            </section>
          )}
          <h3 className="mb-2 font-semibold text-ink">It is resolved</h3>
          <ol className="mb-6 list-decimal space-y-3 pl-6">
            {decisions
              .filter((d) => d.outcome !== "withdrawn")
              .map((d) => (
                <li key={d.id} className="text-ink">
                  <span className="font-medium">{d.title}. </span>
                  <span className="whitespace-pre-wrap">{d.wording}</span>
                </li>
              ))}
          </ol>
          <p className="mb-6 text-sm text-ink-2">
            Signed by {REQUIRED[r.required].toLowerCase()}. It takes effect on
            the date the last signature needed is given.
          </p>
          <div className="grid gap-8 sm:grid-cols-2 print:grid-cols-2">
            {signatories.map((s) => (
              <div
                key={s.id}
                className="break-inside-avoid border-t border-ink pt-2 text-sm text-ink"
              >
                <p className="font-medium">{nameOf(s)}</p>
                {s.signed_for_by && <p>Signed by {s.signed_for_by}</p>}
                <p>Date: {s.signed_on ? formatDate(s.signed_on) : ""}</p>
              </div>
            ))}
          </div>
        </article>

        {!ctx.canEdit && (
          <Notice>
            Only Managers and Administrators can change resolutions.
          </Notice>
        )}

        {ctx.canEdit && r.status === "draft" && (
          <div className="print:hidden">
            <Card title="Remove this resolution">
              <Fold label="Remove the draft" danger>
                <p className="text-sm text-ink-2">
                  It is removed once another Manager approves the request on the
                  family Overview.
                </p>
                <form
                  action={removeResolution.bind(null, familyId, resolutionId)}
                  className="mt-3"
                >
                  <SubmitButton pendingText="Asking…">
                    Ask to remove this draft
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
