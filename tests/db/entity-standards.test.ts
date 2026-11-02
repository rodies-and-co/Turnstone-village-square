import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DB, USERS, as, connect, count, hubClaims, type Session } from "./db";

let hub: Client;

beforeAll(async () => {
  hub = await connect(DB.hub);
});

afterAll(async () => {
  await hub.end();
});

async function user(id: string, aal: "aal1" | "aal2" = "aal2"): Promise<Session> {
  return { kind: "user", id, aal, claims: await hubClaims(hub, id) };
}

const draft = (db: Client, status = "draft") =>
  db.query(
    "insert into entity_standards (jurisdiction, entity_type, sub_type, name, status) values ('Jersey', 'company', 'Private company', 'Jersey – Private company', $1) returning id, reviewed_by, created_by",
    [status],
  );

describe("Entity Standards: the starting set", () => {
  it("has the five jurisdictions, with the Isle of Man ones as drafts and the rest approved", async () => {
    await as(hub, await user(USERS.superUser), async (db) => {
      expect(await count(db, "select * from entity_standards")).toBe(24);
      const { rows } = await db.query("select jurisdiction, status, count(*)::int as n from entity_standards group by 1, 2 order by 1, 2");
      expect(rows).toEqual([
        { jurisdiction: "British Virgin Islands", status: "approved", n: 4 },
        { jurisdiction: "Isle of Man", status: "draft", n: 5 },
        { jurisdiction: "Mauritius", status: "approved", n: 5 },
        { jurisdiction: "South Africa", status: "approved", n: 6 },
        { jurisdiction: "United Kingdom", status: "approved", n: 4 },
      ]);
    });
  });

  it("carries the corrected BO rules", async () => {
    await as(hub, await user(USERS.superUser), async (db) => {
      const bo = async (j: string, sub: string) =>
        (await db.query("select bo_threshold_percent::float as t, bo_rule from entity_standards where jurisdiction = $1 and sub_type = $2", [j, sub])).rows[0];
      expect(await bo("South Africa", "Private company (Pty) Ltd")).toEqual({ t: 5, bo_rule: "at_least" });
      expect(await bo("British Virgin Islands", "BVI Business Company")).toEqual({ t: 10, bo_rule: "at_least" });
      expect(await bo("Mauritius", "Domestic private company")).toEqual({ t: 20, bo_rule: "at_least" });
      expect(await bo("United Kingdom", "Private company limited by shares")).toEqual({ t: 25, bo_rule: "more_than" });
      expect(await bo("South Africa", "Inter vivos trust")).toEqual({ t: null, bo_rule: "everyone" });
    });
  });
});

describe("Entity Standards: who may do what", () => {
  it("anyone signed in can read them, even a Viewer; visitors can't", async () => {
    expect(await as(hub, await user(USERS.hartleyViewerWholeFamily, "aal1"), (db) => count(db, "select * from entity_standards"))).toBe(24);
    await expect(as(hub, { kind: "anonymous" }, (db) => db.query("select * from entity_standards"))).rejects.toThrow(/permission denied/);
  });

  it("a family Manager or Administrator can propose a draft, but not an approved standard", async () => {
    for (const id of [USERS.hartleyManager, USERS.hartleyAdministrator]) {
      const { rows } = await as(hub, await user(id), (db) => draft(db));
      expect(rows[0].created_by).toBe(id);
      expect(rows[0].reviewed_by).toBeNull();
      await expect(as(hub, await user(id), (db) => draft(db, "approved"))).rejects.toThrow(/starts as a draft|row-level security/);
    }
  });

  it("a Viewer can't propose one, and a Manager without two-factor can't either", async () => {
    await expect(as(hub, await user(USERS.hartleyViewerWholeFamily, "aal1"), (db) => draft(db))).rejects.toThrow(/row-level security/);
    await expect(as(hub, await user(USERS.hartleyManager, "aal1"), (db) => draft(db))).rejects.toThrow(/row-level security/);
  });

  it("only the Super User and System Admin change or approve; approval records who and when", async () => {
    const approve = "update entity_standards set status = 'approved' where jurisdiction = 'Isle of Man' and sub_type = 'Foundation'";
    expect(await as(hub, await user(USERS.hartleyManager), async (db) => (await db.query(approve)).rowCount)).toBe(0);
    for (const id of [USERS.systemAdmin, USERS.superUser]) {
      const row = await as(hub, await user(id), async (db) => {
        await db.query(approve);
        return (await db.query("select status, reviewed_by, reviewed_at, effective_from from entity_standards where jurisdiction = 'Isle of Man' and sub_type = 'Foundation'")).rows[0];
      });
      expect(row.status).toBe("approved");
      expect(row.reviewed_by).toBe(id);
      expect(row.reviewed_at).not.toBeNull();
      expect(row.effective_from).not.toBeNull();
    }
  });

  it("nobody can delete a standard, or set who reviewed it by hand", async () => {
    await as(hub, await user(USERS.superUser), async (db) => {
      expect((await db.query("delete from entity_standards")).rowCount).toBe(0);
      await db.query("update entity_standards set reviewed_by = $1 where jurisdiction = 'Mauritius'", [USERS.hartleyManager]);
      expect(await count(db, `select * from entity_standards where reviewed_by = '${USERS.hartleyManager}'`)).toBe(0);
    });
  });

  it("changes are recorded in the audit log", async () => {
    await as(hub, await user(USERS.hartleyManager), async (db) => {
      await draft(db);
    });
    await as(hub, await user(USERS.superUser), async (db) => {
      await db.query("update entity_standards set filings = 'Updated' where jurisdiction = 'Mauritius' and sub_type = 'Trust'");
      expect(await count(db, `select * from audit_log where table_name = 'entity_standards' and action = 'update' and user_id = '${USERS.superUser}'`)).toBe(1);
    });
  });
});

