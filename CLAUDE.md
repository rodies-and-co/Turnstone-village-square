# Turnstone Village Square – project rules

Turnstone Village Square is a confidential platform where families record and
keep their records to make succession work: ownership, leadership, assets,
incapacity planning, timelines and contingencies, and values and purpose.
These rules are permanent. Follow them in every change.

## Working with the project owner

- The owner has no programming experience. Always explain changes in plain
  English: what changed, why, and what (if anything) they need to do.
- Check with the owner before any big change (new features, new services,
  database changes, deleting things, changing these rules).
- Check everything: every change is tested before it is handed over.
- Decisions are recorded in the Turnstone Village Square project
  (`claude/decisions-log.md`). Follow them.

## Data

- Dummy data only until the owner says otherwise. Never use real names or real
  family information in code, tests, seed data, screenshots, commit messages
  or docs. Practice families: Hartley and Visser (fictional).
- Data is hosted in the UK (Supabase London, Vercel London). Any service that
  holds data must use a UK region (or the Isle of Man, if available).
- AI is Claude only, through Turnstone's own account (the key lives only in
  Vercel's settings). The AI must not learn
  from the data; personal details are replaced with placeholders before
  anything is sent, and restored on return.

## Architecture: one hub, one database per family

- **Hub** (one Supabase project): sign-in for everyone, the list of families,
  Turnstone staff and who may open which family. No family records.
- **Family databases** (one Supabase project per family): all of that
  family's records and Vault files. Never put two families in one database.
- Nobody signs in to a family database directly. The app sends the person's
  hub sign-in token; the family database accepts only tokens from its own hub
  (`family_settings.hub_issuer`) and only the role given for its own family id
  (`family_settings.family_id`). Both values can never change.
- The hub's `custom_access_token_hook` puts the roles into the token
  (`vs.system_role`, `vs.families`, `vs.mfa`). Access changes apply when the
  token refreshes, so keep the token lifetime short (10 minutes).
- Entity Standards (rules per jurisdiction and entity type) will live in the
  hub and be shared by all families.

## Roles

- Super User: everything, in every family (with two-factor).
- System Admin: users, access and settings in the hub; no family records, and
  cannot give themselves a family role.
- Manager: reads, adds, changes and approves (including other people's removal
  requests) in their families; manages
  Administrators and Viewers for their families.
- Administrator: reads, adds and changes, and may ask for a removal; cannot
  approve, remove or manage access.
- Viewer: read only, limited by access grants (whole family, a branch, or own
  record). Family members and advisers are Viewers.
- Whoever prepares a record must not be the one who approves it.
- Nothing is removed by one person alone. A Manager or Administrator asks
  (`request_removal`); a Manager or the Super User who didn't ask approves
  (`decide_removal`), and only then is the record removed. A copy is kept with
  the request. There are no direct delete rules on family tables. The one
  exception is taking away access (a Viewer's grant, or hub access), which
  stays immediate. In the hub, removals are approved by the Super User or
  System Admin; the System Admin still sees no family records.

## Security first

- Every table, in the hub and in family databases, has row-level security
  (RLS) switched on. No table is created without it. Tests enforce this.
- Access rules live in the database, not just the app. Shared checks are the
  functions in the `private` schema.
- No public sign-up. Accounts are created by the Super User or System Admin.
- Two-factor is compulsory for everyone except Viewers. A Viewer who has set it
  up must use it.
- Changes are recorded in `audit_log` by database triggers. Audit entries can
  never be changed, deleted or emptied through the app or the API (the secret
  key included).
- Only a Super User may change where a family's database lives, give anyone a
  role in a family they don't already manage, or give Turnstone staff with a
  system role a family role. Nobody else can change their own access.
- Placing a person in a branch (a new person too), moving them to another
  branch, or linking a person to a login changes what Viewers see, so only
  Managers (and the Super User) may do it.
- Every feature gets tests proving people only see and change what they are
  allowed to, including tests that one family's token gets nothing from
  another family's database.
- Never put passwords, keys or secrets in the code. Settings live in
  `.env.local`, which is never committed. `.env.example` lists the setting
  names with no values.
- Never ask the owner to paste keys or secrets into chat. Tell them which file
  or screen to put them in instead.
- Only publishable keys may be used, in the browser or the hub's `families`
  table. Secret / service-role keys are never used by the app.
- One written-down exception (owner, 5 Nov 2026): the scheduled email
  reminders job uses a narrow `vs_reminders` database login in the hub and in
  each family database. It can only call the `reminders` functions (list who
  gets reminders; count each person's items) and can't read any table. Its
  passwords live only in Vercel's settings. Emails carry counts only, never
  names, titles or details, and never a link.

## Look and feel

- Turnstone colours and logo (shared with The Family Square). Logo file:
  `public/Turnstone-Logo.jpg`.
- Layout follows The Family Square (family-governance.vercel.app): a side
  menu with the logo and the family, breadcrumbs, IBM Plex fonts, beige
  panels, dark main buttons, quiet "Remove" links, and fold-outs ("▸ Add a
  parent") so each small form only shows the fields that apply. Not Lovable.
- Keep navigation simple: one to-do list (with views), no scattered duplicates.
- The family's governing document is always called the "Family Constitution".
- British English and British conventions everywhere: spelling (organisation,
  licence), "Postcode" not "Zip code", "County or region" not "State", dates as
  day month year (e.g. 2 November 2026, or 02/11/2026).
- Every button gives feedback: it shows it is working straight away (e.g.
  "Saving…"), and a message confirms what happened. Removing anything asks
  "Are you sure?" first.
- Follow industry best practice rather than copying earlier prototypes
  (Lovable). Information is entered once (e.g. one date of birth) and shown
  wherever it is needed; family links are stored once and show on both people.

## Accessibility

- Text must have readable contrast (WCAG AA: at least 4.5:1 for normal text).
- Touch targets (buttons, links, inputs) are at least 44px × 44px.
- Colours never carry meaning alone; the meaning is written out too.
