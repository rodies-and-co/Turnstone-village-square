import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DB, HARTLEY_DB, USERS, as, connect, count, hubClaims, removeWithApproval, switchUser, type Session } from "./db";

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
const HOLDINGS = "a9000000-0000-4000-8000-000000000001";
const ADMIN = USERS.hartleyAdministrator;
const MANAGER = USERS.hartleyManager;
const one = async (db: Client, sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0];
async function fails(db: Client, sql: string, params: unknown[], match: RegExp) {
  await db.query("savepoint f");
  await expect(db.query(sql, params)).rejects.toThrow(match);
  await db.query("rollback to savepoint f");
}
const add = (db: Client, e: Record<string, unknown>, people: string[] = []) =>
  one(db, "select public.add_timeline_event($1, $2) as id", [{ happened_on: "2020-05-01", ...e }, people]).then((r) => r.id as string);

describe("Timeline events", () => {
  it("are seen by who may see what they are about, and every person linked", async () => {
    const seen = await as(hartley, await signedIn(ADMIN), async (db) => {
      await add(db, { title: "Family moved to York" });
      await add(db, { title: "Holdings sold a subsidiary", category: "business", entity_id: HOLDINGS });
      await add(db, { title: "North branch reunion", branch_id: HARTLEY_DB.northBranch });
      await add(db, { title: "South's sabbatical" }, [HARTLEY_DB.southPerson]);
      const out: Record<string, string[]> = {};
      for (const [u, aal] of [
        [USERS.hartleyViewerWholeFamily, "aal1"],
        [USERS.hartleyViewerBranch, "aal1"],
        [USERS.hartleyViewerOwnRecord, "aal1"],
        [USERS.hartleyViewerWithMfa, "aal1"],
        [USERS.okaforManager, "aal2"],
      ] as const) {
        await switchUser(db, hub, u, aal);
        out[u] = (await db.query("select title from timeline_events order by title")).rows.map((r) => r.title);
      }
      return out;
    });
    expect(seen[USERS.hartleyViewerWholeFamily]).toEqual(["Family moved to York", "Holdings sold a subsidiary", "North branch reunion", "South's sabbatical"]);
    expect(seen[USERS.hartleyViewerBranch]).toEqual(["North branch reunion"]);
    expect(seen[USERS.hartleyViewerOwnRecord]).toEqual([]);
    expect(seen[USERS.hartleyViewerWithMfa]).toEqual([]);
    expect(seen[USERS.okaforManager]).toEqual([]);
  });

  it("can't be in the future; links can't move; only a Manager changes what an event is about", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      await fails(db, "insert into timeline_events (title, happened_on) values ('x', current_date + 2)", [], /future/);
      const id = await add(db, { title: "x", branch_id: HARTLEY_DB.northBranch }, [HARTLEY_DB.northPerson]);
      await fails(db, "update timeline_event_people set person_id = $1 where event_id = $2", [HARTLEY_DB.southPerson, id], /can't be moved/);
      await fails(db, "update timeline_events set branch_id = null where id = $1", [id], /only a Manager/);
      await switchUser(db, hub, MANAGER);
      await db.query("update timeline_events set branch_id = null where id = $1", [id]);
    });
  });

  it("are removed by two people; Viewers can't add them", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      const id = await add(db, { title: "Gone" }, [HARTLEY_DB.northPerson]);
      expect(await removeWithApproval(db, hub, "timeline_events", id)).toBe("approved");
      expect(await count(db, "select 1 from timeline_event_people where event_id = $1", [id])).toBe(0);
    });
    await as(hartley, await signedIn(USERS.hartleyViewerWholeFamily, "aal1"), async (db) => {
      await expect(db.query("insert into timeline_events (title, happened_on) values ('x', current_date)")).rejects.toThrow(/row-level security/);
    });
  });
});

describe("My records", () => {
  it("shows a Viewer their own offices even where they can't see the entity; nothing for others", async () => {
    await as(hartley, await signedIn(MANAGER), async (db) => {
      await db.query("insert into appointments (entity_id, role, person_id, appointed_on, basis) values ($1, 'secretary', $2, '2024-01-01', 'formation')", [HOLDINGS, HARTLEY_DB.ownPerson]);
      await switchUser(db, hub, USERS.hartleyViewerOwnRecord, "aal1");
      expect(await count(db, "select 1 from entities")).toBe(0);
      const mine = (await one(db, "select public.my_records() as r")).r;
      expect(mine.person_id).toBe(HARTLEY_DB.ownPerson);
      expect(mine.offices).toEqual([expect.objectContaining({ role: "secretary", appointed_on: "2024-01-01", ceased_on: null })]);
      expect(mine.holdings).toEqual([]);
      expect(mine.offices).toHaveLength(1);
      // Not linked to anyone, or another family: nothing.
      await switchUser(db, hub, USERS.hartleyViewerWholeFamily, "aal1");
      expect((await one(db, "select public.my_records() as r")).r).toEqual({ person_id: null, reason: "not_linked" });
      await switchUser(db, hub, USERS.okaforManager);
      expect((await one(db, "select public.my_records() as r")).r).toBeNull();
    });
  });
});
