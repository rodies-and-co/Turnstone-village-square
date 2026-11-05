import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageTitle } from "@/components/AppShell";
import { ConfirmRemove, SubmitButton, Toast } from "@/components/feedback";
import { PrintButton } from "@/components/PrintButton";
import { Card, Checkbox, Field, Fold, Select } from "@/components/ui";
import { DOMAINS, DOMAIN_KEYS, RELATIONSHIPS, listWords, type Domain, type Relationship } from "@/lib/advisors";
import { APPOINTMENT_ROLES, type AppointmentRole } from "@/lib/entity-checklist";
import { getFamilyContext } from "@/lib/family-context";
import { PROFESSIONS, formatDate } from "@/lib/governance";
import { errorMessage, savedMessage } from "@/lib/messages";
import { londonDate } from "@/lib/organising";
import { TextArea } from "../../meetings/DecisionsArea";
import { loadTeam } from "../../organising/organising-data";
import { loadCategories, loadLook } from "../../risks/risk-data";
import { AddRiskForm } from "../../risks/RiskParts";
import { assessRelationship, endPlace, placeAdvisor, removePlace, saveAdvisorDetails, setCoordinator } from "../advisor-actions";

export const dynamic = "force-dynamic";

type Advisor = { id: string; full_name: string; firm: string | null; profession: keyof typeof PROFESSIONS; email: string | null; phone: string | null };
type Place = { id: string; advisor_id: string; branch_id: string | null; domain: Domain | null; advises_on: string | null; from_date: string | null; to_date: string | null; coordinator: boolean };
type Assessment = { role_id: string; relationship: Relationship; note: string | null; assessed_on: string };
type View = "map" | "advisors" | "firms";

