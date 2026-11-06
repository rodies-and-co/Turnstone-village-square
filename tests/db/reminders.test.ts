import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DB, USERS, as, asOwner, connect, hubClaims, type Session } from "./db";

let hub: Client;
let hartley: Client;
beforeAll(async () => {
  hub = await connect(DB.hub);
  hartley = await connect(DB.familyA);
});
afterAll(async () => {
  await Promise.all([hub.end(), hartley.end()]);
});
async function signedIn(id: string, aal: "aal1" | "aal2" = "aal2"): Promise<Session> {
  return { kind: "user", id, aal, claims: await hubClaims(hub, id) };
}

describe("Reminders: the narrow reminders login", () => {
  it("in a family database, can only count each person's items, and read nothing else", async () => {
    await asOwner(hartley, async (db) => {
      await db.query("insert into todos (title, assigned_to, due_on) values ('Overdue', $1, current_date - 3), ('Soon', $1, current_date + 2), ('Later', $1, current_date + 30)", [USERS.hartleyAdministrator]);
      await db.query("set local role vs_reminders");
      const rows = (
        await db.query("select user_id, counts from reminders.counts($1)", [
          JSON.stringify([
            { user_id: USERS.hartleyAdministrator, role: "administrator" },
            { user_id: USERS.hartleyViewerWholeFamily, role: "viewer" },
          ]),
        ])
      ).rows;
      expect(rows).toEqual([{ user_id: USERS.hartleyAdministrator, counts: { todos_overdue: 1, todos_this_week: 1 } }]);
      await db.query("savepoint s");
      await expect(db.query("select * from todos")).rejects.toThrow(/permission denied/);
      await db.query("rollback to savepoint s");
      await expect(db.query("select * from people")).rejects.toThrow(/permission denied/);
    });
  });

  it("in the hub, can only list who gets reminders and note that one was sent", async () => {
    await asOwner(hub, async (db) => {
      await db.query("insert into reminder_preferences (user_id, frequency) values ($1, 'off')", [USERS.hartleyViewerOwnRecord]);
      await db.query("set local role vs_reminders");
      const who = (await db.query("select user_id, frequency, families from reminders.recipients()")).rows;
      const ids = who.map((r) => r.user_id);
      expect(ids).toContain(USERS.hartleyManager);
      expect(ids).not.toContain(USERS.hartleyViewerOwnRecord); // turned off
      expect(who.find((r) => r.user_id === USERS.hartleyManager).families[0]).toMatchObject({ role: "manager" });
      expect((await db.query("select reminders.already_sent($1, current_date) as s", [USERS.hartleyManager])).rows[0].s).toBe(false);
      await db.query("select reminders.record_sent($1, current_date, 1, 3, true, null)", [USERS.hartleyManager]);
      await db.query("select reminders.record_sent($1, current_date, 1, 3, true, null)", [USERS.hartleyManager]);
      expect((await db.query("select reminders.already_sent($1, current_date) as s", [USERS.hartleyManager])).rows[0].s).toBe(true);
      await expect(db.query("select * from auth.users")).rejects.toThrow(/permission denied/);
    });
  });

  it("each person sees and changes only their own choice", async () => {
    await as(hub, await signedIn(USERS.hartleyManager), async (db) => {
      await db.query("insert into reminder_preferences (user_id, frequency) values ($1, 'daily')", [USERS.hartleyManager]);
      await expect(db.query("insert into reminder_preferences (user_id, frequency) values ($1, 'off')", [USERS.hartleyAdministrator])).rejects.toThrow(/row-level security/);
    });
  });
});
