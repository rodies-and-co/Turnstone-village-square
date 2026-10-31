import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { requireSignedIn } from "@/lib/auth";
import { openFamilyDatabase } from "@/lib/family-db";
import { roleInFamily } from "@/lib/roles";

export const dynamic = "force-dynamic";

// The sections of the plan. Each becomes a working page in later stages.
const SECTIONS = [
  { title: "Recording the facts", items: ["The Tree", "The Branches", "The Organisation", "The Story", "The Vault"] },
  { title: "Things to do", items: ["Meetings, resolutions and notes", "Projects", "Dividends and distributions", "Share transactions", "Risk management"] },
  { title: "Organising", items: ["To-do list", "Calendar", "Compliance calendar"] },
  { title: "Reports", items: ["Statutory registers", "Structure charts", "Family and branch timeline", "Risk heat map"] },
  { title: "Village Square", items: ["Help bot", "Ask the Elder", "Circles of advisors"] },
  { title: "Investments", items: ["Portfolios, properties and rentals (built last)"] },
];

export default async function FamilyPage({ params }: { params: Promise<{ familyId: string }> }) {
  const { familyId } = await params;
  const { supabase, systemRole, displayName, hasTwoFactor, familyRoles } = await requireSignedIn();

  const { data: family } = await supabase
    .from("families")
    .select("id, name, database_url, database_publishable_key")
    .eq("id", familyId)
    .maybeSingle();
  if (!family) notFound();

  const role = roleInFamily(systemRole, familyRoles.get(family.id) ?? null);

  // Open the family's own database as this user.
  const familyDb = await openFamilyDatabase(family);
  let status: { connected: boolean; people?: number; branches?: number; nameMatches?: boolean } = {
    connected: false,
  };
  if (familyDb) {
    const { data: settings } = await familyDb.from("family_settings").select("family_id").maybeSingle();
    const { count: people } = await familyDb.from("people").select("id", { count: "exact", head: true });
    const { count: branches } = await familyDb.from("branches").select("id", { count: "exact", head: true });
    status = {
      connected: Boolean(settings),
      nameMatches: settings?.family_id === family.id,
      people: people ?? 0,
      branches: branches ?? 0,
    };
  }

  return (
    <>
      <SiteHeader name={displayName} roleLabel={role} hasTwoFactor={hasTwoFactor} />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <p>
          <Link href="/" className="inline-flex min-h-11 items-center underline">
            All families
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-ink">{family.name}</h1>

        <div className="mt-6 rounded-2xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold text-ink">Family database</h2>
          {!family.database_url ? (
            <p className="mt-2 text-ink">Not connected yet. The Super User adds it in the hub.</p>
          ) : !status.connected ? (
            <p role="alert" className="alert mt-3">
              The family database did not recognise you. If you were just given access, sign out and in
              again. If it keeps happening, ask the Turnstone team to check the setup.
            </p>
          ) : status.nameMatches === false ? (
            <p role="alert" className="alert mt-3">
              This family database belongs to a different family. Ask the Turnstone team to check the
              setup before using it.
            </p>
          ) : (
            <p className="mt-2 text-ink">
              Connected. You can see {status.people} {status.people === 1 ? "person" : "people"} in{" "}
              {status.branches} {status.branches === 1 ? "branch" : "branches"}.
            </p>
          )}
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {SECTIONS.map((s) => (
            <section key={s.title} className="rounded-2xl border border-border bg-card p-6">
              <h2 className="text-lg font-semibold text-ink">{s.title}</h2>
              <ul className="mt-2 list-disc pl-5 text-ink">
                {s.items.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
              <p className="mt-3 text-sm text-ink">Coming in a later stage.</p>
            </section>
          ))}
        </div>
      </main>
    </>
  );
}
