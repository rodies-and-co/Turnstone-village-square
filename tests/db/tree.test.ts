import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DB, HARTLEY_DB, USERS, as, asOwner, connect, count, hubClaims, type Session } from "./db";

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

const PERSONAL = ["person_details", "passports", "tax_numbers", "phone_numbers", "person_addresses", "addresses"];

async function visible(db: Client) {
  const out: Record<string, number> = {};
  for (const t of [...PERSONAL, "parent_child", "partnerships", "people"]) {
    out[t] = await count(db, `select * from ${t}`);
  }
  return out;
}

describe("the Tree: who sees personal details", () => {
  it("Managers and Administrators see everything", async () => {
    for (const id of [USERS.hartleyManager, USERS.hartleyAdministrator]) {
      const v = await as(hartley, await signedIn(id), visible);
      expect(v).toEqual({
        person_details: 2,
        passports: 2,
        tax_numbers: 1,
        phone_numbers: 1,
        person_addresses: 2,
        addresses: 2,
        parent_child: 2,
        partnerships: 1,
        people: 3,
      });
    }
  });

  it("a whole-family Viewer sees people and family links, but no personal details", async () => {
    const v = await as(hartley, await signedIn(USERS.hartleyViewerWholeFamily, "aal1"), visible);
    for (const t of PERSONAL) expect(v[t], t).toBe(0);
    expect(v.people).toBe(3);
    expect(v.parent_child).toBe(2);
    expect(v.partnerships).toBe(1);
  });

  it("an own-record Viewer sees only their own personal details", async () => {
    const s = await signedIn(USERS.hartleyViewerOwnRecord, "aal1");
    await as(hartley, s, async (db) => {
      const passports = (await db.query("select number from passports")).rows.map((r) => r.number);
      expect(passports).toEqual(["TEST1003"]);
      expect(await count(db, "select * from person_details")).toBe(1);
      expect(await count(db, "select * from phone_numbers")).toBe(1);
      expect(await count(db, "select * from tax_numbers")).toBe(0);
      const cities = (await db.query("select city from addresses")).rows.map((r) => r.city);
      expect(cities).toEqual(["York"]);
      // They can see themselves only, so no family links (the other person is hidden).
      expect(await count(db, "select * from parent_child")).toBe(0);
    });
  });

  it("a Viewer's own details follow their access grants", async () => {
    const s = await signedIn(USERS.hartleyViewerOwnRecord, "aal1");
    await as(hartley, s, async (db) => {
      // Take away their own-record grant (as the database owner), then look again as them.
      await db.query("reset role");
      await db.query("delete from access_grants where user_id = $1", [USERS.hartleyViewerOwnRecord]);
      await db.query("set local role authenticated");
      for (const t of PERSONAL) expect(await count(db, `select * from ${t}`), t).toBe(0);
    });
  });

  it("a branch Viewer sees people in their branch but not their personal details", async () => {
    const v = await as(hartley, await signedIn(USERS.hartleyViewerBranch, "aal1"), visible);
    expect(v.people).toBe(1);
    for (const t of PERSONAL) expect(v[t], t).toBe(0);
    expect(v.partnerships).toBe(0);
  });

  it("another family's Manager sees nothing", async () => {
    const v = await as(hartley, await signedIn(USERS.okaforManager), visible);
    for (const n of Object.values(v)) expect(n).toBe(0);
  });

  it("the System Admin sees nothing; the Super User sees everything", async () => {
    const sa = await as(hartley, await signedIn(USERS.systemAdmin), visible);
    for (const n of Object.values(sa)) expect(n).toBe(0);
    const su = await as(hartley, await signedIn(USERS.superUser), visible);
    expect(su.passports).toBe(2);
  });
});

