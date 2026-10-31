# Turnstone Village Square

A private platform where families record and keep their records to make
succession work. Built with Next.js, Supabase (London) and Vercel.

- `CLAUDE.md`: the permanent project rules.
- `docs/setup-guide.md`: step-by-step setup for the hub, family databases and
  Vercel. You do these steps yourself; you never share keys with anyone.
- `supabase/hub/migrations`: the hub database (sign-in, families, staff, access).
- `supabase/family/migrations`: each family's own database.
- `supabase/setup`: small SQL scripts for the setup steps.
- `tests/db`: security tests that run on throwaway local databases.

For developers: `npm ci`, then `npm test` (needs `TEST_DATABASE_URL` pointing at
a local Postgres server), `npm run lint`, `npm run typecheck`, `npm run build`.
