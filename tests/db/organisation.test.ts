import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DB, USERS, as, connect, count, hubClaims, type Session } from "./db";

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
const ORG = "a8000000-0000-4000-8000-000000000001";

async function visible(db: Client) {
  return {
    entities: await count(db, "select * from entities"),
    appointments: await count(db, "select * from appointments"),
    outside_organisations: await count(db, "select * from outside_organisations"),
  };
}

describe("the Organisation: who sees what", () => {
  it("Managers, Administrators and whole-family Viewers see every entity and appointment", async () => {
    for (const [u, aal] of [
      [USERS.hartleyManager, "aal2"],
      [USERS.hartleyAdministrator, "aal2"],
      [USERS.hartleyViewerWholeFamily, "aal1"],
    ] as const) {
      expect(await as(hartley, await signedIn(u, aal), visible)).toEqual({ entities: 2, appointments: 3, outside_organisations: 1 });
    }
  });

  it("a North branch Viewer sees only the North branch's entity", async () => {
    expect(await as(hartley, await signedIn(USERS.hartleyViewerBranch, "aal1"), visible)).toEqual({
      entities: 1,
      appointments: 1,
      outside_organisations: 1,
    });
  });

  it("an own-record Viewer sees no entities", async () => {
    expect(await as(hartley, await signedIn(USERS.hartleyViewerOwnRecord, "aal1"), visible)).toEqual({
      entities: 0,
      appointments: 0,
      outside_organisations: 1,
    });
  });

  it("another family's Manager and the System Admin see nothing", async () => {
    for (const u of [USERS.okaforManager, USERS.systemAdmin]) {
      expect(await as(hartley, await signedIn(u), visible)).toEqual({ entities: 0, appointments: 0, outside_organisations: 0 });
    }
  });
});

describe("the Organisation: who changes what", () => {
  it("Administrators add and change, but cannot remove", async () => {
    await as(hartley, await signedIn(USERS.hartleyAdministrator), async (db) => {
      await db.query("insert into entities (name, entity_type, jurisdiction, sub_type) values ('New Co Ltd', 'company', 'Mauritius', 'Domestic private company')");
      await db.query("update entities set activity = 'Holding company' where id = $1", [HOLDINGS]);
      await db.query("insert into appointments (entity_id, role, person_id) values ($1, 'secretary', $2)", [HOLDINGS, NORTH]);
      expect((await db.query("delete from entities")).rowCount).toBe(0);
      expect((await db.query("delete from appointments")).rowCount).toBe(0);
    });
  });

  it("Viewers cannot add or change anything", async () => {
    const v = await signedIn(USERS.hartleyViewerWholeFamily, "aal1");
    await expect(
      as(hartley, v, (db) => db.query("insert into appointments (entity_id, role, person_id) values ($1, 'director', $2)", [HOLDINGS, NORTH])),
    ).rejects.toThrow(/row-level security/);
    expect(await as(hartley, v, async (db) => (await db.query("update entities set activity = 'x'")).rowCount)).toBe(0);
  });

  it("Managers can remove", async () => {
    await as(hartley, await signedIn(USERS.hartleyManager), async (db) => {
      expect((await db.query("delete from entities where id = $1", [NORTH_TRUST])).rowCount).toBe(1);
      // Its appointments go with it.
      expect(await count(db, "select * from appointments where entity_id = '" + NORTH_TRUST + "'")).toBe(0);
    });
  });
});

describe("the Organisation: keeping records sound", () => {
  it("an appointment is held by a person or an organisation, never both or neither", async () => {
    await as(hartley, await signedIn(USERS.hartleyManager), async (db) => {
      await db.query("savepoint a");
      await expect(
        db.query("insert into appointments (entity_id, role, person_id, organisation_id) values ($1, 'trustee', $2, $3)", [NORTH_TRUST, NORTH, ORG]),
      ).rejects.toThrow(/check constraint/);
      await db.query("rollback to savepoint a");
      await expect(db.query("insert into appointments (entity_id, role) values ($1, 'trustee')", [NORTH_TRUST])).rejects.toThrow(/check constraint/);
    });
  });

  it("the same person holds a role once at a time; a past appointment can be held again", async () => {
    await as(hartley, await signedIn(USERS.hartleyManager), async (db) => {
      await db.query("savepoint a");
      await expect(db.query("insert into appointments (entity_id, role, person_id) values ($1, 'director', $2)", [HOLDINGS, NORTH])).rejects.toThrow(
        /duplicate key/,
      );
      await db.query("rollback to savepoint a");
      await db.query("update appointments set ceased_on = current_date where entity_id = $1 and person_id = $2", [HOLDINGS, NORTH]);
      await db.query("insert into appointments (entity_id, role, person_id, appointed_on) values ($1, 'director', $2, current_date)", [HOLDINGS, NORTH]);
    });
  });

  it("entity names are unique, currencies are three capital letters, and changes are logged", async () => {
    await as(hartley, await signedIn(USERS.hartleyManager), async (db) => {
      await db.query("savepoint a");
      await expect(
        db.query("insert into entities (name, entity_type, jurisdiction, sub_type) values ('test holdings ltd', 'company', 'United Kingdom', 'x')"),
      ).rejects.toThrow(/duplicate key/);
      await db.query("rollback to savepoint a");
      await expect(db.query("update entities set base_currency = 'pounds' where id = $1", [HOLDINGS])).rejects.toThrow(/check constraint/);
    });
    await as(hartley, await signedIn(USERS.hartleyManager), async (db) => {
      await db.query("update entities set activity = 'Investments' where id = $1", [HOLDINGS]);
      expect(await count(db, "select * from audit_log where table_name = 'entities' and action = 'update'")).toBe(1);
    });
  });
});