describe("the Tree: who can change what", () => {
  const addPassport = (db: Client) =>
    db.query("insert into passports (person_id, country, number) values ($1, 'Ireland', 'TEST9')", [HARTLEY_DB.northPerson]);

  it("Administrators add and change details, but cannot remove them", async () => {
    const s = await signedIn(USERS.hartleyAdministrator);
    await as(hartley, s, async (db) => {
      await addPassport(db);
      expect((await db.query("update passports set country = 'Ireland' where number = 'TEST1001'")).rowCount).toBe(1);
      expect((await db.query("delete from passports where number = 'TEST1001'")).rowCount).toBe(0);
    });
  });

  it("Managers can remove details", async () => {
    const s = await signedIn(USERS.hartleyManager);
    await as(hartley, s, async (db) => {
      expect((await db.query("delete from passports where number = 'TEST1001'")).rowCount).toBe(1);
    });
  });

  it("Viewers cannot add or change anything, even their own details", async () => {
    const own = await signedIn(USERS.hartleyViewerOwnRecord, "aal1");
    await expect(as(hartley, own, addPassport)).rejects.toThrow(/row-level security/);
    expect((await as(hartley, own, (db) => db.query("update phone_numbers set label = 'Home'"))).rowCount).toBe(0);
    const whole = await signedIn(USERS.hartleyViewerWholeFamily, "aal1");
    await expect(
      as(hartley, whole, (db) =>
        // A link that would otherwise make sense, so only the access rules refuse it.
        db.query("insert into parent_child (parent_id, child_id, kind) values ($1, $2, 'step')", [HARTLEY_DB.northPerson, HARTLEY_DB.ownPerson]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("the Tree: keeping the records sound", () => {
  it("a person cannot become their own ancestor", async () => {
    const s = await signedIn(USERS.hartleyManager);
    await expect(
      as(hartley, s, (db) =>
        db.query("insert into parent_child (parent_id, child_id) values ($1, $2)", [HARTLEY_DB.ownPerson, HARTLEY_DB.northPerson]),
      ),
    ).rejects.toThrow(/own ancestor/);
  });

  it("a person has at most two birth parents (other kinds of parent are allowed)", async () => {
    await asOwner(hartley, async (db) => {
      const { rows } = await db.query(
        "insert into people (member_type, full_names, surname) values ('non_family', 'Step', 'Parent') returning id",
      );
      await expect(
        db.query("insert into parent_child (parent_id, child_id) values ($1, $2)", [rows[0].id, HARTLEY_DB.ownPerson]),
      ).rejects.toThrow(/two birth parents/);
    });
    await asOwner(hartley, async (db) => {
      const { rows } = await db.query(
        "insert into people (member_type, full_names, surname) values ('non_family', 'Step', 'Parent') returning id",
      );
      await db.query("insert into parent_child (parent_id, child_id, kind) values ($1, $2, 'step')", [rows[0].id, HARTLEY_DB.ownPerson]);
    });
  });

  it("the same address cannot be stored twice, however it is typed", async () => {
    await asOwner(hartley, async (db) => {
      await expect(
        db.query("insert into addresses (line1, city, postal_code, country) values ('1 test lane', 'LEEDS', 'ls1 1aa', 'united kingdom')"),
      ).rejects.toThrow(/duplicate key/);
    });
  });

  it("a partnership is stored the same way whichever order it is entered", async () => {
    await asOwner(hartley, async (db) => {
      const { rows } = await db.query(
        "insert into partnerships (person_a, person_b, kind) values ($1, $2, 'partner') returning person_a, person_b",
        [HARTLEY_DB.southPerson, HARTLEY_DB.northPerson],
      );
      expect(rows[0].person_a < rows[0].person_b).toBe(true);
    });
  });

  it("the birth year follows the date of birth", async () => {
    await asOwner(hartley, async (db) => {
      await db.query("update person_details set date_of_birth = '1949-01-01' where person_id = $1", [HARTLEY_DB.northPerson]);
      const { rows } = await db.query("select birth_year from people where id = $1", [HARTLEY_DB.northPerson]);
      expect(rows[0].birth_year).toBe(1949);
    });
  });

  it("the birth year cannot be changed away from a recorded date of birth", async () => {
    await asOwner(hartley, async (db) => {
      await db.query("update people set birth_year = 1990 where id = $1", [HARTLEY_DB.northPerson]);
      const { rows } = await db.query("select birth_year from people where id = $1", [HARTLEY_DB.northPerson]);
      expect(rows[0].birth_year).toBe(1948);
    });
  });

  it("the same partnership cannot be stored twice, whichever order it is entered", async () => {
    await asOwner(hartley, async (db) => {
      await expect(
        db.query(
          "insert into partnerships (person_a, person_b, kind, start_date) values ($1, $2, 'marriage', '1972-06-01')",
          [HARTLEY_DB.southPerson, HARTLEY_DB.northPerson],
        ),
      ).rejects.toThrow(/duplicate key/);
    });
  });

  it("refuses a date of death before the date of birth, and a badly formed phone number", async () => {
    await asOwner(hartley, async (db) => {
      await expect(
        db.query("update person_details set date_of_death = '1900-01-01' where person_id = $1", [HARTLEY_DB.northPerson]),
      ).rejects.toThrow(/check constraint/);
    });
    await asOwner(hartley, async (db) => {
      await expect(
        db.query("insert into phone_numbers (person_id, number) values ($1, 'call me')", [HARTLEY_DB.northPerson]),
      ).rejects.toThrow(/check constraint/);
    });
  });

  it("logs changes to personal details", async () => {
    await asOwner(hartley, async (db) => {
      await db.query("update passports set country = 'Ireland' where number = 'TEST1001'");
      expect(await count(db, "select * from audit_log where table_name = 'passports' and action = 'update'")).toBe(1);
    });
  });
});

describe("the Tree: sense checks on family links", () => {
  it("a birth parent must be born before their child; a step-parent may be younger", async () => {
    await asOwner(hartley, async (db) => {
      const { rows } = await db.query(
        "insert into people (member_type, full_names, surname, birth_year) values ('family', 'Young', 'Hartley', 1990) returning id",
      );
      await expect(
        db.query("insert into parent_child (parent_id, child_id, kind) values ($1, $2, 'birth')", [rows[0].id, HARTLEY_DB.ownPerson]),
      ).rejects.toThrow(/Family link: A parent must be born before their child/);
    });
    await asOwner(hartley, async (db) => {
      const { rows } = await db.query(
        "insert into people (member_type, full_names, surname, birth_year) values ('family', 'Young', 'Hartley', 1990) returning id",
      );
      await db.query("insert into parent_child (parent_id, child_id, kind) values ($1, $2, 'step')", [rows[0].id, HARTLEY_DB.ownPerson]);
    });
  });

  it("a year or date of birth can't be changed to put a parent after their child", async () => {
    await asOwner(hartley, async (db) => {
      // North (1948) is the birth parent of the own-record person (1980).
      await expect(db.query("update people set birth_year = 1985 where id = $1", [HARTLEY_DB.southPerson])).rejects.toThrow(
        /Family link: 1985 would make this person born after/,
      );
    });
    const admin = await signedIn(USERS.hartleyAdministrator);
    await as(hartley, admin, async (db) => {
      await expect(
        db.query("update person_details set date_of_birth = '2021-01-01' where person_id = $1", [HARTLEY_DB.northPerson]),
      ).rejects.toThrow(/Family link:/);
    });
    await as(hartley, admin, async (db) => {
      await expect(
        db.query("update person_details set date_of_birth = '1979-01-01' where person_id = $1", [HARTLEY_DB.ownPerson]),
      ).resolves.toBeTruthy();
    });
    await as(hartley, admin, async (db) => {
      await expect(
        db.query("update person_details set date_of_birth = '1940-01-01' where person_id = $1", [HARTLEY_DB.ownPerson]),
      ).rejects.toThrow(/born before \(or in the same year as\) their own birth parent/);
    });
  });

  it("spouses or partners can't also be parent and child, either way round", async () => {
    await asOwner(hartley, async (db) => {
      // North and South are married in the test data.
      await expect(
        db.query("insert into parent_child (parent_id, child_id, kind) values ($1, $2, 'step')", [HARTLEY_DB.northPerson, HARTLEY_DB.southPerson]),
      ).rejects.toThrow(/Family link: These two are recorded as spouses or partners/);
    });
    await asOwner(hartley, async (db) => {
      // North is the parent of the own-record person.
      await expect(
        db.query("insert into partnerships (person_a, person_b, kind) values ($1, $2, 'partner')", [HARTLEY_DB.ownPerson, HARTLEY_DB.northPerson]),
      ).rejects.toThrow(/Family link: These two are recorded as parent and child/);
    });
  });

  it("an Administrator gets the same checks", async () => {
    await as(hartley, await signedIn(USERS.hartleyAdministrator), async (db) => {
      await expect(
        db.query("insert into parent_child (parent_id, child_id, kind) values ($1, $2, 'step')", [HARTLEY_DB.northPerson, HARTLEY_DB.southPerson]),
      ).rejects.toThrow(/Family link:/);
    });
  });
});

describe("branches are named after the person who heads them", () => {
  it("records the head, and keeps the branch if the head is removed", async () => {
    await asOwner(hartley, async (db) => {
      await db.query("update branches set name = 'Arthur Hartley Branch', head_person_id = $1 where id = $2", [
        HARTLEY_DB.northPerson,
        HARTLEY_DB.northBranch,
      ]);
      await clearOwnership(db); // a shareholder or settlor can't be removed from the Tree
      await db.query("delete from people where id = $1", [HARTLEY_DB.northPerson]);
      const { rows } = await db.query("select name, head_person_id from branches where id = $1", [HARTLEY_DB.northBranch]);
      expect(rows[0]).toEqual({ name: "Arthur Hartley Branch", head_person_id: null });
    });
  });
});

// The North and South people hold shares, settled a trust or benefit from it in the test data; those
// records are cleared first, as the database won't remove someone who still
// appears in a share register, or as a settlor or beneficiary.
async function clearOwnership(db: import("pg").Client) {
  await db.query("delete from share_transactions");
  await db.query("delete from settlements");
  await db.query("delete from beneficiaries");
  await db.query("delete from beneficiary_class_members");
}
