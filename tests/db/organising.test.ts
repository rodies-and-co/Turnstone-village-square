import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DB, USERS, as, connect, count, hubClaims, removeWithApproval, switchUser, type Session } from "./db";

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
const NORTH_TRUST = "a9000000-0000-4000-8000-000000000002";
const NORTH = "a2000000-0000-4000-8000-000000000001";
const SOUTH = "a2000000-0000-4000-8000-000000000002";
const NORTH_BRANCH = "a1000000-0000-4000-8000-000000000001";
const ADMIN = USERS.hartleyAdministrator;
const MANAGER = USERS.hartleyManager;
const one = async (db: Client, sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0];

describe("To-dos", () => {
  it("are for Managers and Administrators only; done and reopened records who and when", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      const t = (await one(db, "insert into todos (title, assigned_to, entity_id, created_by) values ('Collect passport copies', $1, $2, $1) returning id, created_by", [MANAGER, HOLDINGS]));
      expect(t.created_by).toBe(ADMIN);
      await switchUser(db, hub, MANAGER);
      await db.query("update todos set status = 'done' where id = $1", [t.id]);
      expect(await one(db, "select done_by, done_at is not null as stamped from todos where id = $1", [t.id])).toEqual({ done_by: MANAGER, stamped: true });
      await db.query("update todos set status = 'open' where id = $1", [t.id]);
      expect(await one(db, "select done_by, done_at from todos where id = $1", [t.id])).toEqual({ done_by: null, done_at: null });
      await db.query("delete from todos where id = $1", [t.id]);
      expect(await count(db, "select * from todos where id = $1", [t.id])).toBe(1); // no direct delete
      for (const [u, aal] of [[USERS.hartleyViewerWholeFamily, "aal1"], [USERS.okaforManager, "aal2"]] as const) {
        await switchUser(db, hub, u, aal);
        expect(await count(db, "select * from todos")).toBe(0);
      }
    });
  });

  it("are removed by two people", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      const t = (await one(db, "insert into todos (title) values ('x') returning id")).id;
      expect(await removeWithApproval(db, hub, "todos", t)).toBe("approved");
    });
  });
});

