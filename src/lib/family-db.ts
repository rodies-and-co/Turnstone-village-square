import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient as createHubClient } from "@/lib/supabase/server";

export type FamilyConnection = {
  id: string;
  name: string;
  database_url: string | null;
  database_publishable_key: string | null;
};

// Opens one family's own database as the signed-in user. It sends the user's
// hub sign-in token; the family database checks it was issued by the hub and
// applies its own security rules. No secret keys are used.
export async function openFamilyDatabase(family: FamilyConnection) {
  if (!family.database_url || !family.database_publishable_key) return null;

  const hub = await createHubClient();
  const {
    data: { session },
  } = await hub.auth.getSession();
  if (!session) return null;

  return createSupabaseClient(family.database_url, family.database_publishable_key, {
    accessToken: async () => session.access_token,
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
