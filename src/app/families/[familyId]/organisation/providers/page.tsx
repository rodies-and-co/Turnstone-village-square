import Link from "next/link";
import { AppShell, PageTitle } from "@/components/AppShell";
import { ConfirmRemove, SubmitButton, Toast } from "@/components/feedback";
import { Card, Chip, Facts, Field, Fold, Notice, Select } from "@/components/ui";
import { APPOINTMENT_ROLES, type AppointmentRole } from "@/lib/entity-checklist";
import { getFamilyContext } from "@/lib/family-context";
import { formatDate } from "@/lib/governance";
import { errorMessage, savedMessage } from "@/lib/messages";
import { formatAddress } from "@/lib/people";
import { addProvider, removeProvider, updateProvider } from "../provider-actions";
import { PROVIDER_KINDS } from "@/lib/providers";

export const dynamic = "force-dynamic";

type Provider = {
  id: string;
  name: string;
  kind: string;
  jurisdiction: string | null;
  registration_number: string | null;
  incorporated_on: string | null;
  licensed: boolean;
  licence_number: string | null;
  regulator: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  address_id: string | null;
};
type Addr = { id: string; line1: string; line2: string | null; city: string; region: string | null; postal_code: string | null; country: string };

const KIND_LABELS = Object.fromEntries(PROVIDER_KINDS);

// The fields of a provider; `p` fills them in when changing one.
function ProviderFields({ p, address }: { p?: Provider; address?: Addr }) {
  const id = (n: string) => `${n}-${p?.id ?? "new"}`;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field id={id("name")} label="Name" name="name" required defaultValue={p?.name} />
        <Select id={id("kind")} label="Kind" name="kind" options={PROVIDER_KINDS} defaultValue={p?.kind ?? "registered_agent"} />
        <Field id={id("jurisdiction")} label="Jurisdiction" name="jurisdiction" defaultValue={p?.jurisdiction} />
        <Field id={id("registration_number")} label="Registration number" name="registration_number" defaultValue={p?.registration_number} />
        <Field id={id("incorporated_on")} label="Date of incorporation" name="incorporated_on" type="date" defaultValue={p?.incorporated_on} />
      </div>
      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-medium text-ink">Licence</legend>
        <label className="flex min-h-11 items-center gap-3 text-ink">
          <input type="checkbox" name="licensed" defaultChecked={p?.licensed} className="h-5 w-5" />
          Licensed (e.g. a licensed trust company, corporate services provider or registered agent)
        </label>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field id={id("licence_number")} label="Licence number" name="licence_number" defaultValue={p?.licence_number} />
          <Field id={id("regulator")} label="Regulator" name="regulator" defaultValue={p?.regulator} hint="e.g. the Isle of Man FSA" />
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field id={id("contact_name")} label="Contact person" name="contact_name" defaultValue={p?.contact_name} />
        <Field id={id("email")} label="Email" name="email" type="email" defaultValue={p?.email} />
        <Field id={id("phone")} label="Phone" name="phone" defaultValue={p?.phone} />
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-ink">Address{address ? `: ${formatAddress(address)}` : ""}</legend>
        <p className="mb-2 text-xs text-ink-3">{address ? "Type a new address only to change it." : "Optional."}</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field id={id("line1")} label="First line" name="line1" />
          <Field id={id("line2")} label="Second line" name="line2" />
          <Field id={id("city")} label="Town or city" name="city" />
          <Field id={id("region")} label="County, state or region" name="region" />
          <Field id={id("postal_code")} label="Postcode" name="postal_code" />
          <Field id={id("country")} label="Country" name="country" />
        </div>
      </fieldset>
      <Field id={id("notes")} label="Notes" name="notes" defaultValue={p?.notes} />
    </div>
  );
}

