import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { Toast } from "@/components/feedback";
import { BackLink, PageShell } from "@/components/ui";
import { getFamilyContext } from "@/lib/family-context";
import { errorMessage, savedMessage } from "@/lib/messages";
import { displayNames, type PersonSummary } from "@/lib/people";
import { AddressesTab, FinancesTab, HistoryTab, IdentityTab, LaterTab, OverviewTab, RelationshipsTab } from "./tabs";

export const dynamic = "force-dynamic";

const TABS = [
  ["overview", "Overview"],
  ["identity", "Identity"],
  ["addresses", "Addresses"],
  ["relationships", "Relationships & roles"],
  ["finances", "Finances"],
  ["records", "Records & reports"],
  ["todo", "To do"],
  ["risks", "Risk notes"],
  ["history", "History"],
] as const;
type Tab = (typeof TABS)[number][0];

export default async function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ familyId: string; personId: string }>;
  searchParams: Promise<{ tab?: string; error?: string; saved?: string }>;
}) {
  const { familyId, personId } = await params;
  const sp = await searchParams;
  const tab: Tab = (TABS.find(([t]) => t === sp.tab)?.[0] ?? "overview") as Tab;
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db) notFound();

  // Everyone this user may see, for names and for choosing family links.
  const { data: everyone } = await ctx.db
    .from("people")
    .select("id, full_names, surname, maiden_name, known_as, birth_year, deceased, member_type, three_circle_role, branch_id, user_id")
    .order("surname");
  const person = (everyone ?? []).find((p: { id: string }) => p.id === personId);
  if (!person) notFound();
  const names = displayNames((everyone ?? []) as PersonSummary[]);

  const shared = { ctx, familyId, personId, person, everyone: everyone ?? [], names };

  return (
    <>
      <SiteHeader name={ctx.displayName} roleLabel={ctx.roleLabel} hasTwoFactor={ctx.hasTwoFactor} />
      <PageShell>
        <BackLink href={`/families/${familyId}/tree`}>The Tree</BackLink>
        <h1 className="mt-2 text-2xl font-semibold text-ink">
          {names.get(personId)}
          {person.deceased ? " · Deceased" : ""}
        </h1>
        <p className="text-ink">
          {person.full_names} {person.surname}
          {person.maiden_name ? ` (born ${person.maiden_name})` : ""}
        </p>

        <nav aria-label="Record sections" className="mt-6 flex flex-wrap gap-2 border-b border-border pb-3">
          {TABS.map(([t, label]) => (
            <Link
              key={t}
              href={`/families/${familyId}/tree/${personId}?tab=${t}`}
              aria-current={t === tab ? "page" : undefined}
              className={
                t === tab
                  ? "inline-flex min-h-11 items-center rounded-lg bg-primary px-3 font-semibold text-ink"
                  : "inline-flex min-h-11 items-center rounded-lg px-3 text-ink hover:bg-muted"
              }
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="mt-6 space-y-6">
          {/* The error shows on the page and as a message at the bottom of the
              screen (wherever the person has scrolled to); only the message is
              read out, so screen readers don't hear it twice. */}
          {sp.error && <p className="alert">Not saved: {errorMessage(sp.error)}</p>}
          {sp.error && <Toast key={`e-${sp.error}-${Date.now()}`} kind="error" message={errorMessage(sp.error)!} />}
          {sp.saved && !sp.error && <Toast key={`s-${sp.saved}-${Date.now()}`} message={savedMessage(sp.saved)!} />}

          {tab === "overview" && <OverviewTab {...shared} />}
          {tab === "identity" && <IdentityTab {...shared} />}
          {tab === "addresses" && <AddressesTab {...shared} />}
          {tab === "relationships" && <RelationshipsTab {...shared} />}
          {tab === "finances" && <FinancesTab {...shared} />}
          {tab === "records" && (
            <LaterTab title="Records & reports">
              Reports on this person&apos;s ownership, roles and interests come with the Organisation stage.
            </LaterTab>
          )}
          {tab === "todo" && (
            <LaterTab title="To do">
              This will show this person&apos;s items from the family&apos;s one to-do list, once Organising is built.
            </LaterTab>
          )}
          {tab === "risks" && (
            <LaterTab title="Risk notes">
              This will show risks linked to this person, from the family&apos;s one risk register.
            </LaterTab>
          )}
          {tab === "history" && <HistoryTab {...shared} />}
        </div>
      </PageShell>
    </>
  );
}
