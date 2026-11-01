import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageTitle } from "@/components/AppShell";
import { SubmitButton, Toast } from "@/components/feedback";
import { Card, Checkbox, Facts, Field, Fold, Select } from "@/components/ui";
import { requireSignedIn } from "@/lib/auth";
import { ENTITY_TYPES, type EntityType } from "@/lib/entity-checklist";
import { formatDate } from "@/lib/governance";
import { errorMessage, savedMessage } from "@/lib/messages";
import { SYSTEM_ROLE_LABELS } from "@/lib/roles";
import { STATUS_LABELS, boRuleText, type EntityStandard } from "@/lib/standards";
import { approveStandard, retireStandard, saveStandard } from "../actions";

export const dynamic = "force-dynamic";

const yes = (b: boolean) => (b ? "Required" : "Not required");

export default async function StandardPage({
  params,
  searchParams,
}: {
  params: Promise<{ standardId: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { standardId } = await params;
  const sp = await searchParams;
  const { supabase, systemRole, displayName, hasTwoFactor } = await requireSignedIn();
  const { data } = await supabase.from("entity_standards").select("*").eq("id", standardId).maybeSingle();
  if (!data) notFound();
  const s = data as EntityStandard;
  const canApprove = systemRole === "super_user" || systemRole === "system_admin";

  const requirements: [string, React.ReactNode][] = [
    ["Directors (minimum)", s.min_directors || null],
    ["Resident directors (minimum)", s.min_resident_directors || null],
    ["Trustees (minimum)", s.min_trustees || null],
    ["Council members (minimum)", s.min_council_members || null],
    ["Resident council members (minimum)", s.min_resident_council_members || null],
    ["Designated members (minimum)", s.min_designated_members || null],
    ["Registered office", yes(s.registered_office_required)],
    ["Company secretary", yes(s.secretary_required)],
    ["Registered agent", yes(s.registered_agent_required)],
    ["Nominated officer", yes(s.nominated_officer_required)],
    ["Management company", yes(s.management_company_required)],
    ["Public officer", yes(s.public_officer_required)],
    ["Auditor", yes(s.auditor_required)],
    ["Accounting officer", yes(s.accounting_officer_required)],
    ["Licensed trustee", yes(s.licensed_trustee_required)],
    ["Enforcer", yes(s.enforcer_required)],
    ["Identity verification of officers", yes(s.identity_verification_required)],
    ["Share capital", s.share_capital === "required" ? "Required" : s.share_capital === "optional" ? "Optional" : "None"],
    [
      "Authorised share capital",
      s.authorised_capital === "required"
        ? "Required: the maximum number of shares is set first"
        : s.authorised_capital === "optional"
          ? "Not required (the constitution may set a maximum)"
          : "None",
    ],
  ];
  const textBlock = (title: string, body: string | null) =>
    body ? (
      <div>
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        <p className="mt-1 whitespace-pre-line text-ink-2">{body}</p>
      </div>
    ) : null;

  return (
    <AppShell
      section="standards"
      crumbs={[["My families", "/"], ["Entity Standards", "/standards"], [s.name]]}
      user={{ name: displayName, roleLabel: systemRole ? SYSTEM_ROLE_LABELS[systemRole] : null, hasTwoFactor }}
    >
      {sp.error && <Toast key={`e-${sp.error}`} kind="error" message={errorMessage(sp.error)!} />}
      {sp.saved && !sp.error && <Toast key={`s-${sp.saved}-${Date.now()}`} message={savedMessage(sp.saved)!} />}
      <PageTitle
        eyebrow={`${ENTITY_TYPES[s.entity_type as EntityType]} · version ${s.version}`}
        title={s.name}
        subtitle={
          s.status === "approved"
            ? `Approved, in force from ${formatDate(s.effective_from)}${s.reviewed_at ? `; last approved ${formatDate(s.reviewed_at.slice(0, 10))}` : ""}.`
            : STATUS_LABELS[s.status]
        }
        actions={
          <Link href="/standards" className="btn-quiet">
            All standards
          </Link>
        }
      />
      <div className="space-y-5">
        {sp.error && <p className="alert">Not saved: {errorMessage(sp.error)}</p>}
        {s.status === "draft" && (
          <p className="rounded-lg border-l-4 border-primary bg-card px-4 py-3 text-ink">
            <strong className="font-semibold">Draft – needs review.</strong> {s.review_note}
          </p>
        )}
        {s.to_confirm && (
          <Card title="Still to confirm" description="Checked by hand or with a local adviser.">
            <p className="whitespace-pre-line text-ink-2">{s.to_confirm}</p>
          </Card>
        )}

        <Card title="Officers and roles" description={s.statute ?? undefined}>
          <Facts items={requirements.filter(([, v]) => v !== null && v !== "Not required")} />
          {s.officers_notes && <p className="mt-4 text-ink-2">{s.officers_notes}</p>}
        </Card>

        <Card title="Reporting">
          <Facts
            items={[
              ["Beneficial ownership", boRuleText(s)],
              ["BO changes reported", s.bo_change_deadline],
              ["Registry notices", s.registry_notice],
              ["Annual meeting", s.agm],
              ["Keep records for", s.record_retention_years ? `${s.record_retention_years} years` : null],
              ["Reviewed every", `${s.review_months} months`],
            ]}
          />
        </Card>

        <Card title="Registers, filings and deadlines">
          <div className="space-y-4">
            {textBlock("Registers and records", s.registers)}
            {textBlock("Recurring filings", s.filings)}
            {textBlock("Event deadlines", s.event_deadlines)}
          </div>
        </Card>

        <Card title="Sources" description={s.last_legal_check ? `Last checked ${formatDate(s.last_legal_check)}.` : undefined}>
          {s.sources.length === 0 ? (
            <p className="text-ink-3">No sources recorded yet.</p>
          ) : (
            <ul className="list-disc space-y-1 pl-5">
              {s.sources.map((src) => (
                <li key={src.url}>
                  <a href={src.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline">
                    {src.label}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {canApprove && s.status !== "retired" && (
          <Card title="Review">
            <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
              {s.status === "draft" && (
                <form action={approveStandard.bind(null, s.id)}>
                  <SubmitButton pendingText="Approving…">Approve this standard</SubmitButton>
                </form>
              )}
              <Fold label="Change the rules">
                <form action={saveStandard.bind(null, s.id)} className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="Directors (minimum)" name="min_directors" type="number" defaultValue={s.min_directors} />
                    <Field label="Resident directors (minimum)" name="min_resident_directors" type="number" defaultValue={s.min_resident_directors} />
                    <Field label="Trustees (minimum)" name="min_trustees" type="number" defaultValue={s.min_trustees} />
                    <Field label="Council members (minimum)" name="min_council_members" type="number" defaultValue={s.min_council_members} />
                    <Field label="Resident council members (minimum)" name="min_resident_council_members" type="number" defaultValue={s.min_resident_council_members} />
                    <Field label="Designated members (minimum)" name="min_designated_members" type="number" defaultValue={s.min_designated_members} />
                  </div>
                  <div className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
                    <Checkbox label="Registered office" name="registered_office_required" defaultChecked={s.registered_office_required} />
                    <Checkbox label="Company secretary" name="secretary_required" defaultChecked={s.secretary_required} />
                    <Checkbox label="Registered agent" name="registered_agent_required" defaultChecked={s.registered_agent_required} />
                    <Checkbox label="Nominated officer" name="nominated_officer_required" defaultChecked={s.nominated_officer_required} />
                    <Checkbox label="Management company" name="management_company_required" defaultChecked={s.management_company_required} />
                    <Checkbox label="Public officer" name="public_officer_required" defaultChecked={s.public_officer_required} />
                    <Checkbox label="Auditor" name="auditor_required" defaultChecked={s.auditor_required} />
                    <Checkbox label="Accounting officer" name="accounting_officer_required" defaultChecked={s.accounting_officer_required} />
                    <Checkbox label="Licensed trustee" name="licensed_trustee_required" defaultChecked={s.licensed_trustee_required} />
                    <Checkbox label="Enforcer" name="enforcer_required" defaultChecked={s.enforcer_required} />
                    <Checkbox label="Identity verification" name="identity_verification_required" defaultChecked={s.identity_verification_required} />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Select label="Share capital" name="share_capital" options={{ required: "Required", optional: "Optional", none: "None" }} defaultValue={s.share_capital} />
                    <Select
                      label="Authorised share capital"
                      name="authorised_capital"
                      options={{ required: "Required", optional: "Not required, may be set", none: "None" }}
                      defaultValue={s.authorised_capital}
                    />
                    <Select
                      label="Beneficial ownership rule"
                      name="bo_rule"
                      options={{ at_least: "At least the threshold", more_than: "More than the threshold", everyone: "Everyone (no threshold)" }}
                      defaultValue={s.bo_rule}
                    />
                    <Field label="BO threshold (%)" name="bo_threshold_percent" type="number" defaultValue={s.bo_threshold_percent} />
                    <Field label="BO changes reported within" name="bo_change_deadline" defaultValue={s.bo_change_deadline} />
                    <Field label="Registry notices within" name="registry_notice" defaultValue={s.registry_notice} />
                    <Field label="Annual meeting" name="agm" defaultValue={s.agm} />
                    <Field label="Keep records for (years)" name="record_retention_years" type="number" defaultValue={s.record_retention_years} />
                    <Field label="Law last checked" name="last_legal_check" type="date" defaultValue={s.last_legal_check} />
                    <Field label="Law" name="statute" defaultValue={s.statute} />
                  </div>
                  {(
                    [
                      ["officers_notes", "Officers and roles (notes)", s.officers_notes],
                      ["registers", "Registers and records", s.registers],
                      ["filings", "Recurring filings", s.filings],
                      ["event_deadlines", "Event deadlines", s.event_deadlines],
                      ["to_confirm", "Still to confirm", s.to_confirm],
                      ["review_note", "Review note", s.review_note],
                    ] as const
                  ).map(([name, label, value]) => (
                    <div key={name}>
                      <label htmlFor={name} className="mb-1 block text-sm font-medium text-ink">
                        {label}
                      </label>
                      <textarea id={name} name={name} rows={3} defaultValue={value ?? ""} className="text-area" />
                    </div>
                  ))}
                  <SubmitButton>Save the rules</SubmitButton>
                </form>
              </Fold>
              <Fold label="Retire this standard" danger>
                <p className="text-sm text-ink-2">A retired standard is kept on record for the entities that used it, but isn&apos;t used for new entities.</p>
                <form action={retireStandard.bind(null, s.id)} className="mt-3">
                  <SubmitButton pendingText="Retiring…">Yes, retire it</SubmitButton>
                </form>
              </Fold>
            </div>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
