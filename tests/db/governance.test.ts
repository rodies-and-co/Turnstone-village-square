import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DB, USERS, as, connect, count, hubClaims, type Session } from "./db";

let hub: Client;
let hartley: Client;
let okafor: Client;

beforeAll(async () => {
  hub = await connect(DB.hub);
  hartley = await connect(DB.familyA);
  okafor = await connect(DB.familyB);
});

afterAll(async () => {
  await Promise.all([hub.end(), hartley.end(), okafor.end()]);
});

async function signedIn(id: string, aal: "aal1" | "aal2" = "aal2"): Promise<Session> {
  return { kind: "user", id, aal, claims: await hubClaims(hub, id) };
}

const TABLES = ["governance_bodies", "body_members", "advisors", "advisor_roles", "family_statements"];
async function visible(db: Client) {
  const out: Record<string, number> = {};
  for (const t of TABLES) out[t] = await count(db, `select * from ${t}`);
  return out;
}
const PURPOSE = "a7000000-0000-4000-8000-000000000001";

describe("governance: who sees what", () => {
  it("Managers and Administrators see everything", async () => {
    for (const u of [USERS.hartleyManager, USERS.hartleyAdministrator]) {
      expect(await as(hartley, await signedIn(u), visible)).toEqual({
        governance_bodies: 2,
        body_members: 3,
        advisors: 1,
        advisor_roles: 2,
        family_statements: 2,
      });
    }
  });

  it("a whole-family Viewer sees everything for the family and every branch", async () => {
    expect(await as(hartley, await signedIn(USERS.hartleyViewerWholeFamily, "aal1"), visible)).toEqual({
      governance_bodies: 2,
      body_members: 3,
      advisors: 1,
      advisor_roles: 2,
      family_statements: 2,
    });
  });

  it("a North branch Viewer sees the family's items and North's, not South's", async () => {
    expect(await as(hartley, await signedIn(USERS.hartleyViewerBranch, "aal1"), visible)).toEqual({
      governance_bodies: 2,
      // Only the members they may see: North's person, not South's.
      body_members: 2,
      advisors: 1,
      advisor_roles: 1,
      family_statements: 2,
    });
  });

  it("an own-record Viewer sees only whole-family items, and only members they may see", async () => {
    expect(await as(hartley, await signedIn(USERS.hartleyViewerOwnRecord, "aal1"), visible)).toEqual({
      governance_bodies: 1,
      body_members: 0,
      advisors: 1,
      advisor_roles: 1,
      family_statements: 1,
    });
  });

  it("another family's Manager and the System Admin see nothing", async () => {
    for (const u of [USERS.okaforManager, USERS.systemAdmin]) {
      const v = await as(hartley, await signedIn(u), visible);
      for (const t of TABLES) expect(v[t], `${u} ${t}`).toBe(0);
    }
  });
});

describe("governance: who changes what", () => {
  it("Administrators add and change, but cannot remove", async () => {
    await as(hartley, await signedIn(USERS.hartleyAdministrator), async (db) => {
      await db.query("insert into advisors (full_name, profession) values ('Another Adviser', 'accountant')");
      await db.query("update governance_bodies set meets = 'Twice a year'");
      expect((await db.query("delete from advisors")).rowCount).toBe(0);
      expect((await db.query("delete from governance_bodies")).rowCount).toBe(0);
    });
  });

  it("Viewers cannot add or change anything", async () => {
    const v = await signedIn(USERS.hartleyViewerWholeFamily, "aal1");
    await expect(
      as(hartley, v, (db) => db.query("insert into family_statements (kind, title, body) values ('values', 'X', 'Y')")),
    ).rejects.toThrow(/row-level security/);
    expect(await as(hartley, v, async (db) => (await db.query("update governance_bodies set meets = 'x'")).rowCount)).toBe(0);
  });

  it("two branches can each have a body with the same name", async () => {
    await as(hartley, await signedIn(USERS.hartleyManager), async (db) => {
      await db.query("insert into governance_bodies (kind, name, branch_id) values ('branch_council', 'Branch council', 'a1000000-0000-4000-8000-000000000001')");
      await db.query("insert into governance_bodies (kind, name, branch_id) values ('branch_council', 'Branch council', 'a1000000-0000-4000-8000-000000000002')");
      await expect(db.query("insert into governance_bodies (kind, name) values ('family_council', 'hartley family council')")).rejects.toThrow(/duplicate key/);
    });
  });

  it("one current seat per person on a body", async () => {
    await as(hartley, await signedIn(USERS.hartleyManager), async (db) => {
      await expect(
        db.query("insert into body_members (body_id, person_id) values ('a5000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001')"),
      ).rejects.toThrow(/duplicate key/);
    });
  });
});

