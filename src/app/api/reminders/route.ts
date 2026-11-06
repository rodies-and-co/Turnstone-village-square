import nodemailer from "nodemailer";
import { Client } from "pg";
import { compose, dueToday, type Counts, type Frequency } from "@/lib/reminders";

// The scheduled job that sends email reminders (Vercel runs it every morning;
// see vercel.json). Nobody is signed in, so it uses the narrow "vs_reminders"
// logins, which can only list who gets reminders (hub) and count each
// person's items (each family). Counts only, no link (owner, 5 Nov 2026).
//
// Settings (Vercel > Settings > Environment Variables; never in the code):
//   CRON_SECRET                  set by Vercel for its scheduled jobs
//   HUB_REMINDERS_DATABASE_URL   the hub's vs_reminders connection
//   REMINDER_DATABASES           {"<family id>": "<that family's vs_reminders connection>", …}
//   SUPABASE_CA_CERT             Supabase's public certificate, to check the connections
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM   the email sender
// Until these are all set, nothing is sent.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Recipient = { user_id: string; email: string; name: string; frequency: Frequency; families: { family_id: string; family_name: string; role: string }[] };

const connect = async (url: string) => {
  // Encrypted and checked: Supabase's own certificate (Database settings > SSL
  // configuration, a public certificate, not a secret) goes in SUPABASE_CA_CERT.
  const ca = process.env.SUPABASE_CA_CERT?.replace(/\\n/g, "\n");
  // Only a database on this computer (for the tests) may go without encryption.
  const local = /^postgres(ql)?:\/\/[^@]*@(localhost|127\.0\.0\.1)[:/]/.test(url) && url.includes("sslmode=disable");
  const ssl = local ? false : ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: true };
  const c = new Client({ connectionString: url.replace(/[?&]sslmode=disable/, ""), ssl, statement_timeout: 20000, connectionTimeoutMillis: 10000 });
  await c.connect();
  return c;
};

export async function GET(request: Request) {
  // Only Vercel's scheduler (which sends the secret) may run this.
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Not allowed.", { status: 401 });

  const { HUB_REMINDERS_DATABASE_URL: hubUrl, REMINDER_DATABASES: families, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM } = process.env;
  if (!hubUrl || !families || !SMTP_HOST || !SMTP_FROM) return Response.json({ sent: 0, note: "Email reminders aren't set up yet." });
  let familyUrls: Record<string, string>;
  try {
    familyUrls = JSON.parse(families);
  } catch {
    return Response.json({ sent: 0, note: "REMINDER_DATABASES isn't readable." }, { status: 500 });
  }

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const mail = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    requireTLS: Number(SMTP_PORT) !== 465,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASSWORD } : undefined,
  });

  const hub = await connect(hubUrl);
  const result = { sent: 0, nothing_waiting: 0, failed: 0, families_unreachable: [] as string[] };
  try {
    const recipients = ((await hub.query("select user_id, email, name, frequency, families from reminders.recipients()")).rows as Recipient[]).filter((r) => dueToday(r.frequency, today));
    if (recipients.length === 0) return Response.json(result);

    // Count each person's items, one family at a time.
    const counts = new Map<string, Map<string, Counts>>(); // family → user → counts
    const familyIds = [...new Set(recipients.flatMap((r) => r.families.map((f) => f.family_id)))];
    for (const id of familyIds) {
      const url = familyUrls[id];
      if (!url) {
        result.families_unreachable.push(id);
        continue;
      }
      const people = recipients.flatMap((r) => r.families.filter((f) => f.family_id === id).map((f) => ({ user_id: r.user_id, role: f.role })));
      let db: Client | null = null;
      try {
        db = await connect(url);
        const rows = (await db.query("select user_id, counts from reminders.counts($1)", [JSON.stringify(people)])).rows as { user_id: string; counts: Counts }[];
        counts.set(id, new Map(rows.map((r) => [r.user_id, r.counts])));
      } catch {
        result.families_unreachable.push(id);
      } finally {
        await db?.end().catch(() => undefined);
      }
    }

    for (const r of recipients) {
      const theirs = r.families.map((f) => ({ name: /family$/i.test(f.family_name) ? f.family_name : `${f.family_name} family`, counts: counts.get(f.family_id)?.get(r.user_id) ?? {} }));
      const email = compose(r.name, theirs);
      if (email.items === 0) {
        result.nothing_waiting += 1;
        continue;
      }
      if ((await hub.query("select reminders.already_sent($1, $2) as s", [r.user_id, today])).rows[0].s) continue;
      try {
        await mail.sendMail({ from: SMTP_FROM, to: r.email, subject: email.subject, text: email.text, html: email.html });
        await hub.query("select reminders.record_sent($1, $2, $3, $4, true, null)", [r.user_id, today, theirs.filter((t) => Object.keys(t.counts).length).length, email.items]);
        result.sent += 1;
      } catch (e) {
        await hub.query("select reminders.record_sent($1, $2, $3, $4, false, $5)", [r.user_id, today, 0, email.items, e instanceof Error ? e.message : "Sending failed"]);
        result.failed += 1;
      }
    }
    return Response.json(result);
  } finally {
    await hub.end().catch(() => undefined);
  }
}
