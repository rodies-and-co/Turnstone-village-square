import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageTitle } from "@/components/AppShell";
import { ConfirmRemove, SubmitButton, Toast } from "@/components/feedback";
import {
  Card,
  Checkbox,
  Chip,
  Field,
  Fold,
  Notice,
  Select,
} from "@/components/ui";
import { getFamilyContext } from "@/lib/family-context";
import { formatDate } from "@/lib/governance";
import {
  DISTRIBUTION_FORMS,
  DIVIDEND_FORMS,
  DIVIDEND_KINDS,
  PAYOUT_STATUS,
  POOLS,
} from "@/lib/meetings";
import { errorMessage, savedMessage } from "@/lib/messages";
import { displayNames, type PersonSummary } from "@/lib/people";
import { decisionTargets } from "../meetings/draft";
import { loadRecords, refFor } from "../meetings/meetings-data";
import { TextArea } from "../meetings/DecisionsArea";
import {
  cancelPayout,
  payDistribution,
  payDividendAll,
  payDividendLine,
  recordDistribution,
  recordDividend,
  removePayout,
} from "./actions";

export const dynamic = "force-dynamic";

type Ent = {
  id: string;
  name: string;
  entity_type: string;
  base_currency: string | null;
};
type Distribution = {
  id: string;
  entity_id: string;
  beneficiary_id: string | null;
  class_member_id: string | null;
  pool: keyof typeof POOLS;
  currency: string;
  amount: string | number;
  form: keyof typeof DISTRIBUTION_FORMS;
  purpose: string | null;
  deed_clause: string | null;
  letter_of_wishes: boolean;
  decision_id: string | null;
  status: keyof typeof PAYOUT_STATUS;
  declared_on: string | null;
  paid_on: string | null;
  receipt_reference: string | null;
};
type Dividend = {
  id: string;
  entity_id: string;
  class_id: string;
  kind: keyof typeof DIVIDEND_KINDS;
  per_share: string | number;
  currency: string;
  record_date: string | null;
  payment_date: string | null;
  form: keyof typeof DIVIDEND_FORMS;
  decision_id: string | null;
  status: keyof typeof PAYOUT_STATUS;
  declared_on: string | null;
};
type Line = {
  id: string;
  dividend_id: string;
  person_id: string | null;
  organisation_id: string | null;
  holder_entity_id: string | null;
  shares: string | number;
  amount: string | number;
  paid_on: string | null;
  voucher: string | null;
};

