-- Email reminders: switching on the narrow reminders login.
-- Run in the HUB's SQL Editor, and then in EACH family's SQL Editor, after
-- that project's 20261125000000_reminders.sql. Do it once per project.
--
-- The login "vs_reminders" can only count each person's items (in a family)
-- or list who gets reminders (in the hub). It can't read any table.
--
-- Step 1: run this line on its own. It makes a new random password and shows
-- it once.
select encode(extensions.gen_random_bytes(24), 'hex') as new_password;

-- Step 2: replace PASTE-THE-PASSWORD-HERE below with that password (keep the
-- quotes), select just the next line, and run it. Use a different password in
-- each project.
-- alter role vs_reminders with login password 'PASTE-THE-PASSWORD-HERE';

-- Step 3: put the connection into Vercel (Project > Settings > Environment
-- Variables), never into chat or a file:
--   - In Supabase, press Connect and copy the "Session pooler" connection
--     string. Change the user from postgres.<project ref> to
--     vs_reminders.<project ref>, and put the password from step 1 in place
--     of [YOUR-PASSWORD].
--   - The hub's goes in HUB_REMINDERS_DATABASE_URL.
--   - Each family's goes in REMINDER_DATABASES, as
--     {"<family id>": "<connection>", "<family id>": "<connection>"}.
--     The family id is the one in the address bar when that family is open
--     in Village Square.
--
-- To switch reminders off again for a project, run:
--   alter role vs_reminders nologin;