describe("purpose and values: prepared, then adopted by someone else", () => {
  // Each scenario runs as one sequence in one transaction (rolled back at the
  // end), switching between people as it goes.
  async function become(db: Client, id: string) {
    const s = await signedIn(id);
    if (s.kind !== "user") return;
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ ...(s.claims ?? {}), sub: s.id, role: "authenticated", aal: s.aal }),
    ]);
  }
  // A step that must be refused, without spoiling the rest of the sequence.
  async function refused(db: Client, sql: string, params: unknown[], message: RegExp) {
    await db.query("savepoint step");
    await expect(db.query(sql, params)).rejects.toThrow(message);
    await db.query("rollback to savepoint step");
  }
  const reword = (db: Client, wording: string) => db.query("update family_statements set body = $1 where id = $2", [wording, PURPOSE]);
  const ADOPT = "update family_statements set status = 'adopted' where id = $1";
  const row = async (db: Client) =>
    (await db.query("select status, prepared_by, adopted_by, adopted_on from family_statements where id = $1", [PURPOSE])).rows[0];

  it("an Administrator can prepare but not adopt or withdraw", async () => {
    await as(hartley, await signedIn(USERS.hartleyAdministrator), async (db) => {
      await reword(db, "Administrator wording.");
      await refused(db, ADOPT, [PURPOSE], /only a Manager can adopt/);
      await become(db, USERS.hartleyManager);
      await db.query(ADOPT, [PURPOSE]);
      await become(db, USERS.hartleyAdministrator);
      await refused(db, "update family_statements set status = 'draft' where id = $1", [PURPOSE], /only a Manager can withdraw/);
    });
  });

  it("whoever prepared the wording can't adopt it; another Manager can", async () => {
    await as(hartley, await signedIn(USERS.hartleyManager), async (db) => {
      await reword(db, "Manager wording.");
      await refused(db, ADOPT, [PURPOSE], /can't also adopt it/);
      await become(db, USERS.superUser);
      await db.query(ADOPT, [PURPOSE]);
      const r = await row(db);
      expect(r.status).toBe("adopted");
      expect(r.prepared_by).toBe(USERS.hartleyManager);
      expect(r.adopted_by).toBe(USERS.superUser);
      expect(r.adopted_on).not.toBeNull();
    });
  });

  it("rewording an adopted statement makes it a draft again, prepared by whoever reworded it", async () => {
    await as(hartley, await signedIn(USERS.hartleyAdministrator), async (db) => {
      await reword(db, "Administrator wording.");
      await become(db, USERS.hartleyManager);
      await db.query(ADOPT, [PURPOSE]);
      await reword(db, "Changed after adoption.");
      expect(await row(db)).toEqual({ status: "draft", prepared_by: USERS.hartleyManager, adopted_by: null, adopted_on: null });
    });
  });

  it("withdrawing can't change who prepared it, so the preparer can never adopt their own wording", async () => {
    await as(hartley, await signedIn(USERS.hartleyManager), async (db) => {
      await reword(db, "Manager wording.");
      await become(db, USERS.superUser);
      await db.query(ADOPT, [PURPOSE]);
      await become(db, USERS.hartleyManager);
      await db.query("update family_statements set status = 'draft', prepared_by = $1 where id = $2", [USERS.superUser, PURPOSE]);
      expect((await row(db)).prepared_by).toBe(USERS.hartleyManager);
      await refused(db, ADOPT, [PURPOSE], /can't also adopt it/);
    });
  });

  it("an adopter can't rewrite who prepared it", async () => {
    await as(hartley, await signedIn(USERS.hartleyAdministrator), async (db) => {
      await reword(db, "Administrator wording.");
      await become(db, USERS.hartleyManager);
      await db.query("update family_statements set status = 'adopted', prepared_by = $1 where id = $2", [USERS.hartleyManager, PURPOSE]);
      const r = await row(db);
      expect(r.prepared_by).toBe(USERS.hartleyAdministrator);
      expect(r.adopted_by).toBe(USERS.hartleyManager);
    });
  });

  it("nobody can set who prepared or adopted it directly", async () => {
    await as(hartley, await signedIn(USERS.hartleyAdministrator), async (db) => {
      await reword(db, "Administrator wording.");
      await db.query("update family_statements set prepared_by = $1, adopted_by = $1 where id = $2", [USERS.superUser, PURPOSE]);
      const r = await row(db);
      expect(r.prepared_by).toBe(USERS.hartleyAdministrator);
      expect(r.adopted_by).toBeNull();
    });
  });

  it("new statements start as drafts with no adoption details", async () => {
    await as(hartley, await signedIn(USERS.hartleyManager), async (db) => {
      await refused(
        db,
        "insert into family_statements (kind, title, body, status) values ('values', 'X', 'Y', 'adopted')",
        [],
        /starts as a draft/,
      );
      const { rows } = await db.query(
        "insert into family_statements (kind, title, body, adopted_on, adopted_by) values ('values', 'X', 'Y', '2001-01-01', $1) returning status, prepared_by, adopted_on, adopted_by",
        [USERS.hartleyAdministrator],
      );
      expect(rows[0]).toEqual({ status: "draft", prepared_by: USERS.hartleyManager, adopted_on: null, adopted_by: null });
    });
  });
});
