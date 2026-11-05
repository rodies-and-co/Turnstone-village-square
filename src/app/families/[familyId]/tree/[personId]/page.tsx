import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageTitle } from "@/components/AppShell";
import { Toast } from "@/components/feedback";
import { Chip, UnderlineTabs } from "@/components/ui";
import { getFamilyContext } from "@/lib/family-context";
import { OrganisingFor } from "../../organising/OrganisingFor";
import { RiskFor } from "../../risks/RiskFor";
import { BookOfLife } from "../../story/BookOfLife";
import { errorMessage, savedMessage } from "@/lib/messages";
import {
  THREE_CIRCLE_ROLES,
  displayNames,
  lifeLine,
  type PersonSummary,
} from "@/lib/people";
import {
  AddressesTab,
  FinancesTab,
  HistoryTab,
  IdentityTab,
  LaterTab,
  OverviewTab,
  RelationshipsTab,
} from "./tabs";

export const dynamic = "force-dynamic";

const TABS = [
  ["overview", "Overview"],
  ["identity", "Identity"],
  ["addresses", "Addresses"],
  ["relationships", "Family & roles"],
  ["finances", "Finances"],
  ["records", "Records"],
  ["story", "Book of Life"],
  ["todo", "To do & calendar"],
  ["risks", "Risks"],
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
    .select(
      "id, full_names, surname, maiden_name, known_as, birth_year, deceased, member_type, three_circle_role, branch_id, user_id",
    )
    .order("surname");
  const person = (everyone ?? []).find(
    (p: { id: string }) => p.id === personId,
  );
  if (!person) notFound();
  const names = displayNames((everyone ?? []) as PersonSummary[]);

  const shared = {
    ctx,
    familyId,
    personId,
    person,
    everyone: everyone ?? [],
    names,
  };

  const familyName = /family$/i.test(ctx.family.name.trim())
    ? ctx.family.name
    : `${ctx.family.name} family`;
  const { data: branch } = person.branch_id
    ? await ctx.db
        .from("branches")
        .select("name")
        .eq("id", person.branch_id)
        .maybeSingle()
    : { data: null };
  const summary = [
    lifeLine(person),
    branch?.name,
    person.three_circle_role
      ? THREE_CIRCLE_ROLES[
          person.three_circle_role as keyof typeof THREE_CIRCLE_ROLES
        ]
      : null,
    person.member_type === "non_family"
      ? "Non-family"
      : person.member_type === "family_not_succession"
        ? "Family, not in succession"
        : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <AppShell
      family={{ id: familyId, name: ctx.family.name }}
      section="tree"
      crumbs={[
        ["My families", "/"],
        [familyName, `/families/${familyId}`],
        ["The Tree", `/families/${familyId}/tree`],
        [names.get(personId) ?? "Person"],
      ]}
      user={{
        name: ctx.displayName,
        roleLabel: ctx.roleLabel,
        hasTwoFactor: ctx.hasTwoFactor,
      }}
    >
      <PageTitle
        title={
          <span className="flex flex-wrap items-center gap-3">
            {names.get(personId)}
            {person.deceased && <Chip>Deceased</Chip>}
          </span>
        }
        subtitle={
          <>
            {person.full_names} {person.surname}
            {person.maiden_name ? ` (born ${person.maiden_name})` : ""}
            <span className="block text-sm text-ink-3">{summary}</span>
          </>
        }
        actions={
          <Link href={`/families/${familyId}/tree`} className="btn-quiet">
            Back to the Tree
          </Link>
        }
      />

      <UnderlineTabs
        label="Record sections"
        current={tab}
        items={TABS.map(
          ([t, text]) =>
            [t, text, `/families/${familyId}/tree/${personId}?tab=${t}`] as [
              string,
              string,
              string,
            ],
        )}
      />

      <div className="mt-6 space-y-5">
        {/* The error shows on the page and as a message at the bottom of the
            screen (wherever the person has scrolled to); only the message is
            read out, so screen readers don't hear it twice. */}
        {sp.error && (
          <p className="alert">Not saved: {errorMessage(sp.error)}</p>
        )}
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

        {tab === "overview" && <OverviewTab {...shared} />}
        {tab === "identity" && <IdentityTab {...shared} />}
        {tab === "addresses" && <AddressesTab {...shared} />}
        {tab === "relationships" && <RelationshipsTab {...shared} />}
        {tab === "finances" && <FinancesTab {...shared} />}
        {tab === "records" && (
          <LaterTab title="Records and reports">
            Reports on this person&apos;s ownership, roles and interests come
            with the Organisation stage.
          </LaterTab>
        )}
        {tab === "todo" && (
          <OrganisingFor
            ctx={ctx}
            familyId={familyId}
            names={names}
            personId={personId}
            here={`/families/${familyId}/tree/${personId}?tab=todo`}
          />
        )}
        {tab === "story" && <BookOfLife ctx={ctx} familyId={familyId} personId={personId} here={`/families/${familyId}/tree/${personId}?tab=story`} />}
        {tab === "risks" &&
          (ctx.canEdit ? (
            <RiskFor ctx={ctx} familyId={familyId} personId={personId} here={`/families/${familyId}/tree/${personId}?tab=risks`} />
          ) : (
            <LaterTab title="Risk notes">Risk notes about a person are seen by the family&apos;s Managers and Administrators only.</LaterTab>
          ))}
        {tab === "history" && <HistoryTab {...shared} />}
      </div>
    </AppShell>
  );
}
