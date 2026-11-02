import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DB, HARTLEY_DB, USERS, as, connect, count, hubClaims, switchUser, type Session } from "./db";

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
async function refused(db: Client, sql: string, params: unknown[], message: RegExp) {
  await db.query("savepoint step");
  await expect(db.query(sql, params)).rejects.toThrow(message);
  await db.query("rollback to savepoint step");
}

const ASK = "select public.request_removal($1, $2, $3) as id";
const APPROVE = "select public.decide_removal($1, true)";
const REJECT = "select public.decide_removal($1, false, 'Keep it')";
const passportId = async (db: Client) => (await db.query("select id from passports where number = 'TEST1001'")).rows[0].id as string;

describe("Removals: two people for every removal", () => {
  it("nobody can remove records directly, not even a Manager or the Super User", async () => {
    for (const u of [USERS.hartleyManager, USERS.superUser]) {
      await as(hartley, await signedIn(u), async (db) => {
        for (const t of ["people", "passports", "entities", "appointments", "branches", "family_statements", "share_transactions", "beneficiaries"]) {
          expect((await db.query(`delete from ${t}`)).rowCount).toBe(0);
        }
      });
    }
  });

  it("an Administrator asks; the record stays until another Manager approves", async () => {
    await as(hartley, await signedIn(USERS.hartleyAdministrator), async (db) => {
      const id = await passportId(db);
      const req = (await db.query(ASK, ["passports", id, "Expired"])).rows[0].id;
      expect(await count(db, "select * from passports where number = 'TEST1001'")).toBe(1);
      const r = (await db.query("select status, summary, reason, snapshot->>'number' as number, requested_by from removal_requests where id = $1", [req])).rows[0];
      expect(r).toMatchObject({ status: "pending", reason: "Expired", number: "TEST1001", requested_by: USERS.hartleyAdministrator });
      expect(r.summary).toMatch(/^Passport: .*TEST1001/);
      await refused(db, APPROVE, [req], /only a Manager/);
      await switchUser(db, hub, USERS.hartleyManager);
      await db.query(APPROVE, [req]);
      expect(await count(db, "select * from passports where number = 'TEST1001'")).toBe(0);
      const done = (await db.query("select status, decided_by from removal_requests where id = $1", [req])).rows[0];
      expect(done).toEqual({ status: "approved", decided_by: USERS.hartleyManager });
      expect(await count(db, "select * from audit_log where table_name = 'passports' and action = 'delete'")).toBe(1);
    });
  });

  it("whoever asked can't approve, even a Manager or the Super User", async () => {
    for (const u of [USERS.hartleyManager, USERS.superUser]) {
      await as(hartley, await signedIn(u), async (db) => {
        const req = (await db.query(ASK, ["passports", await passportId(db), null])).rows[0].id;
        await refused(db, APPROVE, [req], /can't also approve/);
        expect(await count(db, "select * from passports where number = 'TEST1001'")).toBe(1);
      });
    }
  });

  it("a Manager can reject; whoever asked can withdraw; each request is dealt with once", async () => {
    await as(hartley, await signedIn(USERS.hartleyAdministrator), async (db) => {
      const id = await passportId(db);
      const first = (await db.query(ASK, ["passports", id, null])).rows[0].id;
      await refused(db, ASK, ["passports", id, null], /already been asked for/);
      await switchUser(db, hub, USERS.hartleyManager);
      await db.query(REJECT, [first]);
      await refused(db, APPROVE, [first], /already been dealt with/);
      expect(await count(db, "select * from passports where number = 'TEST1001'")).toBe(1);

      await switchUser(db, hub, USERS.hartleyAdministrator);
      const second = (await db.query(ASK, ["passports", id, null])).rows[0].id;
      await switchUser(db, hub, USERS.hartleyManager);
      await refused(db, "select public.withdraw_removal($1)", [second], /only whoever asked/);
      await switchUser(db, hub, USERS.hartleyAdministrator);
      await db.query("select public.withdraw_removal($1)", [second]);
      expect((await db.query("select status from removal_requests where id = $1", [second])).rows[0].status).toBe("withdrawn");
    });
  });

  it("Viewers can't ask, and don't see the requests", async () => {
    await as(hartley, await signedIn(USERS.hartleyAdministrator), async (db) => {
      await db.query(ASK, ["passports", await passportId(db), null]);
      await switchUser(db, hub, USERS.hartleyViewerWholeFamily, "aal1");
      expect(await count(db, "select * from removal_requests")).toBe(0);
      await refused(db, ASK, ["people", HARTLEY_DB.northPerson, null], /only a Manager or Administrator/);
    });
  });

  it("requests can't be written or changed directly", async () => {
    await as(hartley, await signedIn(USERS.hartleyManager), async (db) => {
      await refused(
        db,
        "insert into removal_requests (table_name, record_id, summary, snapshot, requested_by) values ('people', $1, 'x', '{}', $2)",
        [HARTLEY_DB.northPerson, USERS.hartleyAdministrator],
        /row-level security|permission denied/,
      );
      await db.query("select public.request_removal('passports', (select id from passports where number = 'TEST1001'))");
      expect((await db.query("update removal_requests set requested_by = $1", [USERS.hartleyAdministrator])).rowCount).toBe(0);
    });
  });

  it("only known kinds of record can be asked for", async () => {
    await as(hartley, await signedIn(USERS.hartleyManager), async (db) => {
      await refused(db, ASK, ["audit_log", HARTLEY_DB.northPerson, null], /can't be removed/);
      await refused(db, ASK, ["removal_requests", HARTLEY_DB.northPerson, null], /can't be removed/);
      await refused(db, ASK, ["passports", HARTLEY_DB.northPerson, null], /isn't there/);
    });
  });

  it("a Viewer's access can still be taken away at once by a Manager", async () => {
    await as(hartley, await signedIn(USERS.hartleyManager), async (db) => {
      expect((await db.query("delete from access_grants where user_id = $1", [USERS.hartleyViewerWholeFamily])).rowCount).toBeGreaterThan(0);
    });
  });

  it("another family's Manager can't ask for or approve anything here", async () => {
    await as(hartley, await signedIn(USERS.okaforManager), async (db) => {
      await refused(db, ASK, ["people", HARTLEY_DB.northPerson, null], /only a Manager or Administrator/);
    });
  });
});

describe("Removals: only exactly what was asked for is removed", () => {
  it("a record changed after the request isn't removed", async () => {
    await as(hartley, await signedIn(USERS.hartleyAdministrator), async (db) => {
      const id = await passportId(db);
      const req = (await db.query(ASK, ["passports", id, null])).rows[0].id;
      await db.query("update passports set number = 'TEST9999' where id = $1", [id]);
      await switchUser(db, hub, USERS.hartleyManager);
      await refused(db, APPROVE, [req], /changed since/);
      expect(await count(db, "select * from passports where number = 'TEST9999'")).toBe(1);
    });
  });

  it("an id swapped onto another record doesn't remove that other record", async () => {
    await as(hartley, await signedIn(USERS.hartleyAdministrator), async (db) => {
      const id = await passportId(db);
      const req = (await db.query(ASK, ["passports", id, null])).rows[0].id;
      await db.query("update passports set id = gen_random_uuid() where id = $1", [id]);
      const other = (await db.query("select id from passports where number <> 'TEST1001' limit 1")).rows[0]?.id;
      if (other) await db.query("update passports set id = $1 where id = $2", [id, other]);
      await switchUser(db, hub, USERS.hartleyManager);
      if (other) await refused(db, APPROVE, [req], /changed since/);
      expect(await count(db, "select * from passports")).toBeGreaterThan(0);
    });
  });

  it("records moved under it after the request stop the removal; what goes with it is listed and kept", async () => {
    await as(hartley, await signedIn(USERS.hartleyAdministrator), async (db) => {
      const body = (await db.query("insert into governance_bodies (kind, name) values ('other', 'Temp') returning id")).rows[0].id;
      const req = (await db.query(ASK, ["governance_bodies", body, null])).rows[0].id;
      const seat = (await db.query("select id from body_members limit 1")).rows[0]?.id;
      expect(seat).toBeTruthy();
      await db.query("update body_members set body_id = $1 where id = $2", [body, seat]);
      await switchUser(db, hub, USERS.hartleyManager);
      await refused(db, APPROVE, [req], /changed since/);
      // Asked again now, the seat is listed and kept with the request.
      await db.query("select public.decide_removal($1, false)", [req]);
      await switchUser(db, hub, USERS.hartleyAdministrator);
      const again = (await db.query(ASK, ["governance_bodies", body, null])).rows[0].id;
      const r = (await db.query("select summary, goes_with from removal_requests where id = $1", [again])).rows[0];
      expect(r.summary).toMatch(/and 1 linked record/);
      expect(r.goes_with[0].table).toBe("body_members");
    });
  });

  it("whoever asked can't turn it down (they withdraw it instead)", async () => {
    await as(hartley, await signedIn(USERS.hartleyManager), async (db) => {
      const req = (await db.query(ASK, ["passports", await passportId(db), null])).rows[0].id;
      await refused(db, REJECT, [req], /withdraw it instead/);
    });
  });
});

describe("the hub: no family is removed by one person", () => {
  it("not even the Super User can remove a family directly", async () => {
    await as(hub, await signedIn(USERS.superUser), async (db) => {
      expect((await db.query("delete from families")).rowCount).toBe(0);
    });
  });
});

describe("starting a branch happens all at once", () => {
  it("creates the branch and puts its head in it, or does neither", async () => {
    await as(hartley, await signedIn(USERS.hartleyManager), async (db) => {
      const b = (await db.query("select public.start_branch($1, 'Test New Branch') as id", [HARTLEY_DB.ownPerson])).rows[0].id;
      expect((await db.query("select branch_id from people where id = $1", [HARTLEY_DB.ownPerson])).rows[0].branch_id).toBe(b);
      await refused(db, "select public.start_branch($1, 'Another Branch')", ["00000000-0000-4000-8000-000000000000"], /couldn't be found|foreign key/);
      expect(await count(db, "select * from branches where name = 'Another Branch'")).toBe(0);
    });
  });

  it("an Administrator can't start a branch", async () => {
    await as(hartley, await signedIn(USERS.hartleyAdministrator), async (db) => {
      await refused(db, "select public.start_branch($1, 'Admin Branch')", [HARTLEY_DB.ownPerson], /row-level security|Only a Manager|permission/);
    });
  });
});

describe("review fixes", () => {
  it("Viewers see only the service providers serving something they may see", async () => {
    await as(hartley, await signedIn(USERS.hartleyManager), async (db) => {
      await db.query("insert into outside_organisations (name, kind) values ('Unused Provider Ltd', 'other')");
      await switchUser(db, hub, USERS.hartleyViewerOwnRecord, "aal1");
      expect(await count(db, "select * from outside_organisations")).toBe(0);
      await switchUser(db, hub, USERS.hartleyViewerBranch, "aal1");
      // The trust company is trustee of the North trust, which this Viewer may see.
      expect((await db.query("select name from outside_organisations")).rows.map((r) => r.name)).toEqual(["Test Trust Company Ltd"]);
    });
  });

  it("an entity or provider with a current appointment can't be removed; once ended, its past appointments go with it", async () => {
    await as(hartley, await signedIn(USERS.hartleyAdministrator), async (db) => {
      const trust = "a9000000-0000-4000-8000-000000000002";
      const holdings = "a9000000-0000-4000-8000-000000000001";
      await db.query("insert into appointments (entity_id, role, holder_entity_id, basis) values ($1, 'director', $2, 'formation')", [holdings, trust]);
      await refused(db, ASK, ["entities", trust, null], /still holds a role/);
      const org = (await db.query("select id from outside_organisations limit 1")).rows[0].id;
      await refused(db, ASK, ["outside_organisations", org, null], /still holds a current appointment/);
      await db.query("update appointments set ceased_on = current_date where organisation_id = $1", [org]);
      const req = (await db.query(ASK, ["outside_organisations", org, null])).rows[0].id;
      expect((await db.query("select summary from removal_requests where id = $1", [req])).rows[0].summary).toMatch(/linked record/);
    });
  });

  it("whether a database is a practice family can't be changed", async () => {
    await as(hartley, await signedIn(USERS.superUser), async (db) => {
      await db.query("reset role");
      expect((await db.query("select is_practice from family_settings")).rows[0].is_practice).toBe(false);
      await refused(db, "update family_settings set is_practice = true", [], /can't be changed/);
    });
  });
});
