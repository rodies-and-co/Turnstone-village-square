import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { needsTwoFactor, type FamilyRole, type SystemRole } from "@/lib/roles";

// Checks the signed-in user may go past the sign-in steps, and returns a hub
// client for them. Sends them to the right page if not:
// - not signed in -> /login
// - has two-factor set up but hasn't entered a code this session -> /mfa
// - needs two-factor (everyone except Viewers) but hasn't set it up -> /mfa
export async function requireSignedIn() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const hasTwoFactor = aal?.currentLevel === "aal2";
  const hasFactor = aal?.nextLevel === "aal2";
  if (hasFactor && !hasTwoFactor) redirect("/mfa");

  // Before two-factor the database hides staff rows and family roles from
  // staff, so read the user's own rows (always visible to them).
  const { data: staff } = await supabase
    .from("staff")
    .select("display_name, system_role")
    .eq("user_id", user.id)
    .maybeSingle();
  const { data: access } = await supabase.from("family_access").select("family_id, role").eq("user_id", user.id);

  const systemRole = (staff?.system_role ?? null) as SystemRole | null;
  const familyRoles = (access ?? []).map((a) => a.role as FamilyRole);

  if (needsTwoFactor({ systemRole, familyRoles, hasFactor }) && !hasTwoFactor) redirect("/mfa");

  return {
    supabase,
    user,
    hasTwoFactor,
    systemRole,
    displayName: staff?.display_name ?? user.email ?? "",
    familyRoles: new Map((access ?? []).map((a) => [a.family_id as string, a.role as FamilyRole])),
  };
}
