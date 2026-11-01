import Link from "next/link";
import { AppShell, PageTitle } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireSignedIn } from "@/lib/auth";
import { SYSTEM_ROLE_LABELS, roleInFamily } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { supabase, systemRole, displayName, hasTwoFactor, familyRoles } = await requireSignedIn();

  // The hub only returns the families this person may open.
  const { data: families } = await supabase.from("families").select("id, name, status, database_url").order("name");
  const list = families ?? [];

  return (
    <AppShell
      crumbs={[["My families"]]}
      user={{ name: displayName, roleLabel: systemRole ? SYSTEM_ROLE_LABELS[systemRole] : null, hasTwoFactor }}
    >
      <PageTitle title="My families" subtitle="The families you work with. Each family's records are kept in its own database." />
      <div className="max-w-3xl">
        <Card>
          {list.length === 0 ? (
            <p className="text-ink">You don&apos;t have access to any family yet. Ask your Manager or the Turnstone team.</p>
          ) : (
            <ul className="divide-y divide-border">
              {list.map((f) => {
                const role = roleInFamily(systemRole, familyRoles.get(f.id) ?? null);
                const name = /family$/i.test(f.name.trim()) ? f.name : `${f.name} family`;
                return (
                  <li key={f.id}>
                    <Link href={`/families/${f.id}`} className="-mx-2 flex min-h-16 flex-wrap items-center justify-between gap-2 rounded-md px-2 py-3 hover:bg-muted">
                      <span>
                        <span className="block text-[17px] font-semibold text-ink">{name}</span>
                        <span className="block text-sm text-ink-3">
                          {f.status === "archived" ? "Archived · " : ""}
                          {f.database_url ? "Database connected" : "Database not connected yet"}
                        </span>
                      </span>
                      {role && <span className="text-sm text-ink-2">{role}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
