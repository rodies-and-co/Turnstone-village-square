import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { requireSignedIn } from "@/lib/auth";
import { SYSTEM_ROLE_LABELS, roleInFamily } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { supabase, systemRole, displayName, hasTwoFactor, familyRoles } = await requireSignedIn();

  // The hub only returns the families this person may open.
  const { data: families } = await supabase
    .from("families")
    .select("id, name, status, database_url")
    .order("name");

  return (
    <>
      <SiteHeader
        name={displayName}
        roleLabel={systemRole ? SYSTEM_ROLE_LABELS[systemRole] : null}
        hasTwoFactor={hasTwoFactor}
      />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-semibold text-ink">Families</h1>

        {(families ?? []).length === 0 ? (
          <p className="mt-6 text-ink">
            You don&apos;t have access to any family yet. Ask your Manager or the Turnstone team.
          </p>
        ) : (
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {(families ?? []).map((f) => {
              const role = roleInFamily(systemRole, familyRoles.get(f.id) ?? null);
              return (
                <li key={f.id} className="rounded-2xl border border-border bg-card p-6">
                  <h2 className="text-lg font-semibold text-ink">{f.name}</h2>
                  <p className="mt-1 text-sm text-ink">
                    {role ? `Your role: ${role}` : null}
                    {f.status === "archived" ? " · Archived" : ""}
                    {!f.database_url ? " · Database not connected yet" : ""}
                  </p>
                  <Link href={`/families/${f.id}`} className="btn-primary mt-4">
                    Open {f.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
