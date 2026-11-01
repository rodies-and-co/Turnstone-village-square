-- Turnstone Village Square: two people for every removal (hub)
--
-- Removing a family from the hub was possible for the Super User alone. Now
-- nobody can remove a family through the app or the API. When a screen for it
-- is built, it will work like the family databases: one person asks, and the
-- Super User or System Admin who didn't ask approves.
--
-- Taking away someone's access (family_access, staff) stays immediate: a delay
-- would leave someone with access they should no longer have. It is recorded
-- in the audit log as before.

drop policy if exists "families: super users delete" on public.families;
