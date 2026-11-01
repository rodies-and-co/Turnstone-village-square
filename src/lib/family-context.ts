import { notFound } from "next/navigation";
import { requireSignedIn } from "@/lib/auth";
import { openFamilyDatabase } from "@/lib/family-db";
import { roleInFamily } from "@/lib/roles";

export type EffectiveRole = "super_user" | "manager" | "administrator" | "viewer" | null;

// Everything a family page needs: the family (from the hub), its own database
// opened as the signed-in person, and what this person may do. The family
// database enforces the same rules; these flags only decide what to show.
export async function getFamilyContext(familyId: string) {
  const session = await requireSignedIn();
  const { supabase, systemRole, familyRoles } = session;

  const { data: family } = await supabase
    .from("families")
    .select("id, name, database_url, database_publishable_key")
    .eq("id", familyId)
    .maybeSingle();
  if (!family) notFound();

  const familyRole = familyRoles.get(family.id) ?? null;
  const role: EffectiveRole = systemRole === "super_user" ? "super_user" : familyRole;
  const db = await openFamilyDatabase(family);

  return {
    ...session,
    family,
    db,
    role,
    roleLabel: roleInFamily(systemRole, familyRole),
    canEdit: role === "super_user" || role === "manager" || role === "administrator",
    canManage: role === "super_user" || role === "manager",
  };
}

export type FamilyContext = Awaited<ReturnType<typeof getFamilyContext>>;
