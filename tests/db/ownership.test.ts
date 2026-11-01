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
const ORDINARY = "aa000000-0000-4000-8000-000000000001";
const DRAFT_ISSUE = "ab000000-0000-4000-8000-000000000004";
const NORTH = "a2000000-0000-4000-8000-000000000001";
const SOUTH = "a2000000-0000-4000-8000-000000000002";
const DESCENDANTS = "ac000000-0000-4000-8000-000000000001";

async function visible(db: Client) {
  return {
    share_classes: await count(db, "select * from share_classes"),
    share_transactions: await count(db, "select * from share_transactions"),
    settlements: await count(db, "select * from settlements"),
    beneficiaries: await count(db, "select * from beneficiaries"),
    beneficiary_classes: await count(db, "select * from beneficiary_classes"),
    beneficiary_class_members: await count(db, "select * from beneficiary_class_members"),
  };
}

describe("Ownership: who sees what", () => {
  it("Managers, Administrators and whole-family Viewers see everything", async () => {
    for (const [u, aal] of [
      [USERS.hartleyManager, "aal2"],
      [USERS.hartleyAdministrator, "aal2"],
      [USERS.hartleyViewerWholeFamily, "aal1"],
    ] as const) {
      expect(await as(hartley, await signedIn(u, aal), visible)).toEqual({
        share_classes: 1,
        share_transactions: 4,
        settlements: 1,
        beneficiaries: 1,
        beneficiary_classes: 1,
        beneficiary_class_members: 1,
      });
    }
  });

  it("a North branch Viewer sees the North trust's records, but not the whole-family company's shares, nor people hidden from them", async () => {
    expect(await as(hartley, await signedIn(USERS.hartleyViewerBranch, "aal1"), visible)).toEqual({
      share_classes: 0,
      share_transactions: 0,
      settlements: 1,
      beneficiaries: 0, // the South person is hidden from a North Viewer
      beneficiary_classes: 1,
      beneficiary_class_members: 1,
    });
  });

  it("an own-record Viewer, another family's Manager and the System Admin see nothing", async () => {
    for (const [u, aal] of [
      [USERS.hartleyViewerOwnRecord, "aal1"],
      [USERS.okaforManager, "aal2"],
      [USERS.systemAdmin, "aal2"],
    ] as const) {
      expect(Object.values(await as(hartley, await signedIn(u, aal), visible)).every((n) => n === 0)).toBe(true);
    }
  });
});

