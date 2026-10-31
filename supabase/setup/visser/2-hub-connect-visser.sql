-- HUB project (Village-Square-Hub). Tells the hub where the Visser database
-- lives. Run AFTER 1-visser-family-database.sql has run in the Visser project.
--
-- From the VISSER project, copy:
--   Project Settings > Data API  -> Project URL
--   Project Settings > API Keys  -> Publishable key (starts sb_publishable_)
-- Never use a key marked secret or service_role.

update public.families
set database_url = 'https://eeholikrjwrcqmazwsse.supabase.co/rest/v1/',          -- CHANGE THIS
    database_publishable_key = 'sb_publishable___7uGLkUi_pJTVGxhPKR2w_ZCy38seY'   -- CHANGE THIS
where id = 'ab3eacfa-f57f-43c1-afe0-f27f21407f0d';                 -- Visser

select name, database_url, database_publishable_key is not null as has_key
from public.families order by name;
