import { ConfirmRemove, SubmitButton } from "@/components/feedback";
import { Card, Field, Fold, Row, Rows, Select } from "@/components/ui";
import { getFamilyContext } from "@/lib/family-context";
import { PROFESSIONS, formatDate } from "@/lib/governance";
import { BranchesFrame } from "../BranchesFrame";
import { addAdvisorRole, removeAdvisor, removeAdvisorRole, saveAdvisor } from "../governance-actions";

export const dynamic = "force-dynamic";

type Advisor = { id: string; full_name: string; firm: string | null; profession: keyof typeof PROFESSIONS; email: string | null; phone: string | null };
type Role = { id: string; advisor_id: string; branch_id: string | null; advises_on: string; from_date: string | null; to_date: string | null };

// One form, used for the whole family's circle and for each branch's: choose
// an advisor already recorded, or add a new one, and say what they advise on.
function AddToCircle({ familyId, branchId, advisors }: { familyId: string; branchId: string | null; advisors: Advisor[] }) {
  const suffix = branchId ?? "family";
  return (
    <form action={addAdvisorRole.bind(null, familyId)} className="space-y-4">
      <input type="hidden" name="branch_id" value={branchId ?? ""} />
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <Field id={`advises_on-${suffix}`} label="Advises on" name="advises_on" required hint="e.g. Trusts and estate planning, the family company's tax, succession" />
        <Field id={`from_date-${suffix}`} label="Since" name="from_date" type="date" />
      </div>
      {advisors.length > 0 && (
        <Select
          id={`advisor_id-${suffix}`}
          label="An advisor already recorded"
          name="advisor_id"
          options={advisors.map((a) => [a.id, `${a.full_name}${a.firm ? `, ${a.firm}` : ""}`] as [string, string])}
          includeBlank="None: a new advisor (fill in below)"
        />
      )}
      <fieldset className="rounded-lg border border-border p-4">
        <legend className="px-1 text-sm font-medium text-ink">{advisors.length ? "Or a new advisor" : "The advisor"}</legend>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label htmlFor={`full_name-${suffix}`} className="mb-1 block text-sm font-medium text-ink">
              Name
            </label>
            <input id={`full_name-${suffix}`} name="full_name" className="text-input" />
          </div>
          <div>
            <label htmlFor={`firm-${suffix}`} className="mb-1 block text-sm font-medium text-ink">
              Firm
            </label>
            <input id={`firm-${suffix}`} name="firm" className="text-input" />
          </div>
          <div>
            <label htmlFor={`profession-${suffix}`} className="mb-1 block text-sm font-medium text-ink">
              Profession
            </label>
            <select id={`profession-${suffix}`} name="profession" defaultValue="other" className="text-input">
              {Object.entries(PROFESSIONS).map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`email-${suffix}`} className="mb-1 block text-sm font-medium text-ink">
              Email
            </label>
            <input id={`email-${suffix}`} name="email" type="email" className="text-input" />
          </div>
          <div>
            <label htmlFor={`phone-${suffix}`} className="mb-1 block text-sm font-medium text-ink">
              Phone
            </label>
            <input id={`phone-${suffix}`} name="phone" type="tel" className="text-input" />
          </div>
        </div>
      </fieldset>
      <SubmitButton pendingText="Adding…">Add to the circle</SubmitButton>
    </form>
  );
}

