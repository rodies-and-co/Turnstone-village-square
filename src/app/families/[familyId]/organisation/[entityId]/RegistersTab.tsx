import type { ReactNode } from "react";
import { PrintButton } from "@/components/PrintButton";
import { Card, Chip } from "@/components/ui";
import { APPOINTMENT_ROLES, type AppointmentRole } from "@/lib/entity-checklist";
import type { FamilyContext } from "@/lib/family-context";
import { formatDate } from "@/lib/governance";
import { INTERESTS, TRANSACTION_KINDS, beneficialOwners, formatShares, holderFrom, ruleText, type BoRule, type Holder } from "@/lib/ownership";
import { namer } from "../compliance-data";
import { SHARE_TYPES, TRUST_TYPES, loadOrganisationData } from "../organisation-data";

const th = "py-2 pr-4 text-left text-sm font-medium text-ink-3";
const td = "py-2 pr-4 align-top text-sm text-ink";

function Table({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <p className="border-y border-border py-3 text-ink-3">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[600px] border-y border-border">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={td}>
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

// The statutory registers of one entity, gathered from what is recorded
// elsewhere (nothing is typed in twice), ready to print or save as PDF.
export async function RegistersTab({
  ctx,
  entity,
  people,
  rule,
  registersText,
}: {
  ctx: FamilyContext;
  entity: { id: string; name: string; entity_type: string };
  people: Map<string, string>;
  rule: BoRule | null;
  registersText: string | null;
}) {
  const data = await loadOrganisationData(ctx);
  const nameOf = namer(data, people);
  const shareKind = SHARE_TYPES.includes(entity.entity_type);
  const trustKind = TRUST_TYPES.includes(entity.entity_type);
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });

  const appts = data.appointments.filter((a) => a.entity_id === entity.id);
  const role = (r: string) => APPOINTMENT_ROLES[r as AppointmentRole] ?? r;
  const officerRows = (list: typeof appts) =>
    [...list]
      .sort((a, b) => (a.appointed_on ?? "").localeCompare(b.appointed_on ?? ""))
      .map((a) => [nameOf(a.holder), role(a.role), formatDate(a.appointed_on) ?? "—", formatDate(a.ceased_on) ?? "—"]);

  const registers = shareKind ? data.registersFor(entity.id) : [];
  const ledger = data.transactions.filter((t) => t.entity_id === entity.id && t.status === "approved" && t.kind !== "authorise");
  const owners = rule ? beneficialOwners(entity.id, data.graph, rule) : [];
  const who = (h: Holder | null) => nameOf(h);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-3">Registers as at {today}. Each is gathered from what is recorded on the other tabs.</p>
        <PrintButton />
      </div>
      {registersText && (
        <Card title="What the law requires to be kept" description="From the Entity Standard.">
          <p className="whitespace-pre-line text-ink-2">{registersText}</p>
        </Card>
      )}

      {shareKind && (
        <Card title="Register of members">
          {registers.every((r) => r.holdings.length === 0) ? (
            <p className="border-y border-border py-3 text-ink-3">No shares issued yet.</p>
          ) : (
            <div className="space-y-5">
              {registers
                .filter((r) => r.holdings.length)
                .map((r) => (
                  <div key={r.shareClass.id}>
                    <h3 className="mb-2 font-semibold text-ink">{r.shareClass.name} shares</h3>
                    <Table
                      head={["Member", "Shares", "Certificates"]}
                      rows={r.holdings.map((h) => [who(h.holder), formatShares(h.shares), h.certificates.map((c) => `No. ${c.number}`).join(", ") || "—"])}
                      empty=""
                    />
                  </div>
                ))}
            </div>
          )}
        </Card>
      )}

      {shareKind && (
        <Card title="Register of allotments and transfers">
          <Table
            head={["Date", "What happened", "From", "To", "Shares", "Certificate"]}
            rows={ledger.map((t) => [
              formatDate(t.transaction_date),
              TRANSACTION_KINDS[t.kind],
              t.kind === "transfer" ? who(t.from) : "—",
              who(t.to),
              formatShares(t.shares),
              [t.certificate_number, t.balance_certificate_number && `balance ${t.balance_certificate_number}`].filter(Boolean).join(", ") || "—",
            ])}
            empty="Nothing approved yet."
          />
        </Card>
      )}

      {trustKind && (
        <Card title={entity.entity_type === "foundation" ? "Register of founders and endowments" : "Register of settlors and settlements"}>
          <Table
            head={["Who", "Date", "What was given"]}
            rows={data.settlements
              .filter((s) => s.entity_id === entity.id)
              .map((s) => [who(holderFrom(s)), formatDate(s.settled_on as string | null) ?? "—", (s.description as string | null) ?? "—"])}
            empty="None recorded."
          />
        </Card>
      )}

      {trustKind && (
        <Card title="Register of beneficiaries">
          <Table
            head={["Beneficiary", "Interest", "From", "To"]}
            rows={[
              ...data.beneficiaries
                .filter((b) => b.entity_id === entity.id)
                .map((b) => [
                  b.cause ? `Charitable cause: ${String(b.cause)}` : who(holderFrom(b)),
                  INTERESTS[b.interest as keyof typeof INTERESTS] ?? "—",
                  formatDate(b.added_on as string | null) ?? "—",
                  formatDate(b.ceased_on as string | null) ?? "—",
                ]),
              ...data.classMembers
                .filter((m) => m.entity_id === entity.id)
                .map((m) => [
                  `${who({ kind: "person", id: m.person_id })} (class: ${data.beneficiaryClasses.find((c) => c.id === m.class_id)?.name ?? "—"})`,
                  "Member of a class",
                  formatDate(m.added_on) ?? "—",
                  formatDate(m.ceased_on) ?? "—",
                ]),
            ]}
            empty="None recorded."
          />
        </Card>
      )}

      <Card title={trustKind ? "Register of trustees, council members and officers" : "Register of directors and officers"}>
        <h3 className="mb-2 font-semibold text-ink">Current</h3>
        <Table head={["Name", "Role", "Appointed", "Ceased"]} rows={officerRows(appts.filter((a) => !a.ceased_on))} empty="None recorded." />
        {appts.some((a) => a.ceased_on) && (
          <>
            <h3 className="mb-2 mt-5 font-semibold text-ink">Former</h3>
            <Table head={["Name", "Role", "Appointed", "Ceased"]} rows={officerRows(appts.filter((a) => a.ceased_on))} empty="" />
          </>
        )}
      </Card>

      <Card title="Register of beneficial owners" description={rule ? `Worked out under the rule: ${ruleText(rule)}. Check it before anything is filed.` : "No Entity Standard applies."}>
        <Table
          head={["Beneficial owner", "Share or role"]}
          rows={owners.map((o) => [
            <span key="n" className="flex flex-wrap items-center gap-2">
              {who(o.holder)}
              {o.fallback && <Chip>Senior managing official</Chip>}
              {o.outside && <Chip>Outside organisation</Chip>}
              {o.unresolved && <Chip>Can&apos;t be looked through</Chip>}
            </span>,
            [o.percent !== null ? `${Math.round(o.percent * 100) / 100}%` : null, ...o.reasons].filter(Boolean).join(" · "),
          ])}
          empty="Nobody can be worked out yet."
        />
      </Card>
    </>
  );
}
