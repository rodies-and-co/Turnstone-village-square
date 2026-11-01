import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DB, HARTLEY_DB, HUB_ISSUER, USERS, as, asOwner, connect, count, hubClaims, tablesWithRls, type Session, removeWithApproval } from "./db";

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

// A signed-in user, with the claims the hub's real token hook gives them.
async function signedIn(id: string, aal: "aal1" | "aal2" = "aal2"): Promise<Session> {
  return { kind: "user", id, aal, claims: await hubClaims(hub, id) };
}

const people = (db: Client) => count(db, "select * from people");

describe("family database: every table is protected", () => {
  it("has row-level security switched on for every table", async () => {
    const tables = await tablesWithRls(hartley);
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) expect(t.rls, `${t.table} must have RLS`).toBe(true);
  });

  it("shows nothing to visitors who are not signed in", async () => {
    for (const table of ["family_settings", "branches", "people", "access_grants", "audit_log"]) {
      await expect(as(hartley, { kind: "anonymous" }, (db) => db.query(`select * from ${table}`))).rejects.toThrow(
        /permission denied/,
      );
    }
  });
});

describe("family database: families are kept apart", () => {
  it("the Hartley Manager sees Hartley people, and nothing in the Okafor database", async () => {
    const s = await signedIn(USERS.hartleyManager);
    expect(await as(hartley, s, people)).toBe(3);
    expect(await as(okafor, s, people)).toBe(0);
    expect(await as(okafor, s, (db) => count(db, "select * from family_settings"))).toBe(0);
  });

  it("the Okafor Manager cannot read or change anything in the Hartley database", async () => {
    const s = await signedIn(USERS.okaforManager);
    expect(await as(hartley, s, people)).toBe(0);
    await expect(
      as(hartley, s, (db) => db.query("insert into people (member_type, full_names, surname) values ('family', 'X', 'Y')")),
    ).rejects.toThrow(/row-level security/);
  });

  it("a token whose claims were edited for another family's id still gets nothing elsewhere", async () => {
    // Claims for Hartley presented to the Okafor database.
    const s: Session = {
      kind: "user",
      id: USERS.hartleyManager,
      aal: "aal2",
      claims: { iss: HUB_ISSUER, vs: { system_role: null, families: { "a0000000-0000-4000-8000-000000000001": "manager" }, mfa: true } },
    };
    expect(await as(okafor, s, people)).toBe(0);
  });
});

describe("family database: only the hub's tokens count", () => {
  it("ignores a token from another issuer, even with the right claims", async () => {
    const real = await signedIn(USERS.hartleyManager);
    const forged: Session = { ...real, claims: { ...(real as { claims: object }).claims, iss: "https://elsewhere.supabase.co/auth/v1" } } as Session;
    expect(await as(hartley, forged, people)).toBe(0);
  });
});

describe("family database: roles", () => {
  it("Managers and Administrators must have completed two-factor", async () => {
    for (const id of [USERS.hartleyManager, USERS.hartleyAdministrator]) {
      expect(await as(hartley, await signedIn(id, "aal1"), people)).toBe(0);
    }
  });

  it("an Administrator can add and change people but not remove them", async () => {
    const s = await signedIn(USERS.hartleyAdministrator);
    await as(hartley, s, async (db) => {
      await db.query("insert into people (member_type, full_names, surname) values ('non_family', 'Test', 'Adviser')");
      const updated = await db.query("update people set known_as = 'Art' where id = $1", [HARTLEY_DB.northPerson]);
      expect(updated.rowCount).toBe(1);
      const deleted = await db.query("delete from people where id = $1", [HARTLEY_DB.northPerson]);
      expect(deleted.rowCount).toBe(0);
    });
  });

  it("a person is removed only when one person asks and another Manager approves; Managers manage access grants", async () => {
    const s = await signedIn(USERS.hartleyManager);
    await as(hartley, s, async (db) => {
      expect((await db.query("delete from people where id = $1", [HARTLEY_DB.southPerson])).rowCount).toBe(0);
      // A beneficiary can't be removed from the Tree, so that goes first.
      const b = (await db.query("select id from beneficiaries where person_id = $1", [HARTLEY_DB.southPerson])).rows[0].id;
      expect(await removeWithApproval(db, hub, "beneficiaries", b)).toBe("approved");
      expect(await removeWithApproval(db, hub, "people", HARTLEY_DB.southPerson)).toBe("approved");
      expect(await count(db, `select * from people where id = '${HARTLEY_DB.southPerson}'`)).toBe(0);
      await db.query("insert into access_grants (user_id, scope) values ($1, 'whole_family')", [USERS.nobody]);
    });
  });

  it("an Administrator cannot widen what Viewers see by moving people or linking logins", async () => {
    const s = await signedIn(USERS.hartleyAdministrator);
    await expect(
      as(hartley, s, (db) => db.query("update people set branch_id = $1 where id = $2", [HARTLEY_DB.northBranch, HARTLEY_DB.southPerson])),
    ).rejects.toThrow(/Only a Manager/);
    await expect(
      as(hartley, s, (db) => db.query("update people set user_id = $1 where id = $2", [USERS.hartleyViewerOwnRecord, HARTLEY_DB.northPerson])),
    ).rejects.toThrow(/Only a Manager/);
    await expect(
      as(hartley, s, (db) =>
        db.query("insert into people (member_type, full_names, surname, user_id) values ('family', 'X', 'Y', $1)", [USERS.nobody]),
      ),
    ).rejects.toThrow(/Only a Manager/);
    // Placing a new person in a branch is normal data entry.
    await as(hartley, s, (db) =>
      db.query("insert into people (member_type, full_names, surname, branch_id) values ('family', 'X', 'Y', $1)", [HARTLEY_DB.northBranch]),
    );
  });

  it("a Manager can move people between branches and link logins", async () => {
    const s = await signedIn(USERS.hartleyManager);
    await as(hartley, s, async (db) => {
      await db.query("update people set branch_id = $1 where id = $2", [HARTLEY_DB.northBranch, HARTLEY_DB.southPerson]);
      await db.query("update people set user_id = $1 where id = $2", [USERS.nobody, HARTLEY_DB.northPerson]);
    });
  });

  it("an Administrator cannot manage access grants", async () => {
    const s = await signedIn(USERS.hartleyAdministrator);
    await expect(
      as(hartley, s, (db) => db.query("insert into access_grants (user_id, scope) values ($1, 'whole_family')", [USERS.nobody])),
    ).rejects.toThrow(/row-level security/);
  });

  it("the Super User sees every family database; the System Admin sees no family records", async () => {
    const su = await signedIn(USERS.superUser);
    expect(await as(hartley, su, people)).toBe(3);
    expect(await as(okafor, su, people)).toBe(2);
    expect(await as(hartley, await signedIn(USERS.superUser, "aal1"), people)).toBe(0);
    const sa = await signedIn(USERS.systemAdmin);
    expect(await as(hartley, sa, people)).toBe(0);
  });
});

