import Link from "next/link";
import { AppShell, PageTitle } from "@/components/AppShell";
import { Toast } from "@/components/feedback";
import { Card } from "@/components/ui";
import { getFamilyContext } from "@/lib/family-context";
import { errorMessage, savedMessage } from "@/lib/messages";
import { RemovalRequests } from "./RemovalRequests";

export const dynamic = "force-dynamic";

// What is still to come, from the plan. Each becomes a tab when it is built.
const LATER = [
  ["Recording the facts", "The Branches, The Organisation, The Story, The Vault"],
  ["Things to do", "Meetings and resolutions, Projects, Dividends and distributions, Share transactions, Risk management"],
  ["Organising", "To-do list, Calendar, Compliance calendar"],
  ["Reports", "Statutory registers, Structure charts, Family and branch timeline, Risk heat map"],
  ["Village Square", "Help bot, Ask the Elder, Circles of advisors"],
  ["Investments", "Portfolios, properties and rentals (built last)"],
];

export default async function FamilyPage({
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

  let status: "not_set_up" | "not_recognised" | "wrong_family" | "ok" = "not_set_up";
  let people = 0;
  let branches: { id: string; name: string; head: string | null; members: number }[] = [];
  if (ctx.db) {
    const [{ data: settings }, { data: ppl }, { data: br }] = await Promise.all([
      ctx.db.from("family_settings").select("family_id").maybeSingle(),
      ctx.db.from("people").select("id, branch_id, known_as, full_names, surname"),
      ctx.db.from("branches").select("id, name, head_person_id").order("name"),
    ]);
    status = !settings ? "not_recognised" : settings.family_id !== ctx.family.id ? "wrong_family" : "ok";
    const list = (ppl ?? []) as { id: string; branch_id: string | null; known_as: string | null; full_names: string; surname: string }[];
    people = list.length;
    branches = ((br ?? []) as { id: string; name: string; head_person_id: string | null }[]).map((b) => {
      const head = list.find((p) => p.id === b.head_person_id);
      return {
        id: b.id,
        name: b.name,
        head: head ? `${head.known_as || head.full_names.split(" ")[0]} ${head.surname}` : null,
        members: list.filter((p) => p.branch_id === b.id).length,
      };
    });
  }

  return (
    <AppShell
      family={{ id: familyId, name: ctx.family.name }}
      section="family-overview"
      crumbs={[["My families", "/"], [familyName]]}
      user={{ name: ctx.displayName, roleLabel: ctx.roleLabel, hasTwoFactor: ctx.hasTwoFactor }}
    >
      {sp.error && <Toast key={`e-${sp.error}-${Date.now()}`} kind="error" message={errorMessage(sp.error)!} />}
      {sp.saved && !sp.error && <Toast key={`s-${sp.saved}-${Date.now()}`} message={savedMessage(sp.saved)!} />}
      <PageTitle eyebrow="Family overview" title={familyName} subtitle={ctx.roleLabel ? `You are ${/^[aeiou]/i.test(ctx.roleLabel) ? "an" : "a"} ${ctx.roleLabel} in this family.` : undefined} />
      {status !== "ok" ? (
        <p role="alert" className="alert">
          {status === "not_set_up"
            ? "This family's database isn't connected yet. The Super User adds it in the hub."
            : status === "wrong_family"
              ? "This family database belongs to a different family. Ask the Turnstone team to check the setup before using it."
              : "The family database did not recognise you. If you were just given access, sign out and in again. If it keeps happening, ask the Turnstone team to check the setup."}
        </p>
      ) : (
        <div className="space-y-6">
        {sp.error && <p className="alert">Not done: {errorMessage(sp.error)}</p>}
        <RemovalRequests ctx={ctx} familyId={familyId} />
        <div className="grid gap-6 md:grid-cols-[1fr_20rem]">
          <Card
            title="The Tree"
            actions={
              <Link href={`/families/${familyId}/tree`} className="btn-primary">
                Open the Tree
              </Link>
            }
          >
            <p className="text-ink-2">
              {people} {people === 1 ? "person" : "people"} you can see, in {branches.length}{" "}
              {branches.length === 1 ? "branch" : "branches"}.
            </p>
            <p className="mt-3">
              <Link href={`/families/${familyId}/branches`} className="underline">
                Open the Branches
              </Link>
            </p>
            {branches.length > 0 && (
              <ul className="mt-4 divide-y divide-border border-y border-border">
                {branches.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <span className="font-medium text-ink">{b.name}</span>
                    <span className="text-sm text-ink-3">
                      {b.head ? `Headed by ${b.head} · ` : ""}
                      {b.members} {b.members === 1 ? "person" : "people"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Coming in later stages">
            <dl className="space-y-3">
              {LATER.map(([h, d]) => (
                <div key={h}>
                  <dt className="font-semibold text-ink">{h}</dt>
                  <dd className="text-sm text-ink-3">{d}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
        </div>
      )}
    </AppShell>
  );
}