describe("Entity Standards: drafts from families and new versions", () => {
  it("a family's draft is built by the hub: copied from the closest standard, with no text or family details from the family", async () => {
    const row = await as(hub, await user(USERS.hartleyManager), async (db) => {
      const { rows } = await db.query(
        `insert into entity_standards (jurisdiction, entity_type, sub_type, name, status, version, review_note, officers_notes, min_directors, created_for_family)
         values ('Mauritius', 'company', 'Some new kind', 'Anything', 'draft', 99, 'Approved by owner', 'Family secrets', 9, (select id from families limit 1))
         returning name, version, review_note, officers_notes, min_directors, min_resident_directors, created_for_family, based_on, bo_threshold_percent::float as bo`,
      );
      return rows[0];
    });
    expect(row.name).toBe("Mauritius – Some new kind");
    expect(row.version).toBe(1);
    expect(row.review_note).toMatch(/^Created automatically/);
    expect(row.officers_notes).toBeNull();
    expect(row.created_for_family).toBeNull();
    expect(row.based_on).not.toBeNull();
    // Copied from the approved Mauritius company standard, not from what was sent.
    expect(row.min_directors).toBeLessThan(9);
    expect(row.bo).toBe(20);
  });

  it("with no standard for the jurisdiction and type, the draft has the general minimums", async () => {
    const row = await as(hub, await user(USERS.hartleyAdministrator), async (db) =>
      (await db.query("insert into entity_standards (jurisdiction, entity_type, sub_type, name, min_directors) values ('Jersey', 'company', 'Private company', 'x', 5) returning min_directors, based_on")).rows[0],
    );
    expect(row).toEqual({ min_directors: 0, based_on: null });
  });

  it("after a standard is retired, a family's new draft takes the next version", async () => {
    const manager = (await user(USERS.hartleyManager)) as { claims: object };
    await as(hub, await user(USERS.superUser), async (db) => {
      await db.query("update entity_standards set status = 'retired' where jurisdiction = 'United Kingdom' and sub_type = 'Express trust'");
      await db.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ ...manager.claims, sub: USERS.hartleyManager, role: "authenticated", aal: "aal2" }),
      ]);
      const { rows } = await db.query(
        "insert into entity_standards (jurisdiction, entity_type, sub_type, name) values ('United Kingdom', 'trust', 'Express trust', 'x') returning version, status",
      );
      expect(rows[0]).toEqual({ version: 2, status: "draft" });
    });
  });

  it("approving a new version retires the earlier one, which stays on record", async () => {
    await as(hub, await user(USERS.systemAdmin), async (db) => {
      const { rows } = await db.query(
        "insert into entity_standards (jurisdiction, entity_type, sub_type, name, status, version) values ('Mauritius', 'trust', 'Trust', 'Mauritius – Trust', 'draft', 2) returning id",
      );
      await db.query("update entity_standards set status = 'approved' where id = $1", [rows[0].id]);
      const { rows: all } = await db.query("select version, status from entity_standards where jurisdiction = 'Mauritius' and sub_type = 'Trust' order by version");
      expect(all).toEqual([
        { version: 1, status: "retired" },
        { version: 2, status: "approved" },
      ]);
    });
  });
});