describe("Ownership: share transactions are prepared by one person and approved by another", () => {
  async function become(db: Client, id: string) {
    const s = await signedIn(id);
    if (s.kind !== "user") return;
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ ...(s.claims ?? {}), sub: s.id, role: "authenticated", aal: s.aal }),
    ]);
  }
  async function refused(db: Client, sql: string, params: unknown[], message: RegExp) {
    await db.query("savepoint step");
    await expect(db.query(sql, params)).rejects.toThrow(message);
    await db.query("rollback to savepoint step");
  }
  const APPROVE = "update share_transactions set status = 'approved' where id = $1";
  const DRAFT = `insert into share_transactions (entity_id, class_id, kind, transaction_date, shares, to_person_id, from_person_id, certificate_number, balance_certificate_number)
    values ($1, $2, $3, current_date, $4, $5, $6, $7, $8) returning id`;
  async function draft(db: Client, kind: string, shares: number, to: string | null, from: string | null = null, cert: string | null = null, balance: string | null = null) {
    return (await db.query(DRAFT, [HOLDINGS, ORDINARY, kind, shares, to, from, cert, balance])).rows[0].id as string;
  }

  it("a new transaction is always a draft, prepared by whoever recorded it", async () => {
    await as(hartley, await signedIn(USERS.hartleyAdministrator), async (db) => {
      await refused(
        db,
        "insert into share_transactions (entity_id, class_id, kind, transaction_date, shares, status, approved_by, approved_at) values ($1, $2, 'authorise', current_date, 5, 'approved', $3, now())",
        [HOLDINGS, ORDINARY, USERS.hartleyAdministrator],
        /starts as a draft/,
      );
      const id = await draft(db, "authorise", 5, null);
      const r = (await db.query("select status, prepared_by from share_transactions where id = $1", [id])).rows[0];
      expect(r).toEqual({ status: "draft", prepared_by: USERS.hartleyAdministrator });
    });
  });

  it("an Administrator can't approve; the preparer can't approve; another Manager can", async () => {
    await as(hartley, await signedIn(USERS.hartleyAdministrator), async (db) => {
      await refused(db, APPROVE, [DRAFT_ISSUE], /only a Manager/);
      await become(db, USERS.hartleyManager);
      const own = await draft(db, "authorise", 5, null);
      await refused(db, APPROVE, [own], /can't also approve/);
      await db.query(APPROVE, [DRAFT_ISSUE]); // prepared by the Administrator
      const r = (await db.query("select status, approved_by, approved_at is not null as stamped from share_transactions where id = $1", [DRAFT_ISSUE])).rows[0];
      expect(r).toEqual({ status: "approved", approved_by: USERS.hartleyManager, stamped: true });
    });
  });

  it("changing a draft makes the changer its preparer, and nobody can set the approval details by hand", async () => {
    await as(hartley, await signedIn(USERS.hartleyManager), async (db) => {
      await db.query("update share_transactions set shares = 11, prepared_by = $2, approved_by = $2 where id = $1", [DRAFT_ISSUE, USERS.superUser]);
      const r = (await db.query("select prepared_by, approved_by, status from share_transactions where id = $1", [DRAFT_ISSUE])).rows[0];
      expect(r).toEqual({ prepared_by: USERS.hartleyManager, approved_by: null, status: "draft" });
      await refused(db, APPROVE, [DRAFT_ISSUE], /can't also approve/);
      // Approving and changing in one step is refused.
      await become(db, USERS.superUser);
      await refused(db, "update share_transactions set status = 'approved', shares = 999 where id = $1", [DRAFT_ISSUE], /as it was prepared/);
    });
  });

  it("approved transactions can't be changed or removed; drafts can be removed by a Manager", async () => {
    await as(hartley, await signedIn(USERS.hartleyManager), async (db) => {
      await refused(db, "update share_transactions set shares = 1 where id = 'ab000000-0000-4000-8000-000000000002'", [], /can't be changed/);
      expect((await db.query("delete from share_transactions where status = 'approved'")).rowCount).toBe(0);
      expect((await db.query("delete from share_transactions where id = $1", [DRAFT_ISSUE])).rowCount).toBe(1);
    });
    await as(hartley, await signedIn(USERS.hartleyAdministrator), async (db) => {
      expect((await db.query("delete from share_transactions where id = $1", [DRAFT_ISSUE])).rowCount).toBe(0);
    });
  });

  it("shares can't be issued beyond those authorised, until more are authorised", async () => {
    await as(hartley, await signedIn(USERS.hartleyAdministrator), async (db) => {
      const big = await draft(db, "issue", 851, SOUTH, null, "9"); // 150 issued of 1,000
      const more = await draft(db, "authorise", 1, null);
      await become(db, USERS.hartleyManager);
      await refused(db, APPROVE, [big], /beyond the 1000 authorised/);
      await db.query(APPROVE, [more]);
      await db.query(APPROVE, [big]);
    });
  });

  it("a holder can't transfer more than they hold, nor to themselves; the register follows", async () => {
    await as(hartley, await signedIn(USERS.hartleyAdministrator), async (db) => {
      const tooMany = await draft(db, "transfer", 101, SOUTH, NORTH, "10");
      const self = await draft(db, "transfer", 1, NORTH, NORTH, "11");
      const ok = await draft(db, "transfer", 40, SOUTH, NORTH, "12", "13");
      await become(db, USERS.hartleyManager);
      await refused(db, APPROVE, [tooMany], /holds 100 Ordinary shares/);
      await refused(db, APPROVE, [self], /two different holders/);
      await db.query(APPROVE, [ok]);
      const held = async (p: string) =>
        Number(
          (
            await db.query(
              "select coalesce(sum(case when to_person_id = $1 then shares else -shares end), 0) as n from share_transactions where status = 'approved' and kind <> 'authorise' and (to_person_id = $1 or from_person_id = $1)",
              [p],
            )
          ).rows[0].n,
        );
      expect(await held(NORTH)).toBe(60);
      expect(await held(SOUTH)).toBe(40);
    });
  });

  it("nobody who recorded or changed a draft can approve it, even after someone else touches it", async () => {
    await as(hartley, await signedIn(USERS.hartleyManager), async (db) => {
      const id = await draft(db, "authorise", 5000, null);
      await become(db, USERS.hartleyAdministrator);
      await db.query("update share_transactions set notes = notes where id = $1", [id]);
      await become(db, USERS.hartleyManager);
      await refused(db, APPROVE, [id], /can't also approve/);
      await db.query("update share_transactions set edited_by = '{}' where id = $1", [id]); // ignored: the list can't be wiped
      expect((await db.query("select edited_by from share_transactions where id = $1", [id])).rows[0].edited_by).toHaveLength(2);
      await become(db, USERS.superUser);
      await db.query(APPROVE, [id]);
    });
  });

  it("transactions are approved in date order", async () => {
    await as(hartley, await signedIn(USERS.hartleyAdministrator), async (db) => {
      const early = (
        await db.query(
          "insert into share_transactions (entity_id, class_id, kind, transaction_date, shares, from_person_id, to_person_id) values ($1, $2, 'transfer', '2019-01-01', 10, $3, $4) returning id",
          [HOLDINGS, ORDINARY, NORTH, SOUTH],
        )
      ).rows[0].id;
      await become(db, USERS.hartleyManager);
      await refused(db, APPROVE, [early], /date order/);
    });
  });

  it("a certificate number is used once per class", async () => {
    await as(hartley, await signedIn(USERS.hartleyAdministrator), async (db) => {
      const dup = await draft(db, "issue", 1, SOUTH, null, "1");
      await become(db, USERS.hartleyManager);
      await refused(db, APPROVE, [dup], /certificate number/);
    });
  });

  it("Viewers can't record transactions", async () => {
    await expect(
      as(hartley, await signedIn(USERS.hartleyViewerWholeFamily, "aal1"), (db) =>
        db.query("insert into share_transactions (entity_id, class_id, kind, transaction_date, shares) values ($1, $2, 'authorise', current_date, 5)", [HOLDINGS, ORDINARY]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("Ownership: keeping records sound", () => {
  it("share classes are for companies and LLCs; settlements and beneficiaries for trusts and foundations", async () => {
    await as(hartley, await signedIn(USERS.hartleyManager), async (db) => {
      await db.query("savepoint a");
      await expect(db.query("insert into share_classes (entity_id, name, currency) values ($1, 'A', 'ZAR')", [NORTH_TRUST])).rejects.toThrow(/for a trust/);
      await db.query("rollback to savepoint a");
      await expect(db.query("insert into beneficiaries (entity_id, person_id) values ($1, $2)", [HOLDINGS, NORTH])).rejects.toThrow(/for a company/);
    });
  });

  it("a class with approved shares keeps its currency and par value, and can't be removed on its own", async () => {
    await as(hartley, await signedIn(USERS.hartleyManager), async (db) => {
      await db.query("savepoint a");
      await expect(db.query("update share_classes set par_value = 2 where id = $1", [ORDINARY])).rejects.toThrow(/can't change/);
      await db.query("rollback to savepoint a");
      await expect(db.query("delete from share_classes where id = $1", [ORDINARY])).rejects.toThrow(/can't be removed/);
    });
    await as(hartley, await signedIn(USERS.hartleyAdministrator), async (db) => {
      await expect(db.query("update share_classes set limited = false where id = $1", [ORDINARY])).rejects.toThrow(/can't change/);
    });
    // Removing the whole entity takes its share records with it.
    await as(hartley, await signedIn(USERS.hartleyManager), async (db) => {
      expect((await db.query("delete from entities where id = $1", [HOLDINGS])).rowCount).toBe(1);
      expect(await count(db, "select * from share_transactions")).toBe(0);
    });
  });

  it("an entity that holds shares in another can't be removed while it does", async () => {
    await as(hartley, await signedIn(USERS.hartleyManager), async (db) => {
      await db.query("insert into share_transactions (entity_id, class_id, kind, transaction_date, shares, to_entity_id) values ($1, $2, 'issue', current_date, 5, $3)", [
        HOLDINGS,
        ORDINARY,
        NORTH_TRUST,
      ]);
      await expect(db.query("delete from entities where id = $1", [NORTH_TRUST])).rejects.toThrow(/foreign key/);
    });
  });

  it("an entity's kind can't change once recorded", async () => {
    await as(hartley, await signedIn(USERS.hartleyManager), async (db) => {
      await expect(db.query("update entities set entity_type = 'trust' where id = $1", [HOLDINGS])).rejects.toThrow(/kind of entity/);
    });
  });

  it("a Viewer sees the whole share ledger of an entity they may see, with hidden holders unnamed", async () => {
    await as(hartley, await signedIn(USERS.hartleyManager), async (db) => {
      await db.query("update entities set branch_id = $2 where id = $1", [HOLDINGS, "a1000000-0000-4000-8000-000000000001"]);
      await db.query("insert into share_transactions (entity_id, class_id, kind, transaction_date, shares, to_person_id) values ($1, $2, 'issue', current_date, 5, $3)", [HOLDINGS, ORDINARY, SOUTH]);
      const s = await signedIn(USERS.hartleyViewerBranch, "aal1");
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ ...(s.kind === "user" ? s.claims : {}), sub: USERS.hartleyViewerBranch, role: "authenticated", aal: "aal1" })]);
      expect(await count(db, "select * from share_transactions")).toBe(5);
      expect(await count(db, `select * from people where id = '${SOUTH}'`)).toBe(0);
    });
  });

  it("the first share class sets the base currency of a company that has none", async () => {
    await as(hartley, await signedIn(USERS.hartleyAdministrator), async (db) => {
      const id = (await db.query("insert into entities (name, entity_type, jurisdiction, sub_type) values ('New Co', 'company', 'British Virgin Islands', 'BVI Business Company') returning id")).rows[0].id;
      await db.query("insert into share_classes (entity_id, name, currency, limited) values ($1, 'Ordinary', 'USD', false)", [id]);
      expect((await db.query("select base_currency from entities where id = $1", [id])).rows[0].base_currency).toBe("USD");
    });
  });

  it("a beneficiary is one person, organisation, entity or cause; a class member is in a class once at a time", async () => {
    await as(hartley, await signedIn(USERS.hartleyManager), async (db) => {
      await db.query("savepoint a");
      await expect(db.query("insert into beneficiaries (entity_id, person_id, cause) values ($1, $2, 'Education')", [NORTH_TRUST, NORTH])).rejects.toThrow(/check constraint/);
      await db.query("rollback to savepoint a");
      await expect(
        db.query("insert into beneficiary_class_members (entity_id, class_id, person_id) values ($1, $2, $3)", [NORTH_TRUST, DESCENDANTS, NORTH]),
      ).rejects.toThrow(/duplicate key/);
    });
    await as(hartley, await signedIn(USERS.hartleyManager), async (db) => {
      await db.query("insert into beneficiaries (entity_id, cause) values ($1, 'Education')", [NORTH_TRUST]);
      await expect(db.query("insert into beneficiaries (entity_id, cause) values ($1, ' education')", [NORTH_TRUST])).rejects.toThrow(/duplicate key/);
    });
  });

  it("a beneficiary or class member can't be removed from the Tree while they are one", async () => {
    await as(hartley, await signedIn(USERS.hartleyManager), async (db) => {
      await expect(db.query("delete from people where id = $1", [SOUTH])).rejects.toThrow(/foreign key/);
    });
  });

  it("changes are recorded in the history", async () => {
    await as(hartley, await signedIn(USERS.hartleyManager), async (db) => {
      await db.query("insert into beneficiaries (entity_id, cause) values ($1, 'Education in the Karoo')", [NORTH_TRUST]);
      expect(await count(db, "select * from audit_log where table_name = 'beneficiaries' and action = 'insert' and detail->>'cause' is not null")).toBe(1);
    });
  });
});
