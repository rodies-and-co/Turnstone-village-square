import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { createClient } from "@/lib/supabase/server";
import { needsTwoFactor, type FamilyRole, type SystemRole } from "@/lib/roles";
import { MfaEnroll, MfaVerify } from "./MfaForms";

export default async function MfaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel === "aal2") redirect("/");

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const verified = factors?.totp?.[0];

  // Everyone except Viewers must set up two-factor; Viewers may skip it.
  const { data: staff } = await supabase
    .from("staff")
    .select("system_role")
    .eq("user_id", user.id)
    .maybeSingle();
  const { data: access } = await supabase.from("family_access").select("role").eq("user_id", user.id);
  const required = needsTwoFactor({
    systemRole: (staff?.system_role ?? null) as SystemRole | null,
    familyRoles: (access ?? []).map((a) => a.role as FamilyRole),
    hasFactor: false,
  });

  return (
    <>
      <SiteHeader name={user.email ?? ""} hasTwoFactor />
      <main className="mx-auto max-w-md px-6 py-12">
        <div className="rounded-2xl border border-border bg-card p-8">
          {verified ? (
            <>
              <h1 className="text-2xl font-semibold text-ink">Enter your code</h1>
              <p className="mt-3 text-ink">
                Open your authenticator app and enter the 6-digit code for Turnstone Village Square.
              </p>
              <MfaVerify factorId={verified.id} />
            </>
          ) : (
            <>
              <h1 className="text-2xl font-semibold text-ink">Set up two-factor authentication</h1>
              <p className="mt-3 text-ink">
                Two-factor keeps family information safe even if your password is stolen. It is
                required for Turnstone staff, Managers and Administrators, and optional for family
                members and advisers.
                Once you set it up, you&apos;ll need your code each time you sign in.
              </p>
              <MfaEnroll />
              {!required && (
                <p className="mt-6 text-ink">
                  <Link href="/" className="inline-flex min-h-11 items-center underline">
                    Not now, continue
                  </Link>
                </p>
              )}
            </>
          )}
        </div>
      </main>
    </>
  );
}
