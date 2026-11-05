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
const one = async (db: Client, sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0];
async function fails(db: Client, sql: string, params: unknown[], match: RegExp) {
  await db.query("savepoint f");
  await expect(db.query(sql, params)).rejects.toThrow(match);
  await db.query("rollback to savepoint f");
}

describe("The advisory team", () => {
  it("places cover a domain; one coordinator per circle; assessments are for the team only", async () => {
    await as(hartley, await signedIn(USERS.hartleyAdministrator), async (db) => {
      const a = (await one(db, "insert into advisors (full_name, profession) values ('Test Lawyer', 'lawyer') returning id")).id;
      const b = (await one(db, "insert into advisors (full_name, profession) values ('Test Coach', 'facilitator') returning id")).id;
      const r1 = (await one(db, "insert into advisor_roles (advisor_id, domain, coordinator) values ($1, 'estate_legal', true) returning id", [a])).id;
      await fails(db, "insert into advisor_roles (advisor_id, domain, coordinator) values ($1, 'dynamics', true)", [b], /advisor_roles_one_coordinator/);
      await db.query("insert into advisor_roles (advisor_id, branch_id, domain, coordinator) values ($1, $2, 'learning', true)", [b, HARTLEY_DB.northBranch]);
      await fails(db, "insert into advisor_roles (advisor_id, domain) values ($1, 'estate_legal')", [a], /advisor_roles_once/);
      await fails(db, "insert into advisor_roles (advisor_id) values ($1)", [a], /advisor_roles_says_what/);
      await fails(db, "update advisor_roles set branch_id = $2 where id = $1", [r1, HARTLEY_DB.northBranch], /can't be moved/);
      await db.query("insert into advisor_assessments (role_id, relationship, note) values ($1, 'weak', 'Slow to reply')", [r1]);
      expect((await one(db, "select assessed_by from advisor_assessments where role_id = $1", [r1])).assessed_by).toBe(USERS.hartleyAdministrator);
      // Ending a place stops it coordinating.
      await db.query("update advisor_roles set to_date = current_date where id = $1", [r1]);
      expect((await one(db, "select coordinator from advisor_roles where id = $1", [r1])).coordinator).toBe(false);
      await switchUser(db, hub, USERS.hartleyViewerWholeFamily, "aal1");
      expect(await count(db, "select 1 from advisor_roles where domain is not null")).toBeGreaterThanOrEqual(2);
      expect(await count(db, "select 1 from advisor_assessments")).toBe(0);
      await switchUser(db, hub, USERS.okaforManager);
      expect(await count(db, "select 1 from advisor_roles")).toBe(0);
    });
  });

  it("a place in a circle is removed by two people, with its assessment", async () => {
    await as(hartley, await signedIn(USERS.hartleyAdministrator), async (db) => {
      const a = (await one(db, "insert into advisors (full_name) values ('Test Banker') returning id")).id;
      const r = (await one(db, "insert into advisor_roles (advisor_id, domain) values ($1, 'financial') returning id", [a])).id;
      await db.query("insert into advisor_assessments (role_id) values ($1)", [r]);
      expect(await removeWithApproval(db, hub, "advisor_roles", r)).toBe("approved");
      expect(await count(db, "select 1 from advisor_assessments where role_id = $1", [r])).toBe(0);
    });
  });
});
