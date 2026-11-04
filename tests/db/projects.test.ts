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
async function project(db: Client, title: string, about: { entity_id?: string; branch_id?: string } = {}) {
  const p = (await one(db, "insert into projects (title, entity_id, branch_id) values ($1, $2, $3) returning id", [title, about.entity_id ?? null, about.branch_id ?? null])).id as string;
  const g = (await one(db, "insert into project_goals (project_id, title, lead_person_id) values ($1, 'Goal one', $2) returning id", [p, HARTLEY_DB.northPerson])).id as string;
  await db.query("insert into todos (title, topic, project_goal_id) values ('First step', 'projects', $1), ('Second step', 'projects', $1), ('Third step', 'projects', $1)", [g]);
  await db.query("update todos set status = 'done' where title = 'First step' and project_goal_id = $1", [g]);
  return { p, g };
}

describe("Projects", () => {
  it("are seen by who may see what they are about; Viewers see progress counts but not the to-dos", async () => {
    const seen = await as(hartley, await signedIn(ADMIN), async (db) => {
      await project(db, "Family Constitution");
      await project(db, "Holdings refinancing", { entity_id: HOLDINGS });
      const north = await project(db, "North branch education", { branch_id: HARTLEY_DB.northBranch });
      const out: Record<string, { titles: string[]; progress: unknown; todos: number }> = {};
      for (const [u, aal] of [
        [USERS.hartleyViewerWholeFamily, "aal1"],
        [USERS.hartleyViewerBranch, "aal1"],
        [USERS.hartleyViewerWithMfa, "aal1"],
        [USERS.okaforManager, "aal2"],
      ] as const) {
        await switchUser(db, hub, u, aal);
        out[u] = {
          titles: (await db.query("select title from projects order by title")).rows.map((r) => r.title),
          progress: (await db.query("select total, done from public.project_progress($1)", [north.p])).rows,
          todos: await count(db, "select 1 from todos"),
        };
      }
      return out;
    });
    expect(seen[USERS.hartleyViewerWholeFamily].titles).toEqual(["Family Constitution", "Holdings refinancing", "North branch education"]);
    expect(seen[USERS.hartleyViewerWholeFamily].progress).toEqual([{ total: 3, done: 1 }]);
    expect(seen[USERS.hartleyViewerWholeFamily].todos).toBe(0);
    expect(seen[USERS.hartleyViewerBranch].titles).toEqual(["North branch education"]);
    expect(seen[USERS.hartleyViewerWithMfa].titles).toEqual([]);
    expect(seen[USERS.hartleyViewerWithMfa].progress).toEqual([]);
    expect(seen[USERS.okaforManager].titles).toEqual([]);
    expect(seen[USERS.okaforManager].progress).toEqual([]);
  });

  it("finishing records the date; reopening clears it; only a Manager changes what a project is about", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      const { p } = await project(db, "x", { branch_id: HARTLEY_DB.northBranch });
      await db.query("update projects set stage = 'completed', finished_note = 'Signed' where id = $1", [p]);
      expect((await one(db, "select finished_on is not null as f from projects where id = $1", [p])).f).toBe(true);
      await db.query("update projects set stage = 'under_way' where id = $1", [p]);
      expect((await one(db, "select finished_on, finished_note from projects where id = $1", [p]))).toEqual({ finished_on: null, finished_note: null });
      await fails(db, "update projects set branch_id = null where id = $1", [p], /only a Manager/);
      await fails(db, "update projects set stage = 'stopped', finished_on = current_date + 5 where id = $1", [p], /future/);
      await switchUser(db, hub, MANAGER);
      await db.query("update projects set branch_id = null where id = $1", [p]);
    });
  });

  it("a goal's to-dos stay in it, with the projects topic", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      const a = await project(db, "a");
      const b = await project(db, "b");
      await fails(db, "insert into todos (title, topic, project_goal_id) values ('x', 'actions', $1)", [a.g], /todos_goal_topic/);
      await fails(db, "update todos set project_goal_id = $1 where project_goal_id = $2", [b.g, a.g], /can't be moved/);
      await fails(db, "update project_goals set project_id = $1 where id = $2", [b.p, a.g], /can't be moved/);
    });
  });

  it("are removed by two people, with their goals and to-dos", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      const { p, g } = await project(db, "Gone");
      expect(await removeWithApproval(db, hub, "projects", p)).toBe("approved");
      expect(await count(db, "select 1 from todos where project_goal_id = $1", [g])).toBe(0);
    });
  });

  it("an entity with a project can't be removed until the project goes", async () => {
    await as(hartley, await signedIn(MANAGER), async (db) => {
      const e = (await one(db, "insert into entities (name, entity_type, jurisdiction, sub_type) values ('Test Co', 'company', 'United Kingdom', 'Private limited company') returning id")).id;
      const p = (await one(db, "insert into projects (title, entity_id) values ('About Test Co', $1) returning id", [e])).id;
      await db.query("savepoint s");
      await expect(removeWithApproval(db, hub, "entities", e)).rejects.toThrow(/projects about this/);
      await db.query("rollback to savepoint s");
      expect(await removeWithApproval(db, hub, "projects", p)).toBe("approved");
      expect(await removeWithApproval(db, hub, "entities", e)).toBe("approved");
    });
  });

  it("Viewers can't add projects", async () => {
    await as(hartley, await signedIn(USERS.hartleyViewerWholeFamily, "aal1"), async (db) => {
      await expect(db.query("insert into projects (title) values ('x')")).rejects.toThrow(/row-level security/);
    });
  });
});
