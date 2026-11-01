# Setting up Turnstone Village Square

You do these steps yourself in GitHub, Supabase and Vercel. You never need to
share keys or passwords with anyone, including Claude.

Supabase and Vercel sometimes rename menu items. If a name below doesn't match
exactly, look for the closest match in the same area.

**What you are building:**

- One **hub** project: sign-in, the list of families, Turnstone staff and who
  may open which family.
- One **family** project for each family: all of that family's records.

To start, you make the hub plus one family project for the fictional Hartley
family. That is your test environment. Real families come later, each in its
own new project.

---

## 1. Put the code in GitHub

1. Open **GitHub Desktop**: File → **Add local repository** → choose your
   **turnstone-village-square** folder on your Desktop.
2. Click **Publish repository** (or **Push origin**) to send it to
   `rodies-and-co/Turnstone-village-square`. Keep it **private**.
3. On github.com, open the repository → **Actions**. The "Checks" run should
   turn green within a few minutes. It runs every security test.

## 2. Create the hub project in Supabase

1. supabase.com → **New project**.
   - Name: **Village-Square-Hub**
   - Region: **West EU (London)**
   - Database password: a strong one, kept in your password manager.
2. **Authentication → Sign In / Providers**:
   - Turn **off** "Allow new users to sign up".
   - **Email** provider: minimum password length **12**.
3. **Authentication → Multi-Factor**: make sure **Authenticator app (TOTP)**
   is enabled.
4. **Project Settings → JWT Keys**:
   - If it offers to **migrate** to the new JWT signing keys, do it. Then
     **rotate** to an **ECC (P-256)** key, so the hub signs with a public/private
     key pair. The family databases need this to check the hub's sign-ins.
   - Set **Access token expiry** to **600** seconds (10 minutes). If you can't
     find it here, look under **Authentication → Sessions**. A short expiry
     means removed access stops working within 10 minutes.
5. **SQL Editor → New query**:
   - Paste the whole of `supabase/hub/migrations/20261101000000_hub_foundation.sql`
     (in GitHub: open the file → **Copy raw file**) → **Run**.
   - You should see "Success. No rows returned".
6. **Authentication → Hooks**:
   - Add the **Customize Access Token (JWT) Claims** hook.
   - Type: **Postgres function**. Schema **public**, function
     **custom_access_token_hook** → **Save**.
7. **SQL Editor**:
   - Run `supabase/setup/1-hub-add-families.sql`.
   - Note the **id** shown for **Hartley**. You need it in step 3.
8. **Create your own login**: **Authentication → Users → Add user → Create new
   user** with your email and a strong password. Tick **Auto Confirm User**.
9. **SQL Editor**: run `supabase/setup/2-hub-add-staff.sql`.
   - First change the email to yours, the display name to your name, and the
     role to `super_user`.

## 3. Create the Hartley family project

1. **New project**:
   - Name: **Village-Square-Hartley**
   - Region: **West EU (London)**
   - A strong database password.
2. **Authentication → Sign In / Providers**:
   - Turn **off** "Allow new users to sign up". Nobody signs in here directly.
3. **Authentication → Sign In / Providers → Third-Party Auth → Add provider**:
   - Choose the **custom OIDC** option.
   - Issuer URL: your **hub's** Project URL with `/auth/v1` added, for example
     `https://abcdefgh.supabase.co/auth/v1`. The hub's Project URL is in the hub
     project under **Project Settings → Data API**.
4. **SQL Editor**:
   - Paste and run `supabase/family/migrations/20261101000000_family_foundation.sql`.
   - Then open `supabase/setup/4-family-first-setup.sql`. Fill in Hartley's id
     from step 2.7, the name **Hartley**, and the same hub address as in step
     3.3. Run it.
   - **Be careful:** these values can never be changed afterwards.
5. **SQL Editor**: run `supabase/setup/6-family-practice-data.sql`. It adds
   fictional people.
6. **SQL Editor**: run every later file in `supabase/family/migrations`, oldest
   first (for example `20261102000000_tree.sql` for The Tree). Each family
   project needs every one of these files, run once.
7. Practice families only: run `supabase/setup/7-practice-tree-update.sql` to
   name the branches after their heads and add the family links, and
   `supabase/setup/8-practice-organisation.sql` to add practice entities.

The hub also gets later files: run every file in `supabase/hub/migrations`
after the foundation, oldest first, once, in the hub project (for example the
Entity Standards).
6. Note this project's **Project URL** (Project Settings → Data API) and its
   **Publishable key** (Project Settings → API Keys, starts `sb_publishable_`).

## 4. Tell the hub where the Hartley database is

In the **hub** project's SQL Editor:

- Run `supabase/setup/5-hub-connect-family.sql`, with the Hartley Project URL
  and Publishable key from step 3.6.

Both values are safe to store there. Never use a key marked **secret** or
**service_role**.

## 5. Put the app on Vercel

1. vercel.com → **Add New → Project** → import `rodies-and-co/Turnstone-village-square`.
2. **Environment Variables**:
   - `NEXT_PUBLIC_SUPABASE_URL`: the **hub's** Project URL
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: the **hub's** Publishable key
3. **Settings → Functions → Region**: **London (lhr1)**.
4. **Deploy**.

## 6. Check it works

1. Open the Vercel address and sign in. You'll be asked to set up two-factor:
   scan the code with your authenticator app.
2. You should see **Hartley** and **Visser**. Open **Hartley**.
3. The **Family database** box should say: **Connected. You can see 6 people in
   2 branches.**

If it says the family database **did not recognise you**, the hub's sign-in
isn't trusted by the family project yet. Check steps 2.4 and 3.3, then sign out
and in again. If it still fails, tell Claude.

There is a fallback if third-party auth doesn't accept the hub: both projects
share one public/private signing key. Claude will walk you through it if
it's needed. **Never** copy the hub's legacy "JWT secret" into a family
project. That would let the hub's secret key bypass every security rule in
every family database.

## Giving other people access (for testing)

1. Create their login in the **hub**: Authentication → Users → Add user.
2. Run `supabase/setup/3-hub-give-family-access.sql` in the hub, choosing
   **manager**, **administrator** or **viewer**.
3. For a **viewer**, also decide what they may see. Add a row in the family
   project's `access_grants` table:
   - `whole_family`, or
   - `branch` (with the branch), or
   - `own_record`, with their `user_id` filled in on their person in `people`.
   Managers will do this in the app later.
