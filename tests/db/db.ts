import { Client } from "pg";

// Three throwaway test databases: the hub and two family databases. They are
// rebuilt from the real migrations before every test run.
export const DB = {
  hub: "vs_hub_test",
  familyA: "vs_family_a_test",
  familyB: "vs_family_b_test",
} as const;
export type DbName = (typeof DB)[keyof typeof DB];

// Fictional families.
export const HARTLEY = "a0000000-0000-4000-8000-000000000001";
export const OKAFOR = "b0000000-0000-4000-8000-000000000001";

export const USERS = {
  superUser: "10000000-0000-4000-8000-000000000001",
  systemAdmin: "20000000-0000-4000-8000-000000000001",
  hartleyManager: "30000000-0000-4000-8000-000000000001",
  hartleyAdministrator: "40000000-0000-4000-8000-000000000001",
  hartleyViewerWholeFamily: "50000000-0000-4000-8000-000000000001",
  hartleyViewerBranch: "50000000-0000-4000-8000-000000000002",
  hartleyViewerOwnRecord: "50000000-0000-4000-8000-000000000003",
  hartleyViewerWithMfa: "50000000-0000-4000-8000-000000000004",
  okaforManager: "60000000-0000-4000-8000-000000000001",
  nobody: "70000000-0000-4000-8000-000000000001",
} as const;

// Fixed ids inside the Hartley family database.
export const HARTLEY_DB = {
  northBranch: "a1000000-0000-4000-8000-000000000001",
  southBranch: "a1000000-0000-4000-8000-000000000002",
  northPerson: "a2000000-0000-4000-8000-000000000001",
  southPerson: "a2000000-0000-4000-8000-000000000002",
  ownPerson: "a2000000-0000-4000-8000-000000000003",
} as const;

// The test database server comes from the environment, never the code.
export function adminUrl() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Point it at a local Postgres server the tests may use.",
    );
  }
  return url;
}

export function dbUrl(name: DbName) {
  const url = new URL(adminUrl());
  url.pathname = `/${name}`;
  return url.toString();
}

export async function connect(name: DbName) {
  const client = new Client({ connectionString: dbUrl(name) });
  await client.connect();
  return client;
}

export type Session =
  | { kind: "anonymous" }
  | { kind: "user"; id: string; aal: "aal1" | "aal2"; claims?: Record<string, unknown> };

// Runs `fn` as if a request came in through the Supabase API with this
// session, then rolls back so tests never affect each other.
export async function as<T>(
  db: Client,
  session: Session,
  fn: (db: Client) => Promise<T>,
): Promise<T> {
  await db.query("begin");
  try {
    if (session.kind === "anonymous") {
      await db.query("set local role anon");
      await db.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`);
    } else {
      const claims = {
        ...(session.claims ?? {}),
        sub: session.id,
        role: "authenticated",
        aal: session.aal,
      };
      await db.query("set local role authenticated");
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify(claims),
      ]);
    }
    return await fn(db);
  } finally {
    await db.query("rollback");
  }
}

// Runs `fn` as the database owner (like the Supabase dashboard), rolled back.
export async function asOwner<T>(db: Client, fn: (db: Client) => Promise<T>) {
  await db.query("begin");
  try {
    return await fn(db);
  } finally {
    await db.query("rollback");
  }
}

// Asks the hub's real sign-in token hook for a user's claims, exactly as
// Supabase Auth would when they sign in.
export const HUB_ISSUER = "https://hub-test.supabase.co/auth/v1";

export async function hubClaims(hub: Client, userId: string) {
  await hub.query("begin");
  try {
    await hub.query("set local role supabase_auth_admin");
    const { rows } = await hub.query(
      "select public.custom_access_token_hook($1::jsonb) as result",
      [JSON.stringify({ user_id: userId, claims: { sub: userId, role: "authenticated", iss: HUB_ISSUER } })],
    );
    return rows[0].result.claims as Record<string, unknown>;
  } finally {
    await hub.query("rollback");
  }
}

export async function count(client: Client, sql: string, params: unknown[] = []) {
  const { rows } = await client.query(`select count(*)::int as n from (${sql}) q`, params);
  return rows[0].n as number;
}

// Every table in the public schema, and whether RLS is switched on.
export async function tablesWithRls(client: Client) {
  const { rows } = await client.query(
    `select c.relname as table, c.relrowsecurity as rls
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by 1`,
  );
  return rows as { table: string; rls: boolean }[];
}
