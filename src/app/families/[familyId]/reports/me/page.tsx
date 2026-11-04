import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageTitle } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { APPOINTMENT_ROLES, type AppointmentRole } from "@/lib/entity-checklist";
import { getFamilyContext } from "@/lib/family-context";
import { formatDate } from "@/lib/governance";

export const dynamic = "force-dynamic";

type Mine = {
  person_id: string | null;
  reason?: "not_linked" | "not_allowed";
  offices: { entity: string; role: string; appointed_on: string | null; ceased_on: string | null }[];
  holdings: { entity: string; class: string; shares: number }[];
  benefits: { entity: string; as: string; interest: string | null; from: string | null; to: string | null }[];
  distributions: { entity: string; amount: number; currency: string; pool: string | null; status: string; declared_on: string | null; paid_on: string | null }[];
  dividends: { entity: string; class: string; shares: number; amount: number; currency: string; kind: string; status: string; paid_on: string | null; payment_date: string | null }[];
};

const money = (currency: string, amount: number) => `${currency} ${Number(amount).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const INTEREST: Record<string, string> = { discretionary: "Discretionary", fixed: "Fixed", default: "Default", contingent: "Contingent", other: "Other" };

// "My records": what concerns the person linked to this login.
export default async function MyRecords({ params }: { params: Promise<{ familyId: string }> }) {
  const { familyId } = await params;
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db) notFound();
  const { data, error } = await ctx.db.rpc("my_records");
  const mine = data as Mine | null;
  const familyName = /family$/i.test(ctx.family.name.trim()) ? ctx.family.name : `${ctx.family.name} family`;
  const empty = (s: string) => <p className="text-ink-3">{s}</p>;

  return (
    <AppShell
      family={{ id: familyId, name: ctx.family.name }}
      section="myrecords"
      crumbs={[["My families", "/"], [familyName, `/families/${familyId}`], ["Reports", `/families/${familyId}/reports`], ["My records"]]}
      user={{ name: ctx.displayName, roleLabel: ctx.roleLabel, hasTwoFactor: ctx.hasTwoFactor }}
    >
      <PageTitle title="My records" subtitle="What the family's records hold about you: the offices you hold, your shares, the trusts and foundations you benefit from, and what has been paid to you." />
      <div className="mt-6 space-y-5">
        {error || !mine || !mine.person_id ? (
          <p className="rounded-lg border border-border bg-card px-4 py-3 text-ink-2">
            {error
              ? "Your records couldn't be loaded just now. Please try again."
              : mine?.reason === "not_allowed"
                ? "Your login is linked to a person in the Tree, but your access doesn't include your own record. A Manager can change your access."
                : "Your login isn't linked to a person in this family's Tree, so there is nothing to show. A Manager links logins to people."}
          </p>
        ) : (
          <>
            <p>
              <Link href={`/families/${familyId}/tree/${mine.person_id}`} className="inline-flex min-h-11 items-center text-ink underline">
                My record in the Tree
              </Link>
            </p>
            <Card title="Offices I hold">
              {mine.offices.length === 0
                ? empty("None recorded.")
                : (
                  <ul className="divide-y divide-border border-y border-border">
                    {mine.offices.map((o, i) => (
                      <li key={i} className="flex flex-wrap justify-between gap-2 py-2">
                        <span><span className="font-medium text-ink">{APPOINTMENT_ROLES[o.role as AppointmentRole] ?? o.role}</span> of {o.entity}</span>
                        <span className="text-sm text-ink-3">{o.ceased_on ? `Former – until ${formatDate(o.ceased_on)}` : o.appointed_on ? `Since ${formatDate(o.appointed_on)}` : "Current"}</span>
                      </li>
                    ))}
                  </ul>
                )}
            </Card>
            <Card title="My shares">
              {mine.holdings.length === 0
                ? empty("None recorded.")
                : (
                  <ul className="divide-y divide-border border-y border-border">
                    {mine.holdings.map((h, i) => (
                      <li key={i} className="flex flex-wrap justify-between gap-2 py-2">
                        <span>{h.entity}</span>
                        <span className="text-ink">{Number(h.shares).toLocaleString("en-GB")} {h.class} shares</span>
                      </li>
                    ))}
                  </ul>
                )}
            </Card>
            <Card title="Trusts and foundations I benefit from">
              {mine.benefits.length === 0
                ? empty("None recorded.")
                : (
                  <ul className="divide-y divide-border border-y border-border">
                    {mine.benefits.map((b, i) => (
                      <li key={i} className="flex flex-wrap justify-between gap-2 py-2">
                        <span><span className="font-medium text-ink">{b.entity}</span> – {b.as}{b.interest ? ` (${INTEREST[b.interest] ?? b.interest})` : ""}</span>
                        <span className="text-sm text-ink-3">{b.to ? `Until ${formatDate(b.to)}` : b.from ? `Since ${formatDate(b.from)}` : "Current"}</span>
                      </li>
                    ))}
                  </ul>
                )}
            </Card>
            <Card title="Distributions to me">
              {mine.distributions.length === 0
                ? empty("None recorded.")
                : (
                  <ul className="divide-y divide-border border-y border-border">
                    {mine.distributions.map((d, i) => (
                      <li key={i} className="flex flex-wrap justify-between gap-2 py-2">
                        <span>{d.entity}{d.pool ? ` · from the ${d.pool} pool` : ""}</span>
                        <span className="text-ink">{money(d.currency, d.amount)} · {d.status === "paid" ? `Paid ${formatDate(d.paid_on)}` : `Declared ${formatDate(d.declared_on)}, not paid yet`}</span>
                      </li>
                    ))}
                  </ul>
                )}
            </Card>
            <Card title="Dividends to me">
              {mine.dividends.length === 0
                ? empty("None recorded.")
                : (
                  <ul className="divide-y divide-border border-y border-border">
                    {mine.dividends.map((d, i) => (
                      <li key={i} className="flex flex-wrap justify-between gap-2 py-2">
                        <span>{d.entity} · {Number(d.shares).toLocaleString("en-GB")} {d.class} shares</span>
                        <span className="text-ink">{money(d.currency, d.amount)} · {d.status === "paid" || d.paid_on ? `Paid${d.paid_on || d.payment_date ? ` ${formatDate(d.paid_on ?? d.payment_date)}` : ""}` : d.payment_date ? `Due ${formatDate(d.payment_date)}` : "Declared"}</span>
                      </li>
                    ))}
                  </ul>
                )}
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
