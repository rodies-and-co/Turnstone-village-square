import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DB, USERS, asOwner, connect, dbUrl } from "./db";

const sent: { to: string; subject: string; text: string; html: string }[] = [];
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: async (m: (typeof sent)[number]) => void sent.push(m) }) } }));

let hub: Client;
let hartley: Client;
const HARTLEY_ID = "f1000000-0000-4000-8000-000000000001";
beforeAll(async () => {
  hub = await connect(DB.hub);
  hartley = await connect(DB.familyA);
  await hub.query("alter role vs_reminders login password 'test-only'");
});
afterAll(async () => {
  await hub.query("alter role vs_reminders nologin");
  await hub.query("delete from reminder_log");
  await hartley.query("delete from todos where title = 'Job test'");
  await Promise.all([hub.end(), hartley.end()]);
});
const asReminders = (name: Parameters<typeof dbUrl>[0]) => {
  const u = new URL(dbUrl(name));
  u.username = "vs_reminders";
  u.password = "test-only";
  return `${u.toString()}?sslmode=disable`;
};

describe("the reminders job", () => {
  it("refuses anyone without the scheduler's secret", async () => {
    process.env.CRON_SECRET = "s3cret";
    const { GET } = await import("@/app/api/reminders/route");
    expect((await GET(new Request("http://x/api/reminders"))).status).toBe(401);
  });

  it("emails counts only, no links, once a day, to those with something waiting", async () => {
    const { rows } = await hub.query("select id from families where name ilike 'hartley%' limit 1");
    const family = rows[0]?.id ?? HARTLEY_ID;
    await hartley.query("insert into todos (title, assigned_to, due_on) values ('Job test', $1, current_date - 1)", [USERS.hartleyAdministrator]);
    Object.assign(process.env, {
      CRON_SECRET: "s3cret",
      HUB_REMINDERS_DATABASE_URL: asReminders(DB.hub),
      REMINDER_DATABASES: JSON.stringify({ [family]: asReminders(DB.familyA) }),
      SMTP_HOST: "smtp.example.test",
      SMTP_FROM: "Village Square <reminders@example.test>",
    });
    // Every weekday counts as "daily"; make the Administrator daily so the test runs any weekday.
    await asOwner(hub, async () => undefined);
    await hub.query("insert into reminder_preferences (user_id, frequency) values ($1, 'daily') on conflict (user_id) do update set frequency = 'daily'", [USERS.hartleyAdministrator]);
    const { GET } = await import("@/app/api/reminders/route");
    const day = new Date().toLocaleDateString("en-GB", { weekday: "long", timeZone: "Europe/London" });
    const res = await (await GET(new Request("http://x/api/reminders", { headers: { authorization: "Bearer s3cret" } }))).json();
    if (day === "Saturday" || day === "Sunday") {
      expect(res.sent).toBe(0);
      return;
    }
    const mine = sent.filter((m) => m.text.includes("overdue"));
    expect(mine.length).toBeGreaterThanOrEqual(1);
    expect(mine[0].text).toMatch(/1 to-do given to you is overdue/);
    expect(mine[0].text).not.toContain("Job test");
    expect(mine[0].html).not.toMatch(/href=|https?:/i);
    // Not again the same day.
    const before = sent.length;
    await GET(new Request("http://x/api/reminders", { headers: { authorization: "Bearer s3cret" } }));
    expect(sent.length).toBe(before);
    await hub.query("delete from reminder_preferences where user_id = $1", [USERS.hartleyAdministrator]);
  });
});