const money = (currency: string, n: number | string) =>
  `${currency} ${Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Distributions (trusts and foundations) and dividends (companies): what is
// proposed, declared and paid. Each is decided by a meeting or written
// resolution; only declared ones are paid.
export default async function DistributionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ familyId: string }>;
  searchParams: Promise<{ entity?: string; saved?: string; error?: string }>;
}) {
  const { familyId } = await params;
  const sp = await searchParams;
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db) notFound();
  const db = ctx.db;

  const [
    { data: entRows },
    { data: dRows },
    { data: vRows },
    { data: lRows },
    { data: bRows },
    { data: mRows },
    { data: cRows },
    { data: classRows },
    { data: peopleRows },
    { data: orgRows },
  ] = await Promise.all([
    db
      .from("entities")
      .select("id, name, entity_type, base_currency")
      .order("name"),
    db
      .from("distributions")
      .select("*")
      .order("created_at", { ascending: false }),
    db.from("dividends").select("*").order("created_at", { ascending: false }),
    db
      .from("dividend_payments")
      .select("*")
      .order("shares", { ascending: false }),
    db
      .from("beneficiaries")
      .select(
        "id, entity_id, person_id, organisation_id, holder_entity_id, cause, ceased_on",
      ),
    db
      .from("beneficiary_class_members")
      .select("id, entity_id, class_id, person_id, ceased_on"),
    db.from("beneficiary_classes").select("id, name"),
    db.from("share_classes").select("id, entity_id, name, currency"),
    db
      .from("people")
      .select("id, full_names, surname, known_as, birth_year")
      .order("surname"),
    db.from("outside_organisations").select("id, name"),
  ]);
  const entities = (entRows ?? []) as Ent[];
  const trusts = entities.filter(
    (e) => e.entity_type === "trust" || e.entity_type === "foundation",
  );
  const companies = entities.filter(
    (e) => e.entity_type === "company" || e.entity_type === "llc",
  );
  const selected = entities.find(
    (e) => e.id === sp.entity && (trusts.includes(e) || companies.includes(e)),
  );
  const names = displayNames((peopleRows ?? []) as PersonSummary[]);
  const orgs = new Map(
    ((orgRows ?? []) as { id: string; name: string }[]).map((o) => [
      o.id,
      o.name,
    ]),
  );
  const entName = new Map(entities.map((e) => [e.id, e.name]));
  const classes = (classRows ?? []) as {
    id: string;
    entity_id: string;
    name: string;
    currency: string;
  }[];
  const bClasses = new Map(
    ((cRows ?? []) as { id: string; name: string }[]).map((c) => [
      c.id,
      c.name,
    ]),
  );
  type B = {
    id: string;
    entity_id: string;
    person_id: string | null;
    organisation_id: string | null;
    holder_entity_id: string | null;
    cause: string | null;
    ceased_on: string | null;
  };
  type M = {
    id: string;
    entity_id: string;
    class_id: string;
    person_id: string;
    ceased_on: string | null;
  };
  const beneficiaries = (bRows ?? []) as B[];
  const members = (mRows ?? []) as M[];
  const holder = (h: {
    person_id: string | null;
    organisation_id: string | null;
    holder_entity_id: string | null;
  }) =>
    h.person_id
      ? (names.get(h.person_id) ?? "Someone you can't see")
      : h.organisation_id
        ? (orgs.get(h.organisation_id) ?? "A firm")
        : (entName.get(h.holder_entity_id ?? "") ?? "An entity");
  const recipient = (d: Distribution) => {
    if (d.beneficiary_id) {
      const b = beneficiaries.find((x) => x.id === d.beneficiary_id);
      return b ? (b.cause ?? holder(b)) : "A beneficiary";
    }
    const m = members.find((x) => x.id === d.class_member_id);
    return m
      ? `${names.get(m.person_id) ?? "Someone you can't see"} (${bClasses.get(m.class_id) ?? "a class"})`
      : "A member of a class";
  };

  const scope = selected ? { entityId: selected.id } : {};
  const { meetings, resolutions, decisions } = await loadRecords(ctx, scope);
  const decisionLink = (id: string | null) => {
    const d = decisions.find((x) => x.id === id);
    if (!d)
      return id ? "A decision you can't see" : "No decision (it was removed)";
    return (
      <Link
        href={
          d.meeting_id
            ? `/families/${familyId}/meetings/${d.meeting_id}`
            : `/families/${familyId}/meetings/resolutions/${d.resolution_id}`
        }
        className="underline decoration-border underline-offset-4 hover:decoration-ink"
      >
        {refFor(d, meetings, resolutions)}
      </Link>
    );
  };
  const distributions = ((dRows ?? []) as Distribution[]).filter(
    (d) => !selected || d.entity_id === selected.id,
  );
  const dividends = ((vRows ?? []) as Dividend[]).filter(
    (d) => !selected || d.entity_id === selected.id,
  );
  const lines = (lRows ?? []) as Line[];
  const targets =
    selected && ctx.canEdit ? await decisionTargets(ctx, selected) : [];
  const here = `/families/${familyId}/distributions${selected ? `?entity=${selected.id}` : ""}`;
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Europe/London",
  });
  const familyName = /family$/i.test(ctx.family.name.trim())
    ? ctx.family.name
    : `${ctx.family.name} family`;
  const isTrust = selected && trusts.includes(selected);

  return (
    <AppShell
      family={{ id: familyId, name: ctx.family.name }}
      section="distributions"
      crumbs={[
        ["My families", "/"],
        [familyName, `/families/${familyId}`],
        ["Distributions & dividends"],
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
        title="Distributions & dividends"
        subtitle="Distributions from trusts and foundations, and dividends from companies. Each is decided by a meeting or written resolution, declared once that decision passes, then paid."
      />
      {sp.error && (
        <p className="alert mb-4">Not saved: {errorMessage(sp.error)}</p>
      )}

      <form method="get" className="mb-5 flex flex-wrap items-end gap-3">
        <div>
          <label
            htmlFor="entity"
            className="mb-1 block text-sm font-medium text-ink"
          >
            Whose
          </label>
          <select
            id="entity"
            name="entity"
            defaultValue={selected?.id ?? ""}
            className="text-input"
          >
            <option value="">Every entity</option>
            <optgroup label="Trusts and foundations (distributions)">
              {trusts.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Companies (dividends)">
              {companies.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
        <button type="submit" className="btn-secondary">
          Show
        </button>
      </form>

      <div className="space-y-5">
        {ctx.canEdit && !selected && (
          <Notice>
            Choose a trust, foundation or company above to record a distribution
            or declare a dividend.
          </Notice>
        )}

        {ctx.canEdit && selected && isTrust && (
          <Card
            title={`Record a distribution from ${selected.name}`}
            description="It is drafted as a decision of the trustees (or council). It is declared once that decision passes."
          >
            <Fold label="Record a distribution">
              <form
                action={recordDistribution.bind(null, familyId, selected.id)}
                className="space-y-4"
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Select
                    label="To"
                    name="recipient"
                    required
                    includeBlank="Choose…"
                    options={[
                      ...beneficiaries
                        .filter(
                          (b) => b.entity_id === selected.id && !b.ceased_on,
                        )
                        .map(
                          (b) =>
                            [
                              `beneficiary:${b.id}`,
                              b.cause
                                ? `${b.cause} (charitable cause)`
                                : holder(b),
                            ] as [string, string],
                        ),
                      ...members
                        .filter(
                          (m) => m.entity_id === selected.id && !m.ceased_on,
                        )
                        .map(
                          (m) =>
                            [
                              `member:${m.id}`,
                              `${names.get(m.person_id) ?? "Someone you can't see"} – ${bClasses.get(m.class_id) ?? "a class"}`,
                            ] as [string, string],
                        ),
                    ]}
                    hint="Named beneficiaries and members of the classes of beneficiaries."
                  />
                  <Select
                    label="Paid from"
                    name="pool"
                    options={POOLS}
                    defaultValue="income"
                  />
                  <Field
                    label="Currency"
                    name="currency"
                    defaultValue={selected.base_currency ?? ""}
                    required
                  />
                  <Field label="Amount" name="amount" required />
                  <Select
                    label="How it is paid"
                    name="form"
                    options={DISTRIBUTION_FORMS}
                    defaultValue="cash"
                  />
                  <Field
                    label="Clause of the deed or charter"
                    name="deed_clause"
                    hint="e.g. clause 7.2"
                  />
                </div>
                <TextArea
                  label="Purpose"
                  name="purpose"
                  rows={2}
                  hint="e.g. university fees"
                />
                <Checkbox
                  label="The letter of wishes was considered"
                  name="letter_of_wishes"
                />
                <Select
                  label="Decided in"
                  name="decide_in"
                  required
                  includeBlank="Choose…"
                  options={targets}
                  hint="The wording is drafted for you there."
                />
                <SubmitButton>Draft the distribution</SubmitButton>
              </form>
            </Fold>
          </Card>
        )}

        {ctx.canEdit && selected && !isTrust && (
          <Card
            title={`Declare a dividend of ${selected.name}`}
            description="It is drafted as a decision of the directors (or members). When it passes, a payment line is worked out for every member on the register on the record date."
          >
            <Fold label="Declare a dividend">
              <form
                action={recordDividend.bind(null, familyId, selected.id)}
                className="space-y-4"
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Select
                    label="Class of shares"
                    name="class_id"
                    required
                    options={classes
                      .filter((c) => c.entity_id === selected.id)
                      .map(
                        (c) =>
                          [c.id, `${c.name} (${c.currency})`] as [
                            string,
                            string,
                          ],
                      )}
                  />
                  <Select
                    label="Kind"
                    name="kind"
                    options={DIVIDEND_KINDS}
                    defaultValue="final"
                  />
                  <Select
                    label="Enter as"
                    name="enter_as"
                    options={{
                      per_share: "Amount per share",
                      total: "Total amount",
                    }}
                    defaultValue="per_share"
                  />
                  <Field
                    label="Amount"
                    name="amount"
                    required
                    hint="A total is divided by the shares in issue today."
                  />
                  <Field
                    label="Record date"
                    name="record_date"
                    type="date"
                    hint="Members on the register that day are paid. Empty: the day it is declared."
                  />
                  <Field label="Payment date" name="payment_date" type="date" />
                  <Select
                    label="How it is paid"
                    name="form"
                    options={DIVIDEND_FORMS}
                    defaultValue="cash"
                  />
                </div>
                <Select
                  label="Decided in"
                  name="decide_in"
                  required
                  includeBlank="Choose…"
                  options={targets}
                  hint="The wording is drafted for you there. Check any solvency test the law requires before it is declared."
                />
                <SubmitButton>Draft the dividend</SubmitButton>
              </form>
            </Fold>
          </Card>
        )}

        {(!selected || isTrust) && (
          <Card title="Distributions">
            {distributions.length === 0 ? (
              <p className="border-y border-border py-3 text-ink-3">
                None recorded.
              </p>
            ) : (
              <ul className="divide-y divide-border border-y border-border">
                {distributions.map((d) => (
                  <li key={d.id} className="space-y-2 py-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-[15px] font-medium text-ink">
                        {money(d.currency, d.amount)} to {recipient(d)}
                      </span>
                      <Chip>{PAYOUT_STATUS[d.status]}</Chip>
                    </div>
                    <p className="text-sm text-ink-3">
                      {[
                        selected ? null : entName.get(d.entity_id),
                        POOLS[d.pool],
                        DISTRIBUTION_FORMS[d.form],
                        d.deed_clause,
                        d.letter_of_wishes
                          ? "Letter of wishes considered"
                          : null,
                        d.declared_on
                          ? `Declared ${formatDate(d.declared_on)}`
                          : null,
                        d.paid_on
                          ? `Paid ${formatDate(d.paid_on)}${d.receipt_reference ? ` (${d.receipt_reference})` : ""}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <p className="text-sm text-ink-2">
                      Decided by: {decisionLink(d.decision_id)}
                    </p>
                    {d.purpose && (
                      <p className="text-sm text-ink-2">Purpose: {d.purpose}</p>
                    )}
                    {ctx.canEdit && d.status === "declared" && (
                      <Fold label="Record the payment">
                        <form
                          action={payDistribution.bind(
                            null,
                            familyId,
                            here,
                            d.id,
                          )}
                          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
                        >
                          <Field
                            id={`paid-${d.id}`}
                            label="Date paid"
                            name="paid_on"
                            type="date"
                            defaultValue={today}
                            required
                          />
                          <Field
                            id={`receipt-${d.id}`}
                            label="Signed receipt (reference)"
                            name="receipt_reference"
                          />
                          <SubmitButton>Record as paid</SubmitButton>
                        </form>
                      </Fold>
                    )}
                    {ctx.canEdit && d.status === "proposed" && (
                      <div className="flex flex-wrap gap-3">
                        <form
                          action={cancelPayout.bind(
                            null,
                            familyId,
                            here,
                            "distributions",
                            d.id,
                          )}
                        >
                          <SubmitButton
                            variant="quiet"
                            pendingText="Cancelling…"
                          >
                            Cancel (once its decision is withdrawn or not
                            carried)
                          </SubmitButton>
                        </form>
                      </div>
                    )}
                    {ctx.canEdit &&
                      (d.status === "proposed" || d.status === "cancelled") && (
                        <ConfirmRemove
                          action={removePayout.bind(
                            null,
                            familyId,
                            here,
                            "distributions",
                            d.id,
                          )}
                          what={`this distribution to ${recipient(d)}`}
                        />
                      )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {(!selected || !isTrust) && (
          <Card title="Dividends">
            {dividends.length === 0 ? (
              <p className="border-y border-border py-3 text-ink-3">
                None recorded.
              </p>
            ) : (
              <ul className="divide-y divide-border border-y border-border">
                {dividends.map((v) => {
                  const cls = classes.find((c) => c.id === v.class_id);
                  const mine = lines.filter((l) => l.dividend_id === v.id);
                  const total = mine.reduce((n, l) => n + Number(l.amount), 0);
                  return (
                    <li key={v.id} className="space-y-2 py-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-[15px] font-medium text-ink">
                          {DIVIDEND_KINDS[v.kind]} dividend of {v.currency}{" "}
                          {Number(v.per_share).toLocaleString("en-GB", {
                            maximumFractionDigits: 6,
                          })}{" "}
                          per {cls?.name ?? ""} share
                        </span>
                        <Chip>{PAYOUT_STATUS[v.status]}</Chip>
                      </div>
                      <p className="text-sm text-ink-3">
                        {[
                          selected ? null : entName.get(v.entity_id),
                          DIVIDEND_FORMS[v.form],
                          v.record_date
                            ? `Record date ${formatDate(v.record_date)}`
                            : null,
                          v.payment_date
                            ? `Payable ${formatDate(v.payment_date)}`
                            : null,
                          v.declared_on
                            ? `Declared ${formatDate(v.declared_on)}`
                            : null,
                          mine.length
                            ? `Total ${money(v.currency, total)}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      <p className="text-sm text-ink-2">
                        Decided by: {decisionLink(v.decision_id)}
                      </p>
                      {mine.length > 0 && (
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[560px] border-collapse text-sm">
                            <thead>
                              <tr className="border-b border-ink">
                                {[
                                  "Member",
                                  "Shares",
                                  "Amount",
                                  "Paid",
                                  "Voucher",
                                  "",
                                ].map((h) => (
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
                              {mine.map((l) => (
                                <tr
                                  key={l.id}
                                  className="border-b border-border align-top"
                                >
                                  <td className="py-1.5 pr-4">{holder(l)}</td>
                                  <td className="py-1.5 pr-4">
                                    {Number(l.shares).toLocaleString("en-GB")}
                                  </td>
                                  <td className="py-1.5 pr-4">
                                    {money(v.currency, l.amount)}
                                  </td>
                                  <td className="py-1.5 pr-4">
                                    {l.paid_on ? formatDate(l.paid_on) : "—"}
                                  </td>
                                  <td className="py-1.5 pr-4">
                                    {l.voucher ?? "—"}
                                  </td>
                                  <td className="py-1.5">
                                    {ctx.canEdit && (
                                      <Fold
                                        label={l.paid_on ? "Change" : "Record"}
                                      >
                                        <form
                                          action={payDividendLine.bind(
                                            null,
                                            familyId,
                                            here,
                                            v.id,
                                            l.id,
                                          )}
                                          className="space-y-2"
                                        >
                                          <Field
                                            id={`lp-${l.id}`}
                                            label="Date paid"
                                            name="paid_on"
                                            type="date"
                                            defaultValue={l.paid_on ?? today}
                                          />
                                          <Field
                                            id={`lv-${l.id}`}
                                            label="Voucher number"
                                            name="voucher"
                                            defaultValue={l.voucher}
                                          />
                                          <SubmitButton>Save</SubmitButton>
                                        </form>
                                      </Fold>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {ctx.canEdit &&
                        v.status === "declared" &&
                        mine.some((l) => !l.paid_on) && (
                          <Fold label="Record every unpaid line as paid">
                            <form
                              action={payDividendAll.bind(
                                null,
                                familyId,
                                here,
                                v.id,
                              )}
                              className="flex flex-wrap items-end gap-3"
                            >
                              <Field
                                id={`all-${v.id}`}
                                label="Date paid"
                                name="paid_on"
                                type="date"
                                defaultValue={today}
                                required
                              />
                              <SubmitButton>Record as paid</SubmitButton>
                            </form>
                          </Fold>
                        )}
                      {ctx.canEdit && v.status === "proposed" && (
                        <form
                          action={cancelPayout.bind(
                            null,
                            familyId,
                            here,
                            "dividends",
                            v.id,
                          )}
                        >
                          <SubmitButton
                            variant="quiet"
                            pendingText="Cancelling…"
                          >
                            Cancel (once its decision is withdrawn or not
                            carried)
                          </SubmitButton>
                        </form>
                      )}
                      {ctx.canEdit &&
                        (v.status === "proposed" ||
                          v.status === "cancelled") && (
                          <ConfirmRemove
                            action={removePayout.bind(
                              null,
                              familyId,
                              here,
                              "dividends",
                              v.id,
                            )}
                            what="this dividend"
                          />
                        )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        )}
        <p className="text-sm text-ink-3">
          Pool balances (income and capital) come with Finances, worked out from
          the income recorded and adjustable to the signed accounts.
        </p>
      </div>
    </AppShell>
  );
}
