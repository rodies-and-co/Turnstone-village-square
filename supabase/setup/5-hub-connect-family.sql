-- HUB project. Records where a family's own database lives, so the app can
-- open it. Both values are safe to store: the publishable key only works
-- together with a signed-in person's token. Never put a secret key here.
--
-- Find them in the FAMILY project: Project Settings > Data API (Project URL)
-- and Project Settings > API Keys (Publishable key, starts sb_publishable_).
-- (If the address ends in /rest/v1/, that's fine: it is removed automatically.)

update public.families
set database_url = regexp_replace(trim('https://your-family-ref.supabase.co'), '(/rest/v1)?/*$', ''),          -- CHANGE THIS
    database_publishable_key = 'sb_publishable_xxxxxxxxxxxxxxxx'   -- CHANGE THIS
where name = 'Hartley';                                            -- CHANGE THIS

select name, database_url, database_publishable_key is not null as has_key
from public.families order by name;