export default async function ProvidersPage({
  params,
  searchParams,
}: {
  params: Promise<{ familyId: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { familyId } = await params;
  const sp = await searchParams;
  const ctx = await getFamilyContext(familyId);
  const familyName = /family$/i.test(ctx.family.name.trim()) ? ctx.family.name : `${ctx.family.name} family`;

  let providers: Provider[] = [];
  let entities = new Map<string, string>();
  let appts: { entity_id: string; role: AppointmentRole; organisation_id: string; ceased_on: string | null }[] = [];
  let addresses = new Map<string, Addr>();
  if (ctx.db) {
    const [p, e, a] = await Promise.all([
      ctx.db.from("outside_organisations").select("*").order("name"),
      ctx.db.from("entities").select("id, name"),
      ctx.db.from("appointments").select("entity_id, role, organisation_id, ceased_on").not("organisation_id", "is", null),
    ]);
    providers = (p.data ?? []) as Provider[];
    entities = new Map(((e.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]));
    appts = (a.data ?? []) as typeof appts;
    const ids = providers.map((x) => x.address_id).filter(Boolean) as string[];
    if (ids.length) {
      const { data } = await ctx.db.from("addresses").select("id, line1, line2, city, region, postal_code, country").in("id", ids);
      addresses = new Map(((data ?? []) as Addr[]).map((x) => [x.id, x]));
    }
  }

  return (
    <AppShell
      family={{ id: familyId, name: ctx.family.name }}
      section="organisation"
      crumbs={[["My families", "/"], [familyName, `/families/${familyId}`], ["The Organisation", `/families/${familyId}/organisation`], ["Service providers"]]}
      user={{ name: ctx.displayName, roleLabel: ctx.roleLabel, hasTwoFactor: ctx.hasTwoFactor }}
    >
      {sp.error && <Toast key={`e-${sp.error}-${Date.now()}`} kind="error" message={errorMessage(sp.error)!} />}
      {sp.saved && !sp.error && <Toast key={`s-${sp.saved}-${Date.now()}`} message={savedMessage(sp.saved)!} />}
      <PageTitle
        eyebrow="The Organisation"
        title="Service providers"
        subtitle="The firms that serve the family's entities: registered agents, trust companies, corporate directors and secretaries, auditors. Each is recorded once and chosen wherever it is appointed."
        actions={
          <Link href={`/families/${familyId}/organisation`} className="btn-quiet">
            Back to the Organisation
          </Link>
        }
      />
      <div className="space-y-5">
        {sp.error && <p className="alert">Not saved: {errorMessage(sp.error)}</p>}
        {ctx.canEdit && (
          <Card title="Add a service provider">
            <Fold label="Add a service provider">
              <form action={addProvider.bind(null, familyId)} className="space-y-5">
                <ProviderFields />
                <SubmitButton pendingText="Adding…">Add provider</SubmitButton>
              </form>
            </Fold>
          </Card>
        )}
        {providers.length === 0 && <Notice>No service providers recorded yet.</Notice>}
        {providers.map((p) => {
          const mine = appts.filter((a) => a.organisation_id === p.id);
          const current = mine.filter((a) => !a.ceased_on);
          const address = p.address_id ? addresses.get(p.address_id) : undefined;
          return (
            <div key={p.id} id={`p-${p.id}`} className="scroll-mt-6">
              <Card
                title={p.name}
                description={
                  <span className="flex flex-wrap items-center gap-2">
                    {KIND_LABELS[p.kind] ?? "Other"}
                    {p.jurisdiction ? ` · ${p.jurisdiction}` : ""}
                    {p.licensed ? <Chip>Licensed</Chip> : <Chip>Not recorded as licensed</Chip>}
                  </span>
                }
              >
                <Facts
                  items={[
                    ["Registration number", p.registration_number],
                    ["Date of incorporation", formatDate(p.incorporated_on)],
                    ["Licence", p.licensed ? [p.licence_number, p.regulator].filter(Boolean).join(", ") || "Licensed" : null],
                    ["Contact", [p.contact_name, p.email, p.phone].filter(Boolean).join(" · ")],
                    ["Address", address ? formatAddress(address) : null],
                  ]}
                />
                <h3 className="mt-5 text-sm font-semibold text-ink">Serves</h3>
                {current.length === 0 ? (
                  <p className="text-sm text-ink-3">No current appointments{mine.length ? ` (${mine.length} past)` : ""}.</p>
                ) : (
                  <ul className="mt-1 space-y-1 text-[15px] text-ink">
                    {current.map((a, i) => (
                      <li key={`${a.entity_id}-${a.role}-${i}`}>
                        {APPOINTMENT_ROLES[a.role]} of{" "}
                        {entities.has(a.entity_id) ? (
                          <Link href={`/families/${familyId}/organisation/${a.entity_id}?tab=officers`} className="underline decoration-border underline-offset-4 hover:decoration-ink">
                            {entities.get(a.entity_id)}
                          </Link>
                        ) : (
                          "an entity you can't see"
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {ctx.canEdit && (
                  <div className="mt-4 flex flex-wrap items-start gap-4">
                    <div className="min-w-0 flex-1">
                      <Fold label="Change details">
                        <form action={updateProvider.bind(null, familyId, p.id)} className="space-y-5">
                          <ProviderFields p={p} address={address} />
                          <SubmitButton>Save changes</SubmitButton>
                        </form>
                      </Fold>
                    </div>
                    <ConfirmRemove action={removeProvider.bind(null, familyId, p.id)} what={p.name} />
                  </div>
                )}
              </Card>
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