describe("Entity Standards: authorised share capital", () => {
  it("is required, optional or none per standard, and a family's new draft copies it", async () => {
    await as(hub, await user(USERS.superUser), async (db) => {
      const v = async (j: string, s: string) =>
        (await db.query("select authorised_capital from entity_standards where jurisdiction = $1 and sub_type = $2", [j, s])).rows[0].authorised_capital;
      expect(await v("Isle of Man", "2006 Act company")).toBe("optional");
      expect(await v("Isle of Man", "1931 Act company")).toBe("required");
      expect(await v("South Africa", "Private company (Pty) Ltd")).toBe("required");
      expect(await v("South Africa", "Non-profit company NPC")).toBe("none");
      expect(await v("Isle of Man", "Trust")).toBe("none");
    });
    await as(hub, await user(USERS.hartleyManager), async (db) => {
      await db.query("insert into entity_standards (jurisdiction, entity_type, sub_type, name, status) values ('United Kingdom', 'company', 'Community interest company CIC', 'x', 'draft')");
      expect((await db.query("select authorised_capital from entity_standards where sub_type = 'Community interest company CIC'")).rows[0].authorised_capital).toBe("optional");
    });
  });
});

describe("Entity Standards: the filings calendar (obligations)", () => {
  const UK = "select id from entity_standards where jurisdiction = 'United Kingdom' and sub_type = 'Private company limited by shares' and status = 'approved'";

  it("the starting standards have their obligations, readable by anyone signed in", async () => {
    await as(hub, await user(USERS.hartleyViewerWholeFamily, "aal1"), async (db) => {
      const { rows } = await db.query(`select key from standard_obligations where standard_id = (${UK}) order by key`);
      expect(rows.map((r) => r.key)).toContain("confirmation_statement");
      expect(rows.length).toBe(7);
    });
  });

  it("only the Super User or System Admin change them, and only on a draft", async () => {
    // A family's Manager can't, even on a draft.
    await as(hub, await user(USERS.hartleyManager), async (db) => {
      const d = (await db.query("insert into entity_standards (jurisdiction, entity_type, sub_type, name, status) values ('Jersey', 'company', 'Test Co', 'x', 'draft') returning id")).rows[0].id;
      await expect(db.query("insert into standard_obligations (standard_id, key, name, kind, basis) values ($1, 'x_test', 'X', 'recurring', 'year_end')", [d])).rejects.toThrow(
        /row-level security/,
      );
    });
    await as(hub, await user(USERS.hartleyManager), async (db) => {
      await expect(
        db.query(`insert into standard_obligations (standard_id, key, name, kind, basis) values ((${UK}), 'x_test', 'X', 'recurring', 'year_end')`),
      ).rejects.toThrow(/row-level security|only be changed on a draft/);
    });
    await as(hub, await user(USERS.superUser), async (db) => {
      await db.query("savepoint a");
      await expect(db.query(`update standard_obligations set offset_months = 1 where standard_id = (${UK})`)).rejects.toThrow(/only be changed on a draft/);
      await db.query("rollback to savepoint a");
      // A new version starts with a copy, and can be changed.
      const { rows } = await db.query(
        `insert into entity_standards (jurisdiction, entity_type, sub_type, name, status, version, based_on)
         select jurisdiction, entity_type, sub_type, name, 'draft', version + 1, id from entity_standards where id = (${UK}) returning id`,
      );
      expect(await count(db, `select * from standard_obligations where standard_id = '${rows[0].id}'`)).toBe(7);
      await db.query("update standard_obligations set offset_months = 10 where standard_id = $1 and key = 'accounts'", [rows[0].id]);
      expect((await db.query("delete from standard_obligations where standard_id = $1 and key = 'agm'", [rows[0].id])).rowCount).toBe(0); // there is none
      expect((await db.query("delete from standard_obligations where standard_id = $1 and key = 'accounts'", [rows[0].id])).rowCount).toBe(1);
    });
  });

  it("a family's new draft starts with the closest standard's obligations, marked to confirm", async () => {
    await as(hub, await user(USERS.hartleyManager), async (db) => {
      await db.query("insert into entity_standards (jurisdiction, entity_type, sub_type, name, status) values ('United Kingdom', 'company', 'Community interest company CIC', 'x', 'draft')");
      const { rows } = await db.query(
        "select bool_and(to_confirm) as all_tc, count(*)::int as n from standard_obligations where standard_id = (select id from entity_standards where sub_type = 'Community interest company CIC')",
      );
      expect(rows[0].n).toBeGreaterThan(0);
      expect(rows[0].all_tc).toBe(true);
    });
  });
});
