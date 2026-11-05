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
const ADMIN = USERS.hartleyAdministrator;
const MANAGER = USERS.hartleyManager;
const OWN = USERS.hartleyViewerOwnRecord; // linked to HARTLEY_DB.ownPerson
const one = async (db: Client, sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0];
async function fails(db: Client, sql: string, params: unknown[], match: RegExp) {
  await db.query("savepoint f");
  await expect(db.query(sql, params)).rejects.toThrow(match);
  await db.query("rollback to savepoint f");
}
const add = (db: Client, s: Record<string, unknown>, people: string[] = []) =>
  one(db, "select public.add_story($1, $2) as id", [{ body: "Once upon a time.", ...s }, people]).then((r) => r.id as string);

describe("Stories", () => {
  it("start with five chapters", async () => {
    await as(hartley, await signedIn(OWN, "aal1"), async (db) => {
      expect(await count(db, "select 1 from story_chapters")).toBe(5);
    });
  });

  it("are read by the audience chosen, and only if every person in them is visible", async () => {
    const seen = await as(hartley, await signedIn(ADMIN), async (db) => {
      await add(db, { title: "How the mill began" });
      await add(db, { title: "North branch summers", audience: "branch", branch_id: HARTLEY_DB.northBranch });
      await add(db, { title: "Clara's first job", audience: "people" }, [HARTLEY_DB.ownPerson]);
      await add(db, { title: "South's travels" }, [HARTLEY_DB.southPerson]);
      await add(db, { title: "North's school days", audience: "people" }, [HARTLEY_DB.northPerson]);
      const out: Record<string, string[]> = {};
      for (const [u, aal] of [
        [USERS.hartleyViewerWholeFamily, "aal1"],
        [USERS.hartleyViewerBranch, "aal1"],
        [OWN, "aal1"],
        [USERS.okaforManager, "aal2"],
      ] as const) {
        await switchUser(db, hub, u, aal);
        out[u] = (await db.query("select title from stories order by title")).rows.map((r) => r.title);
      }
      return out;
    });
    // Whole-family Viewer: not stories only for the people in them (they aren't one of them).
    expect(seen[USERS.hartleyViewerWholeFamily]).toEqual(["How the mill began", "North branch summers", "South's travels"]);
    expect(seen[USERS.hartleyViewerBranch]).toEqual(["How the mill began", "North branch summers"]);
    expect(seen[OWN]).toEqual(["Clara's first job", "How the mill began"]);
    expect(seen[USERS.okaforManager]).toEqual([]);
  });

  it("a family member sends one in; only they and the team see it until it is added", async () => {
    await as(hartley, await signedIn(OWN, "aal1"), async (db) => {
      await fails(db, "insert into stories (title, body) values ('x', 'y')", [], /row-level security/);
      const id = (await one(db, "select public.suggest_story('My grandmother''s kitchen', 'It smelt of bread.', '1990-01-01', 'year', 'York', null) as id")).id;
      expect((await one(db, "select status, audience, submitted_by from stories where id = $1", [id]))).toEqual({ status: "suggested", audience: "people", submitted_by: OWN });
      expect(await count(db, "select 1 from story_people where story_id = $1 and person_id = $2", [id, HARTLEY_DB.ownPerson])).toBe(1);
      await switchUser(db, hub, USERS.hartleyViewerWholeFamily, "aal1");
      expect(await count(db, "select 1 from stories where id = $1", [id])).toBe(0);
      await expect(db.query("select public.suggest_story('x', 'y', null, 'year', null, null)")).rejects.toThrow(/isn't linked/);
    });
  });

  it("the team adds or declines what was sent in; only a Manager changes the audience", async () => {
    await as(hartley, await signedIn(OWN, "aal1"), async (db) => {
      const id = (await one(db, "select public.suggest_story('Sent in', 'A memory.', null, 'year', null, null) as id")).id;
      await switchUser(db, hub, ADMIN);
      await db.query("update stories set status = 'published', title = 'Sent in (edited)' where id = $1", [id]);
      expect((await one(db, "select reviewed_by from stories where id = $1", [id])).reviewed_by).toBe(ADMIN);
      await fails(db, "update stories set status = 'declined' where id = $1", [id], /only a story that was sent in/);
      await fails(db, "update stories set audience = 'family' where id = $1", [id], /only a Manager/);
      await switchUser(db, hub, MANAGER);
      await db.query("update stories set audience = 'family' where id = $1", [id]);
      await fails(db, "insert into stories (title, body, status) values ('x', 'y', 'suggested')", [], /sends a story in/);
      await fails(db, "insert into stories (title, body, happened_on) values ('x', 'y', current_date + 3)", [], /future/);
      await fails(db, "insert into stories (title, body, themes) values ('x', 'y', '{nonsense}')", [], /check constraint/);
    });
  });

  it("only a Manager adds people to a story once it is saved; the sender stops seeing it once added if not allowed", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      const id = await add(db, { title: "Private", audience: "people" }, [HARTLEY_DB.northPerson]);
      await db.query("update stories set created_at = now() - interval '1 day' where id = $1", [id]);
      await fails(db, "insert into story_people (story_id, person_id) values ($1, $2)", [id, HARTLEY_DB.ownPerson], /only a Manager/);
      await switchUser(db, hub, MANAGER);
      await db.query("insert into story_people (story_id, person_id) values ($1, $2)", [id, HARTLEY_DB.ownPerson]);
      // Sent in, then added and given to a branch the sender can't see: they no longer see it.
      await switchUser(db, hub, OWN, "aal1");
      const sent = (await one(db, "select public.suggest_story('Mine', 'Text.', null, 'year', null, null) as id")).id;
      await switchUser(db, hub, MANAGER);
      await db.query("update stories set status = 'published', audience = 'branch', branch_id = $2 where id = $1", [sent, HARTLEY_DB.southBranch]);
      await switchUser(db, hub, OWN, "aal1");
      expect(await count(db, "select 1 from stories where id = $1", [sent])).toBe(0);
    });
  });

  it("are removed by two people; a person in a story can't be removed until it goes", async () => {
    await as(hartley, await signedIn(MANAGER), async (db) => {
      const person = (await one(db, "insert into people (member_type, full_names, surname) values ('family', 'Test', 'Teller') returning id")).id;
      const id = await add(db, { title: "About Test" }, [person]);
      await db.query("savepoint s");
      await expect(removeWithApproval(db, hub, "people", person)).rejects.toThrow(/story_people/);
      await db.query("rollback to savepoint s");
      expect(await removeWithApproval(db, hub, "stories", id)).toBe("approved");
      expect(await removeWithApproval(db, hub, "people", person)).toBe("approved");
    });
  });
});
