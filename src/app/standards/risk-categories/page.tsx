import { AppShell, PageTitle } from "@/components/AppShell";
import { SubmitButton, Toast } from "@/components/feedback";
import { Card, Checkbox, Chip, Field, Fold } from "@/components/ui";
import { requireSignedIn } from "@/lib/auth";
import { errorMessage, savedMessage } from "@/lib/messages";
import { SYSTEM_ROLE_LABELS } from "@/lib/roles";
import { TextArea } from "@/app/families/[familyId]/meetings/DecisionsArea";
import { addCategory, saveCategory } from "./actions";

export const dynamic = "force-dynamic";

type Category = { key: string; name: string; description: string | null; subcategories: string[]; sort: number; active: boolean; to_confirm: boolean };

// The categories every family's risk register uses. They started as the
// UHNW Institute's ten domains of family wealth, marked "to confirm".
export default async function RiskCategoriesPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const sp = await searchParams;
  const { supabase, systemRole, displayName, hasTwoFactor } = await requireSignedIn();
  const { data } = await supabase.from("risk_categories").select("*").order("sort").order("name");
  const cats = (data ?? []) as Category[];
  const canChange = systemRole === "super_user" || systemRole === "system_admin";

  return (
    <AppShell
      section="standards"
      crumbs={[["My families", "/"], ["Entity Standards", "/standards"], ["Risk categories"]]}
      user={{ name: displayName, roleLabel: systemRole ? SYSTEM_ROLE_LABELS[systemRole] : null, hasTwoFactor }}
    >
      {sp.error && <Toast key={`e-${sp.error}-${Date.now()}`} kind="error" message={errorMessage(sp.error)!} />}
      {sp.saved && !sp.error && <Toast key={`s-${sp.saved}-${Date.now()}`} message={savedMessage(sp.saved)!} />}
      <PageTitle
        eyebrow="Shared by every family"
        title="Risk categories"
        subtitle="The categories and subcategories every family's risk register uses. A category is retired, never deleted, so risks filed under it keep it."
      />
      <div className="space-y-5">
        {sp.error && <p className="alert">Not saved: {errorMessage(sp.error)}</p>}
        {cats.map((c) => (
          <Card key={c.key} title={c.name} description={c.description ?? undefined} actions={<span className="flex gap-2">{c.to_confirm && <Chip>To confirm</Chip>}{!c.active && <Chip>Retired</Chip>}</span>}>
            <ul className="flex flex-wrap gap-2">
              {c.subcategories.map((s) => (
                <li key={s} className="rounded-full border border-border bg-white px-3 py-1 text-sm text-ink">
                  {s}
                </li>
              ))}
            </ul>
            {canChange && (
              <Fold label="Change">
                <form action={saveCategory.bind(null, c.key)} className="space-y-4">
                  <Field id={`${c.key}-name`} label="Name" name="name" required defaultValue={c.name} />
                  <TextArea id={`${c.key}-description`} label="Description" name="description" defaultValue={c.description} rows={2} />
                  <TextArea id={`${c.key}-subs`} label="Subcategories (one per line)" name="subcategories" defaultValue={c.subcategories.join("\n")} rows={5} />
                  <Field id={`${c.key}-sort`} label="Order in lists" name="sort" type="number" defaultValue={c.sort} />
                  <Checkbox label="In use (untick to retire it)" name="active" defaultChecked={c.active} />
                  <Checkbox label="Still to confirm" name="to_confirm" defaultChecked={c.to_confirm} />
                  <SubmitButton>Save</SubmitButton>
                </form>
              </Fold>
            )}
          </Card>
        ))}
        {canChange && (
          <Card title="Add a category">
            <Fold label="Add a category">
              <form action={addCategory} className="space-y-4">
                <Field id="new-name" label="Name" name="name" required />
                <TextArea id="new-description" label="Description" name="description" rows={2} />
                <TextArea id="new-subs" label="Subcategories (one per line)" name="subcategories" rows={5} />
                <Field id="new-sort" label="Order in lists" name="sort" type="number" defaultValue={200} />
                <SubmitButton>Add the category</SubmitButton>
              </form>
            </Fold>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
