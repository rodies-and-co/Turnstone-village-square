import { ConfirmRemove, SubmitButton } from "@/components/feedback";
import { Card, Chip, Field, Fold, Select } from "@/components/ui";
import { getFamilyContext } from "@/lib/family-context";
import { STATEMENT_HINTS, STATEMENT_KINDS, formatDate } from "@/lib/governance";
import { BranchesFrame } from "../BranchesFrame";
import { addStatement, adoptStatement, removeStatement, saveStatement, withdrawStatement } from "../governance-actions";

export const dynamic = "force-dynamic";

type Statement = {
  id: string;
  kind: keyof typeof STATEMENT_KINDS;
  branch_id: string | null;
  title: string;
  body: string;
  status: "draft" | "adopted";
  prepared_by: string | null;
  adopted_on: string | null;
};

const KIND_ORDER = Object.keys(STATEMENT_KINDS);

export default async function ValuesPage({
  params,
  searchParams,
}: {
  params: Promise<{ familyId: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { familyId } = await params;
  const sp = await searchParams;
  const ctx = await getFamilyContext(familyId);
  const me = ctx.user?.id ?? null;

  let statements: Statement[] = [];
  let branches: { id: string; name: string }[] = [];
  if (ctx.db) {
    const [s, b] = await Promise.all([
      ctx.db.from("family_statements").select("id, kind, branch_id, title, body, status, prepared_by, adopted_on"),
      ctx.db.from("branches").select("id, name").order("name"),
    ]);
    statements = ((s.data ?? []) as Statement[]).sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.title.localeCompare(b.title));
    branches = (b.data ?? []) as typeof branches;
  }
  const scopeOptions: [string, string][] = [["", "Whole family"], ...branches.map((b) => [b.id, b.name] as [string, string])];

  const statement = (s: Statement) => (
    <article key={s.id} className="border-t border-border py-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[17px] font-semibold text-ink">{s.title}</h3>
        <Chip>{STATEMENT_KINDS[s.kind]}</Chip>
        <span className="text-sm text-ink-2">{s.status === "adopted" ? `Adopted ${formatDate(s.adopted_on)}` : "Draft: not adopted yet"}</span>
      </div>
      <p className="mt-2 whitespace-pre-line text-ink">{s.body}</p>

      <div className="mt-2 flex flex-wrap items-center gap-x-6">
        {ctx.canManage && s.status === "draft" && s.prepared_by !== me && (
          <form action={adoptStatement.bind(null, familyId, s.id)}>
            <SubmitButton pendingText="Adopting…">Adopt</SubmitButton>
          </form>
        )}
        {ctx.canManage && s.status === "draft" && s.prepared_by === me && (
          <p className="text-sm text-ink-3">You prepared this wording, so another Manager adopts it.</p>
        )}
        {ctx.canEdit && (
          <Fold label="Change the wording">
            <form action={saveStatement.bind(null, familyId, s.id)} className="space-y-4">
              <Field id={`title-${s.id}`} label="Title" name="title" defaultValue={s.title} required />
              <div>
                <label htmlFor={`body-${s.id}`} className="mb-1 block text-sm font-medium text-ink">
                  Wording (required)
                </label>
                <textarea id={`body-${s.id}`} name="body" rows={5} required defaultValue={s.body} className="text-area" />
              </div>
              {s.status === "adopted" && <p className="text-sm text-ink-3">Changing the wording makes it a draft again, to be adopted afresh.</p>}
              <SubmitButton>Save wording</SubmitButton>
            </form>
          </Fold>
        )}
        {ctx.canManage && s.status === "adopted" && (
          <ConfirmRemove action={withdrawStatement.bind(null, familyId, s.id)} what={`the adoption of “${s.title}”`} label="Withdraw" />
        )}
        {ctx.canManage && <ConfirmRemove action={removeStatement.bind(null, familyId, s.id)} what={`“${s.title}”`} />}
      </div>
    </article>
  );

  const group = (branchId: string | null, title: string) => {
    const list = statements.filter((s) => (s.branch_id ?? null) === branchId);
    if (branchId && list.length === 0) return null;
    return (
      <Card key={branchId ?? "family"} title={title}>
        {list.length === 0 ? <p className="border-y border-border py-3 text-ink-3">Nothing recorded yet.</p> : <div>{list.map(statement)}</div>}
      </Card>
    );
  };

  return (
    <BranchesFrame ctx={ctx} familyId={familyId} tab="values" saved={sp.saved} error={sp.error}>
      {group(null, "The whole family")}
      {branches.map((b) => group(b.id, b.name))}

      {ctx.canEdit && (
        <Card title="Add a statement">
          <Fold label="Add a purpose, value, arrangement or guidance" open={statements.length === 0}>
            <form action={addStatement.bind(null, familyId)} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <Select label="Kind" name="kind" options={STATEMENT_KINDS} includeBlank="Choose…" required />
                <Field label="Title" name="title" hint="Leave empty to use the kind, e.g. “Values”." />
                <Select label="For" name="branch_id" options={scopeOptions} />
              </div>
              <div>
                <label htmlFor="body" className="mb-1 block text-sm font-medium text-ink">
                  Wording (required)
                </label>
                <textarea id="body" name="body" rows={5} required className="text-area" />
              </div>
              <ul className="space-y-1 text-xs text-ink-3">
                {Object.entries(STATEMENT_HINTS).map(([k, h]) => (
                  <li key={k}>
                    <strong className="font-medium text-ink-2">{STATEMENT_KINDS[k as keyof typeof STATEMENT_KINDS]}:</strong> {h}
                  </li>
                ))}
              </ul>
              <p className="text-sm text-ink-3">It is saved as a draft. A Manager who didn&apos;t prepare it adopts it.</p>
              <SubmitButton pendingText="Adding…">Add statement</SubmitButton>
            </form>
          </Fold>
        </Card>
      )}
    </BranchesFrame>
  );
}