describe("family database: Viewers see only what they are granted", () => {
  it("a whole-family Viewer sees everyone but cannot change anything", async () => {
    const s = await signedIn(USERS.hartleyViewerWholeFamily, "aal1");
    expect(await as(hartley, s, people)).toBe(3);
    await expect(
      as(hartley, s, (db) => db.query("insert into people (member_type, full_names, surname) values ('family', 'X', 'Y')")),
    ).rejects.toThrow(/row-level security/);
    const updated = await as(hartley, s, (db) => db.query("update people set known_as = 'X'"));
    expect(updated.rowCount).toBe(0);
  });

  it("a branch Viewer sees only people in that branch", async () => {
    const s = await signedIn(USERS.hartleyViewerBranch, "aal1");
    const ids = await as(hartley, s, async (db) => (await db.query("select id from people")).rows.map((r) => r.id));
    expect(ids).toEqual([HARTLEY_DB.northPerson]);
  });

  it("an own-record Viewer sees only their own record", async () => {
    const s = await signedIn(USERS.hartleyViewerOwnRecord, "aal1");
    const ids = await as(hartley, s, async (db) => (await db.query("select id from people")).rows.map((r) => r.id));
    expect(ids).toEqual([HARTLEY_DB.ownPerson]);
  });

  it("a Viewer who set up two-factor must use it", async () => {
    expect(await as(hartley, await signedIn(USERS.hartleyViewerWithMfa, "aal1"), people)).toBe(0);
    expect(await as(hartley, await signedIn(USERS.hartleyViewerWithMfa, "aal2"), people)).toBe(3);
  });

  it("Viewers cannot see the audit log or other people's grants", async () => {
    const s = await signedIn(USERS.hartleyViewerWholeFamily, "aal1");
    expect(await as(hartley, s, (db) => count(db, "select * from audit_log"))).toBe(0);
    expect(await as(hartley, s, (db) => count(db, "select * from access_grants"))).toBe(1);
  });
});

describe("family database: safeguards", () => {
  it("logs changes and the log cannot be changed", async () => {
    const s = await signedIn(USERS.hartleyAdministrator);
    await as(hartley, s, (db) => db.query("update people set known_as = 'Art' where id = $1", [HARTLEY_DB.northPerson]));
    await asOwner(hartley, async (db) => {
      await db.query("update people set known_as = 'Art' where id = $1", [HARTLEY_DB.northPerson]);
      expect(await count(db, "select * from audit_log where table_name = 'people' and action = 'update'")).toBeGreaterThan(0);
      await expect(db.query("delete from audit_log")).rejects.toThrow(/cannot be changed/);
    });
  });

  it("the audit log cannot be emptied, and the secret key cannot touch it or the settings", async () => {
    await asOwner(hartley, async (db) => {
      await expect(db.query("truncate audit_log")).rejects.toThrow(/cannot be changed/);
    });
    for (const sql of ["insert into audit_log (action) values ('fake')", "delete from audit_log", "delete from family_settings"]) {
      await asOwner(hartley, async (db) => {
        await db.query("set local role service_role");
        await expect(db.query(sql)).rejects.toThrow(/permission denied/);
      });
    }
  });

  it("the family settings cannot be removed and replaced", async () => {
    await asOwner(hartley, async (db) => {
      await expect(db.query("delete from family_settings")).rejects.toThrow(/cannot be removed or replaced/);
    });
    await asOwner(hartley, async (db) => {
      await expect(db.query("truncate family_settings")).rejects.toThrow(/cannot be removed or replaced/);
    });
  });

  it("the family id and hub of a database can never be changed", async () => {
    await asOwner(hartley, async (db) => {
      await expect(
        db.query("update family_settings set family_id = 'b0000000-0000-4000-8000-000000000001'"),
      ).rejects.toThrow(/cannot be changed/);
    });
    await asOwner(hartley, async (db) => {
      await expect(
        db.query("update family_settings set hub_issuer = 'https://elsewhere.supabase.co/auth/v1'"),
      ).rejects.toThrow(/cannot be changed/);
    });
  });
});
