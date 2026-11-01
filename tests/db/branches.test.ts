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

const addWealthCreator = (db: Client) =>
  db.query("insert into wealth_creators (person_id) values ($1)", [HARTLEY_DB.southPerson]);
const addBranch = (db: Client) => db.query("insert into branches (name, head_person_id) values ('Clara Hartley Branch', $1)", [HARTLEY_DB.ownPerson]);
const answerNo = (db: Client) =>
  db.query("insert into branch_answers (person_id, question) values ($1, 'starts_branch')", [HARTLEY_DB.ownPerson]);

describe("the Branches: who decides", () => {
  it("a Manager confirms wealth creators, creates branches and records answers", async () => {
    await as(hartley, await signedIn(USERS.hartleyManager), async (db) => {
      await addWealthCreator(db);
      await addBranch(db);
      await answerNo(db);
      await db.query("update branches set name = 'Renamed Branch' where id = $1", [HARTLEY_DB.northBranch]);
      expect(await count(db, "select * from wealth_creators")).toBe(2);
      expect(await count(db, "select * from branch_answers")).toBe(1);
      expect(await count(db, `select * from audit_log where table_name in ('wealth_creators', 'branch_answers') and user_id = '${USERS.hartleyManager}'`)).toBe(2);
    });
  });

  it("an Administrator sees the questions but cannot answer them, create or rename branches", async () => {
    const admin = await signedIn(USERS.hartleyAdministrator);
    await expect(as(hartley, admin, addWealthCreator)).rejects.toThrow(/row-level security/);
    await expect(as(hartley, admin, addBranch)).rejects.toThrow(/row-level security/);
    await expect(as(hartley, admin, answerNo)).rejects.toThrow(/row-level security/);
    await as(hartley, admin, async (db) => {
      expect((await db.query("update branches set name = 'X' where id = $1", [HARTLEY_DB.northBranch])).rowCount).toBe(0);
      expect((await db.query("delete from wealth_creators")).rowCount).toBe(0);
      expect(await count(db, "select * from wealth_creators")).toBe(1);
      expect(await count(db, "select * from branch_answers")).toBe(0);
    });
  });

  it("Viewers can't change anything, and only see wealth creators they may see", async () => {
    const whole = await signedIn(USERS.hartleyViewerWholeFamily, "aal1");
    await expect(as(hartley, whole, addWealthCreator)).rejects.toThrow(/row-level security/);
    await as(hartley, whole, async (db) => {
      expect(await count(db, "select * from wealth_creators")).toBe(1);
      expect(await count(db, "select * from branch_answers")).toBe(0);
    });
    // The branch Viewer sees the North branch, where Arthur is.
    expect(await as(hartley, await signedIn(USERS.hartleyViewerBranch, "aal1"), (db) => count(db, "select * from wealth_creators"))).toBe(1);
    // The own-record Viewer can't see Arthur, so not that he is a wealth creator either.
    expect(await as(hartley, await signedIn(USERS.hartleyViewerOwnRecord, "aal1"), (db) => count(db, "select * from wealth_creators"))).toBe(0);
  });

  it("another family's Manager sees and changes nothing", async () => {
    const other = await signedIn(USERS.okaforManager);
    await as(hartley, other, async (db) => {
      expect(await count(db, "select * from wealth_creators")).toBe(0);
    });
    await expect(as(hartley, other, addWealthCreator)).rejects.toThrow(/row-level security/);
  });
});

describe("the Branches: keeping answers sound", () => {
  it("each question is answered once, and a 'join' answer names its branch", async () => {
    await asOwner(hartley, async (db) => {
      await answerNo(db);
      await expect(answerNo(db)).rejects.toThrow(/duplicate key/);
    });
    await asOwner(hartley, async (db) => {
      await expect(
        db.query("insert into branch_answers (person_id, question) values ($1, 'joins_branch')", [HARTLEY_DB.ownPerson]),
      ).rejects.toThrow(/check constraint/);
    });
  });

  it("removing a person removes their wealth-creator mark and answers", async () => {
    await asOwner(hartley, async (db) => {
      await answerNo(db);
      await clearOwnership(db); // a shareholder or settlor can't be removed from the Tree
      await db.query("delete from people where id = $1", [HARTLEY_DB.northPerson]);
      await db.query("delete from people where id = $1", [HARTLEY_DB.ownPerson]);
      expect(await count(db, "select * from wealth_creators")).toBe(0);
      expect(await count(db, "select * from branch_answers")).toBe(0);
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