export default async function AdvisorsPage({
  params,
  searchParams,
}: {
  params: Promise<{ familyId: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { familyId } = await params;
  const sp = await searchParams;
  const ctx = await getFamilyContext(familyId);

  let advisors: Advisor[] = [];
  let roles: Role[] = [];
  let branches: { id: string; name: string }[] = [];
  if (ctx.db) {
    const [a, r, b] = await Promise.all([
      ctx.db.from("advisors").select("id, full_name, firm, profession, email, phone").order("full_name"),
      ctx.db.from("advisor_roles").select("id, advisor_id, branch_id, advises_on, from_date, to_date"),
      ctx.db.from("branches").select("id, name").order("name"),
    ]);
    advisors = (a.data ?? []) as Advisor[];
    roles = (r.data ?? []) as Role[];
    branches = (b.data ?? []) as typeof branches;
  }
  const byId = new Map(advisors.map((a) => [a.id, a]));

  const circle = (branchId: string | null, title: string, description: string) => {
    const rows = roles.filter((r) => (r.branch_id ?? null) === branchId);
    return (
      <Card key={branchId ?? "family"} title={title} description={description}>
        {rows.length === 0 ? (
          <p className="border-y border-border py-3 text-ink-3">Nobody recorded yet.</p>
        ) : (
          <Rows>
            {rows.map((r) => {
              const a = byId.get(r.advisor_id);
              return (
                <Row
                  key={r.id}
                  title={a ? `${a.full_name}${a.firm ? `, ${a.firm}` : ""}` : "Advisor"}
                  meta={[a ? PROFESSIONS[a.profession] : null, r.advises_on, r.from_date ? `Since ${formatDate(r.from_date)}` : null].filter(Boolean).join(" · ")}
                >
                  {ctx.canEdit && <ConfirmRemove action={removeAdvisorRole.bind(null, familyId, r.id)} what={`${a?.full_name ?? "this advisor"} from this circle`} label="Take out" asks />}
                </Row>
              );
            })}
          </Rows>
        )}
        {ctx.canEdit && (
          <Fold label="Add an advisor to this circle">
            <AddToCircle familyId={familyId} branchId={branchId} advisors={advisors} />
          </Fold>
        )}
      </Card>
    );
  };

  return (
    <BranchesFrame ctx={ctx} familyId={familyId} tab="advisors" saved={sp.saved} error={sp.error}>
      {circle(null, "The whole family's advisors", "Advisors who serve the family as a whole.")}
      {/* Viewers only get the branch circles they may see, so empty ones are left out for them. */}
      {branches
        .filter((b) => ctx.canEdit || roles.some((r) => r.branch_id === b.id))
        .map((b) => circle(b.id, `${b.name}: advisors`, `Advisors who serve this branch only.`))}

      {advisors.length > 0 && (
        <Card title="Advisors' contact details" description="Each advisor is recorded once, however many circles they are in.">
          <Rows>
            {advisors.map((a) => (
              <li key={a.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <div className="min-w-0">
                    <div className="text-[15px] font-medium text-ink">
                      {a.full_name}
                      {a.firm ? `, ${a.firm}` : ""}
                    </div>
                    <div className="text-sm text-ink-3">{[PROFESSIONS[a.profession], a.email, a.phone].filter(Boolean).join(" · ")}</div>
                  </div>
                  {ctx.canEdit && <ConfirmRemove action={removeAdvisor.bind(null, familyId, a.id)} what={`${a.full_name} and every circle they are in`} />}
                </div>
                {ctx.canEdit && (
                  <Fold label="Change the details">
                    <form action={saveAdvisor.bind(null, familyId, a.id)} className="space-y-4">
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        <Field id={`a-name-${a.id}`} label="Name" name="full_name" defaultValue={a.full_name} required />
                        <Field id={`a-firm-${a.id}`} label="Firm" name="firm" defaultValue={a.firm} />
                        <Select id={`a-prof-${a.id}`} label="Profession" name="profession" options={PROFESSIONS} defaultValue={a.profession} />
                        <Field id={`a-email-${a.id}`} label="Email" name="email" type="email" defaultValue={a.email} />
                        <Field id={`a-phone-${a.id}`} label="Phone" name="phone" type="tel" defaultValue={a.phone} />
                      </div>
                      <SubmitButton>Save changes</SubmitButton>
                    </form>
                  </Fold>
                )}
              </li>
            ))}
          </Rows>
        </Card>
      )}
    </BranchesFrame>
  );
}