// Circles of advisors, as the family's advisory team map: who covers each of
// the ten domains of family wealth, who coordinates them, and where nobody
// does. For the whole picture, the family's own circle, or one branch's.
export default async function AdvisoryTeam({
  params,
  searchParams,
}: {
  params: Promise<{ familyId: string }>;
  searchParams: Promise<{ view?: string; circle?: string; show?: string; saved?: string; error?: string }>;
}) {
  const { familyId } = await params;
  const sp = await searchParams;
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db) notFound();
  const [{ data: a }, { data: r }, { data: s }, { data: b }, { data: orgs }, { data: appts }, { data: ents }, team, look, cats] = await Promise.all([
    ctx.db.from("advisors").select("id, full_name, firm, profession, email, phone").order("full_name"),
    ctx.db.from("advisor_roles").select("id, advisor_id, branch_id, domain, advises_on, from_date, to_date, coordinator"),
    ctx.canEdit ? ctx.db.from("advisor_assessments").select("role_id, relationship, note, assessed_on") : Promise.resolve({ data: [] }),
    ctx.db.from("branches").select("id, name").order("name"),
    ctx.db.from("outside_organisations").select("id, name, jurisdiction").order("name"),
    ctx.db.from("appointments").select("entity_id, role, organisation_id, ceased_on").not("organisation_id", "is", null),
    ctx.db.from("entities").select("id, name"),
    loadTeam(ctx),
    ctx.canEdit ? loadLook(ctx) : Promise.resolve(null),
    ctx.canEdit ? loadCategories(ctx) : Promise.resolve([]),
  ]);
  const advisors = (a ?? []) as Advisor[];
  const byId = new Map(advisors.map((x) => [x.id, x]));
  const branches = (b ?? []) as { id: string; name: string }[];
  const branchName = new Map(branches.map((x) => [x.id, x.name]));
  const assessment = new Map(((s ?? []) as Assessment[]).map((x) => [x.role_id, x]));
  const now = londonDate(new Date().toISOString())!;
  const view: View = sp.view === "advisors" ? "advisors" : sp.view === "firms" ? "firms" : "map";
  // The circle: everything, the family's own, or one branch's.
  const circle = sp.circle === "family" ? "family" : branches.some((x) => x.id === sp.circle) ? sp.circle! : "all";
  const showAll = sp.show === "all";
  const inCircle = (p: Place) => circle === "all" || (circle === "family" ? p.branch_id === null : p.branch_id === circle);
  const all = (r ?? []) as Place[];
  const places = all.filter((p) => inCircle(p) && (showAll || !p.to_date));
  const current = all.filter((p) => inCircle(p) && !p.to_date);
  const circleLabel = (p: Place) => (p.branch_id ? `${branchName.get(p.branch_id) ?? "A branch"}'s circle` : "The family's circle");
  const covered = DOMAIN_KEYS.filter((d) => current.some((p) => p.domain === d));
  const gaps = DOMAIN_KEYS.filter((d) => !covered.includes(d));
  const coordinators = current.filter((p) => p.coordinator);
  const weak = current.filter((p) => assessment.get(p.id)?.relationship === "weak");
  const other = places.filter((p) => !p.domain);

  const base = `/families/${familyId}/village/advisors`;
  const link = (o: { view?: View; circle?: string; show?: boolean }) => {
    const q = new URLSearchParams();
    const v = o.view ?? view;
    const c = o.circle ?? circle;
    if (v !== "map") q.set("view", v);
    if (c !== "all") q.set("circle", c);
    if (o.show ?? showAll) q.set("show", "all");
    const qs = q.toString();
    return qs ? `${base}?${qs}` : base;
  };
  const here = link({});
  const tab = (active: boolean) => `inline-flex min-h-11 items-center border-b-2 px-3 text-[15px] ${active ? "border-primary font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink"}`;
  const familyName = /family$/i.test(ctx.family.name.trim()) ? ctx.family.name : `${ctx.family.name} family`;
  const circleOptions: [string, string][] = [["family", "The family's circle"], ...branches.map((x) => [`branch:${x.id}`, `${x.name}'s circle`] as [string, string])];
  const defaultCircle = circle === "all" || circle === "family" ? "family" : `branch:${circle}`;
  const title = circle === "all" ? "Every circle" : circle === "family" ? "The family's circle" : `${branchName.get(circle)}'s circle`;

  // Adding an advisor to a circle (one already recorded, or a new one).
  const placeForm = (prefix: string, domain?: Domain) => (
    <form action={placeAdvisor.bind(null, familyId, `${here}${domain ? `#domain-${domain}` : ""}`)} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Select id={`${prefix}-advisor`} label="Advisor" name="advisor_id" options={advisors.map((x) => [x.id, `${x.full_name}${x.firm ? `, ${x.firm}` : ""}`] as [string, string])} includeBlank="A new advisor (give their details below)" />
        <Select id={`${prefix}-circle`} label="Circle" name="circle" options={circleOptions} defaultValue={defaultCircle} />
        {domain ? (
          <input type="hidden" name="domain" value={domain} />
        ) : (
          <Select id={`${prefix}-domain`} label="Domain" name="domain" options={DOMAIN_KEYS.map((d) => [d, DOMAINS[d][0]] as [string, string])} includeBlank="Other (say what below)" />
        )}
        <Field id={`${prefix}-from`} label="Since" name="from_date" type="date" />
        <div className="sm:col-span-2">
          <Field id={`${prefix}-on`} label="What they advise on, in a few words" name="advises_on" hint={domain ? "Optional." : "Needed if no domain is chosen."} />
        </div>
        <div className="sm:col-span-2">
          <Checkbox label="Coordinates the advisors in this circle" name="coordinator" />
        </div>
      </div>
      <Fold label="A new advisor's details">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={`${prefix}-name`} label="Name (a person or a firm)" name="full_name" />
          <Field id={`${prefix}-firm`} label="Firm (if a person)" name="firm" />
          <Select id={`${prefix}-prof`} label="What they do" name="profession" options={PROFESSIONS} defaultValue="other" />
          <Field id={`${prefix}-email`} label="Email" name="email" type="email" />
          <Field id={`${prefix}-phone`} label="Phone" name="phone" />
        </div>
      </Fold>
      <SubmitButton>Add to the circle</SubmitButton>
    </form>
  );

  // One advisor's place, with the team's view of how it is working.
  const placeLine = (p: Place, showDomain: boolean, actions = true) => {
    const adv = byId.get(p.advisor_id);
    const ass = assessment.get(p.id);
    return (
      <li key={p.id} className="py-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {showDomain ? (
            <span className="font-semibold text-ink">{p.domain ? DOMAINS[p.domain][0] : (p.advises_on ?? "Other advice")}</span>
          ) : (
            <>
              <span className="font-semibold text-ink">{adv?.full_name ?? "An advisor"}</span>
              {adv?.firm && <span className="text-ink-2">{adv.firm}</span>}
            </>
          )}
          {p.coordinator && <span className="rounded-full bg-ink px-2 py-0.5 text-xs font-medium text-white">Coordinator</span>}
          {ass?.relationship === "weak" && <span className="rounded-full bg-[#b3261e] px-2 py-0.5 text-xs font-medium text-white">Working weakly</span>}
          {p.to_date && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-ink">Former</span>}
        </div>
        <p className="text-sm text-ink-3">
          {[showDomain && !p.domain ? null : p.advises_on, circle === "all" ? circleLabel(p) : null, p.to_date ? `Until ${formatDate(p.to_date)}` : p.from_date ? `Since ${formatDate(p.from_date)}` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {actions && ctx.canEdit && !p.to_date && (
          <div className="mt-1 flex flex-wrap items-start gap-x-4 print:hidden">
            <Fold label="How it is working">
              <form action={assessRelationship.bind(null, familyId, here, p.id)} className="space-y-3">
                <Select id={`rel-${p.id}`} label="The relationship is" name="relationship" options={RELATIONSHIPS} defaultValue={ass?.relationship ?? "working"} />
                <TextArea id={`note-${p.id}`} label="Note (seen by the team only)" name="note" rows={2} defaultValue={ass?.note} />
                {ass && <p className="text-xs text-ink-3">Last looked at {formatDate(ass.assessed_on)}.</p>}
                <SubmitButton variant="secondary">Save</SubmitButton>
              </form>
            </Fold>
            <form action={setCoordinator.bind(null, familyId, here, p.id, !p.coordinator)}>
              <SubmitButton variant="quiet" pendingText="Saving…">
                {p.coordinator ? "Stop coordinating" : "Make coordinator"}
              </SubmitButton>
            </form>
            <Fold label="End">
              <form action={endPlace.bind(null, familyId, here, p.id)} className="space-y-3">
                <Field id={`end-${p.id}`} label="Ended on" name="to_date" type="date" defaultValue={now} />
                <SubmitButton variant="secondary">End this place</SubmitButton>
              </form>
            </Fold>
            <ConfirmRemove action={removePlace.bind(null, familyId, here, p.id)} what={`${adv?.full_name ?? "this advisor"} from ${circleLabel(p).toLowerCase()}`} />
          </div>
        )}
      </li>
    );
  };

  return (
    <AppShell
      family={{ id: familyId, name: ctx.family.name }}
      section="advisors"
      crumbs={[["My families", "/"], [familyName, `/families/${familyId}`], ["Circles of advisors"]]}
      user={{ name: ctx.displayName, roleLabel: ctx.roleLabel, hasTwoFactor: ctx.hasTwoFactor }}
    >
      {sp.error && <Toast key={`e-${sp.error}-${Date.now()}`} kind="error" message={errorMessage(sp.error)!} />}
      {sp.saved && !sp.error && <Toast key={`s-${sp.saved}-${Date.now()}`} message={savedMessage(sp.saved)!} />}
      {ctx.canEdit && look && (
        <div className="mb-5 rounded-lg border border-border bg-card px-5 py-1 print:hidden">
          <Fold label="Record a risk">
            <AddRiskForm familyId={familyId} back={here} cats={cats} look={look} team={team} me={ctx.user?.id ?? ""} />
          </Fold>
        </div>
      )}
      <PageTitle
        title="Circles of advisors"
        subtitle="The family's advisors across the ten domains of family wealth set out by the UHNW Institute: who covers what, who coordinates them, and where nobody does."
        actions={<PrintButton label={view === "map" ? "Print the map" : "Print"} />}
      />

      <nav aria-label="Circle" className="border-b border-border print:hidden">
        <ul className="flex flex-wrap gap-x-1">
          {[["all", "Every circle"] as [string, string], ["family", "The family"] as [string, string], ...branches.map((x) => [x.id, x.name] as [string, string])].map(([k, t]) => (
            <li key={k}>
              <Link href={link({ circle: k })} aria-current={circle === k ? "page" : undefined} className={tab(circle === k)}>
                {t}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex flex-wrap gap-2" role="group" aria-label="View">
          {(
            [
              ["map", "The map"],
              ["advisors", "By advisor"],
              ["firms", "Firms serving the entities"],
            ] as [View, string][]
          ).map(([k, t]) => (
            <Link key={k} href={link({ view: k })} aria-current={view === k ? "page" : undefined} className={view === k ? "btn-primary" : "btn-secondary"}>
              {t}
            </Link>
          ))}
        </div>
        <Link href={link({ show: !showAll })} className="inline-flex min-h-11 items-center text-sm text-ink underline">
          {showAll ? "Show current advisors only" : "Include former advisors"}
        </Link>
      </div>
      <p className="mt-4 hidden text-sm text-ink-2 print:block">{title}</p>

      <div className="mt-5 space-y-5">
        {sp.error && <p className="alert">Not saved: {errorMessage(sp.error)}</p>}

        {view === "map" && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border bg-card px-5 py-4">
                <p className="text-2xl font-semibold text-ink">
                  {covered.length} of {DOMAIN_KEYS.length}
                </p>
                <p className="text-ink-2">Domains with an advisor</p>
              </div>
              <div className="rounded-lg border border-border bg-card px-5 py-4">
                <p className="text-lg font-semibold text-ink">{coordinators.length ? listWords(coordinators.map((p) => byId.get(p.advisor_id)?.full_name ?? "An advisor")) : "Nobody yet"}</p>
                <p className="text-ink-2">{coordinators.length === 1 || !coordinators.length ? "Coordinates the advisors" : "Coordinate the advisors (one per circle)"}</p>
              </div>
              {ctx.canEdit ? (
                <div className={`rounded-lg border px-5 py-4 ${weak.length ? "border-[#b3261e] bg-[#fbeae8]" : "border-border bg-card"}`}>
                  <p className="text-2xl font-semibold text-ink">{weak.length}</p>
                  <p className="text-ink-2">{weak.length === 1 ? "Relationship working weakly" : "Relationships working weakly"}</p>
                </div>
              ) : (
                <div className="rounded-lg border border-border bg-card px-5 py-4">
                  <p className="text-2xl font-semibold text-ink">{new Set(current.map((p) => p.advisor_id)).size}</p>
                  <p className="text-ink-2">Advisors</p>
                </div>
              )}
            </div>

            <Card title={`The map – ${title.toLowerCase().replace(/^every/, "every")}`}>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {DOMAIN_KEYS.map((d) => {
                  const list = places.filter((p) => p.domain === d);
                  const empty = !list.some((p) => !p.to_date);
                  return (
                    <section
                      key={d}
                      id={`domain-${d}`}
                      className={`scroll-mt-6 rounded-lg border px-4 py-3 ${empty ? "border-[#b3261e] bg-[#fbeae8]" : "border-border bg-white"}`}
                      aria-labelledby={`dh-${d}`}
                    >
                      <h3 id={`dh-${d}`} className="font-semibold text-ink">
                        {DOMAINS[d][0]}
                      </h3>
                      <p className="text-sm text-ink-2">{DOMAINS[d][1]}</p>
                      {empty && <p className="mt-2 font-medium text-[#8c1d18]">No advisor</p>}
                      {list.length > 0 && <ul className="mt-1 divide-y divide-border">{list.map((p) => placeLine(p, false, false))}</ul>}
                      {ctx.canEdit && (
                        <div className="print:hidden">
                          <Fold label="Add an advisor here">{placeForm(`d-${d}`, d)}</Fold>
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
              <p className="mt-4 text-ink-2">{gaps.length ? `Gaps: ${listWords(gaps.map((d) => DOMAINS[d][0].toLowerCase()))}.` : "Every domain has an advisor."}</p>
              {ctx.canEdit && (
                <p className="mt-1 text-sm text-ink-3 print:hidden">
                  To change how a relationship is working, who coordinates, or to end a place, use{" "}
                  <Link href={link({ view: "advisors" })} className="inline-flex min-h-11 items-center underline">
                    By advisor
                  </Link>
                  .
                </p>
              )}
            </Card>

            {other.length > 0 && (
              <Card title="Other advice" description="Places recorded without a domain. Give each a domain so it shows on the map.">
                <ul className="divide-y divide-border border-y border-border">{other.map((p) => placeLine(p, false))}</ul>
              </Card>
            )}
          </>
        )}

        {view === "advisors" && (
          <>
            {advisors
              .filter((x) => places.some((p) => p.advisor_id === x.id) || (circle === "all" && ctx.canEdit))
              .map((x) => {
                const mine = places.filter((p) => p.advisor_id === x.id).sort((p, q) => Number(Boolean(p.to_date)) - Number(Boolean(q.to_date)));
                return (
                  <Card
                    key={x.id}
                    title={x.full_name}
                    description={`${PROFESSIONS[x.profession] ?? x.profession}${x.firm ? `, ${x.firm}` : ""}${[x.email, x.phone].filter(Boolean).length ? ` · ${[x.email, x.phone].filter(Boolean).join(" · ")}` : ""}`}
                  >
                    {mine.length === 0 ? <p className="text-ink-3">Not in a circle yet.</p> : <ul className="divide-y divide-border border-y border-border">{mine.map((p) => placeLine(p, true))}</ul>}
                    {ctx.canEdit && (
                      <div className="print:hidden">
                        <Fold label="Change their details">
                          <form action={saveAdvisorDetails.bind(null, familyId, here, x.id)} className="space-y-4">
                            <div className="grid gap-4 sm:grid-cols-2">
                              <Field id={`a-${x.id}-name`} label="Name (a person or a firm)" name="full_name" required defaultValue={x.full_name} />
                              <Field id={`a-${x.id}-firm`} label="Firm (if a person)" name="firm" defaultValue={x.firm} />
                              <Select id={`a-${x.id}-prof`} label="What they do" name="profession" options={PROFESSIONS} defaultValue={x.profession} />
                              <Field id={`a-${x.id}-email`} label="Email" name="email" type="email" defaultValue={x.email} />
                              <Field id={`a-${x.id}-phone`} label="Phone" name="phone" defaultValue={x.phone} />
                            </div>
                            <SubmitButton>Save</SubmitButton>
                          </form>
                        </Fold>
                      </div>
                    )}
                  </Card>
                );
              })}
            {ctx.canEdit && (
              <Card title="Add an advisor to a circle" description="Choose an advisor already recorded, or give a new advisor's details.">
                <Fold label="Add an advisor">{placeForm("new")}</Fold>
              </Card>
            )}
          </>
        )}

        {view === "firms" && (
          <Card title="Firms serving the family's entities" description="Service providers such as registered agents, trust companies and auditors, and the entities they serve. They are recorded in The Organisation.">
            {(() => {
              const entityName = new Map(((ents ?? []) as { id: string; name: string }[]).map((e) => [e.id, e.name]));
              const firms = ((orgs ?? []) as { id: string; name: string; jurisdiction: string | null }[])
                .map((o) => ({ ...o, serves: ((appts ?? []) as { entity_id: string; role: string; organisation_id: string; ceased_on: string | null }[]).filter((x) => x.organisation_id === o.id && (showAll || !x.ceased_on)) }))
                .filter((o) => o.serves.length);
              if (!firms.length) return <p className="text-ink-3">None recorded.</p>;
              return (
                <ul className="divide-y divide-border border-y border-border">
                  {firms.map((o) => (
                    <li key={o.id} className="py-3">
                      <p className="font-semibold text-ink">
                        {o.name}
                        {o.jurisdiction ? <span className="font-normal text-ink-2"> · {o.jurisdiction}</span> : null}
                      </p>
                      <ul className="text-sm text-ink-2">
                        {o.serves.map((x, i) => (
                          <li key={i}>
                            {APPOINTMENT_ROLES[x.role as AppointmentRole] ?? x.role} of{" "}
                            <Link href={`/families/${familyId}/organisation/${x.entity_id}?tab=officers`} className="inline-flex min-h-11 items-center underline">
                              {entityName.get(x.entity_id) ?? "an entity"}
                            </Link>
                            {x.ceased_on ? ` (until ${formatDate(x.ceased_on)})` : ""}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              );
            })()}
          </Card>
        )}
      </div>
    </AppShell>
  );
}