describe("Calendar entries", () => {
  it("follow who may see what they are about, and the people linked", async () => {
    const seen = await as(hartley, await signedIn(ADMIN), async (db) => {
      await db.query("insert into calendar_events (title, starts_on) values ('Family Assembly retreat', current_date + 30)");
      await db.query("insert into calendar_events (title, starts_on, entity_id) values ('Company board dinner', current_date + 10, $1)", [HOLDINGS]);
      await db.query("insert into calendar_events (title, starts_on, branch_id) values ('North branch lunch', current_date + 5, $1)", [NORTH_BRANCH]);
      const p = (await one(db, "insert into calendar_events (title, kind, starts_on) values ('South''s birthday dinner', 'personal', current_date + 3) returning id")).id;
      await db.query("insert into calendar_event_people (event_id, person_id) values ($1, $2)", [p, SOUTH]);
      const n = (await one(db, "insert into calendar_events (title, kind, starts_on, entity_id) values ('Trust review', 'deadline', current_date + 3, $1) returning id", [NORTH_TRUST])).id;
      await db.query("insert into calendar_event_people (event_id, person_id) values ($1, $2)", [n, NORTH]);
      const out: Record<string, string[]> = {};
      for (const [u, aal] of [
        [USERS.hartleyViewerWholeFamily, "aal1"],
        [USERS.hartleyViewerBranch, "aal1"],
        [USERS.okaforManager, "aal2"],
      ] as const) {
        await switchUser(db, hub, u, aal);
        out[u] = (await db.query("select title from calendar_events order by title")).rows.map((r) => r.title);
      }
      return out;
    });
    expect(seen[USERS.hartleyViewerWholeFamily]).toEqual(["Company board dinner", "Family Assembly retreat", "North branch lunch", "South's birthday dinner", "Trust review"]);
    // A North branch Viewer: not the whole-family company's, nor the entry about South (hidden from them).
    expect(seen[USERS.hartleyViewerBranch]).toEqual(["Family Assembly retreat", "North branch lunch", "Trust review"]);
    expect(seen[USERS.okaforManager]).toEqual([]);
  });

  it("are saved with their people in one step; a bad link saves nothing", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      const id = (await one(db, "select public.add_calendar_event($1, $2) as id", [{ title: "South's check-up", kind: "personal", starts_on: "2026-12-01" }, [SOUTH, SOUTH]])).id;
      expect(await count(db, "select 1 from calendar_event_people where event_id = $1 and person_id = $2", [id, SOUTH])).toBe(1);
      const before = await count(db, "select 1 from calendar_events");
      await db.query("savepoint s");
      await expect(
        db.query("select public.add_calendar_event($1, $2)", [{ title: "Orphan", starts_on: "2026-12-01" }, ["a2000000-0000-4000-8000-0000000000ff"]]),
      ).rejects.toThrow(/foreign key/);
      await db.query("rollback to savepoint s");
      expect(await count(db, "select 1 from calendar_events")).toBe(before);
    });
  });

  it("a link to a person can't be moved, and only a Manager changes what an entry is about", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      const id = (await one(db, "select public.add_calendar_event($1, $2) as id", [{ title: "North lunch", starts_on: "2026-12-01", branch_id: NORTH_BRANCH }, [SOUTH]])).id;
      await db.query("savepoint s");
      await expect(db.query("update calendar_event_people set person_id = $1 where event_id = $2", [NORTH, id])).rejects.toThrow(/can't be moved/);
      await db.query("rollback to savepoint s");
      await expect(db.query("update calendar_events set branch_id = null where id = $1", [id])).rejects.toThrow(/only a Manager/);
      await db.query("rollback to savepoint s");
      await db.query("update calendar_events set title = 'North branch lunch' where id = $1", [id]);
      await switchUser(db, hub, MANAGER);
      await db.query("update calendar_events set branch_id = null where id = $1", [id]);
      expect((await one(db, "select branch_id from calendar_events where id = $1", [id])).branch_id).toBeNull();
    });
  });

  it("a person linked to an entry can't be removed until the entry or link goes", async () => {
    await as(hartley, await signedIn(MANAGER), async (db) => {
      const person = (await one(db, "insert into people (member_type, full_names, surname) values ('family', 'Test', 'Linked') returning id")).id;
      const ev = (await one(db, "select public.add_calendar_event($1, $2) as id", [{ title: "Private", starts_on: "2026-12-01" }, [person]])).id;
      await db.query("savepoint s");
      await expect(removeWithApproval(db, hub, "people", person)).rejects.toThrow(/calendar_event_people/);
      await db.query("rollback to savepoint s");
      expect(await removeWithApproval(db, hub, "calendar_events", ev)).toBe("approved");
      expect(await removeWithApproval(db, hub, "people", person)).toBe("approved");
    });
  });

  it("Viewers can't add entries", async () => {
    await as(hartley, await signedIn(USERS.hartleyViewerWholeFamily, "aal1"), async (db) => {
      await expect(db.query("insert into calendar_events (title, starts_on) values ('x', current_date)")).rejects.toThrow(/row-level security/);
    });
  });
});

describe("The family team (hub)", () => {
  it("Managers and Administrators see who a to-do can go to; Viewers and other families don't", async () => {
    const team = async (u: string, aal: "aal1" | "aal2" = "aal2") =>
      as(hub, { kind: "user", id: u, aal, claims: await hubClaims(hub, u) }, async (db) =>
        (await db.query("select user_id, role from public.family_team($1) order by role, user_id", ["a0000000-0000-4000-8000-000000000001"])).rows,
      );
    const roles = (rows: { role: string }[]) => [...new Set(rows.map((r) => r.role))].sort();
    expect(roles(await team(ADMIN))).toEqual(["administrator", "manager", "super_user"]);
    expect(await team(USERS.hartleyViewerWholeFamily, "aal1")).toEqual([]);
    expect(await team(USERS.okaforManager)).toEqual([]);
  });
});
