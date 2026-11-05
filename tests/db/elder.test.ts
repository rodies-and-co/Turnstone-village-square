import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DB, USERS, as, connect, count, hubClaims, switchUser, type Session } from "./db";

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
const one = async (db: Client, sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0];

describe("Ask the Elder's log", () => {
  it("everyone with a role asks; each sees their own; Managers see all; other families nothing", async () => {
    await as(hartley, await signedIn(USERS.hartleyViewerOwnRecord, "aal1"), async (db) => {
      const id = (await one(db, "insert into elder_questions (question) values ('Who are the directors?') returning id, asked_by")).id;
      await db.query("select public.record_elder_answer($1, 'Two directors.', false, 'm', 10, 5, 3)", [id]);
      // Only once, only by whoever asked.
      await db.query("select public.record_elder_answer($1, 'Changed!', false, 'm', 1, 1, 0)", [id]);
      expect((await one(db, "select answer, placeholders from elder_questions where id = $1", [id]))).toEqual({ answer: "Two directors.", placeholders: 3 });
      await expect(db.query("update elder_questions set answer = 'x' where id = $1", [id])).resolves.toMatchObject({ rowCount: 0 });
      await switchUser(db, hub, USERS.hartleyViewerWholeFamily, "aal1");
      expect(await count(db, "select 1 from elder_questions")).toBe(0);
      await switchUser(db, hub, USERS.hartleyAdministrator);
      expect(await count(db, "select 1 from elder_questions")).toBe(0);
      await switchUser(db, hub, USERS.hartleyManager);
      expect(await count(db, "select 1 from elder_questions")).toBe(1);
      await switchUser(db, hub, USERS.okaforManager);
      expect(await count(db, "select 1 from elder_questions")).toBe(0);
      await expect(db.query("insert into elder_questions (question) values ('x')")).rejects.toThrow(/row-level security/);
    });
  });

  it("a new question can't come with a made-up answer; nobody else can record its answer", async () => {
    await as(hartley, await signedIn(USERS.hartleyAdministrator), async (db) => {
      const id = (await one(db, "insert into elder_questions (question, answer, placeholders) values ('q', 'invented', 9) returning id")).id;
      expect(await one(db, "select answer, placeholders from elder_questions where id = $1", [id])).toEqual({ answer: null, placeholders: 0 });
      await switchUser(db, hub, USERS.hartleyManager);
      await db.query("select public.record_elder_answer($1, 'by someone else', false, 'm', 1, 1, 0)", [id]);
      expect((await one(db, "select answer from elder_questions where id = $1", [id])).answer).toBeNull();
    });
  });

  it("can't be changed or deleted, even by a Manager; asking is limited to 50 a day", async () => {
    await as(hartley, await signedIn(USERS.hartleyManager), async (db) => {
      const id = (await one(db, "insert into elder_questions (question) values ('q') returning id")).id;
      await expect(db.query("delete from elder_questions where id = $1", [id])).resolves.toMatchObject({ rowCount: 0 });
      await db.query("insert into elder_questions (question) select 'q' || g from generate_series(1, 49) g");
      await expect(db.query("insert into elder_questions (question) values ('one too many')")).rejects.toThrow(/50 questions/);
    });
  });
});
