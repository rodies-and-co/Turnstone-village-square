import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DB,
  USERS,
  as,
  connect,
  count,
  hubClaims,
  removeWithApproval,
  switchUser,
  type Session,
} from "./db";

let hub: Client;
let hartley: Client;

beforeAll(async () => {
  hub = await connect(DB.hub);
  hartley = await connect(DB.familyA);
});

afterAll(async () => {
  await Promise.all([hub.end(), hartley.end()]);
});

async function signedIn(
  id: string,
  aal: "aal1" | "aal2" = "aal2",
): Promise<Session> {
  return { kind: "user", id, aal, claims: await hubClaims(hub, id) };
}

const HOLDINGS = "a9000000-0000-4000-8000-000000000001"; // whole family
const NORTH_TRUST = "a9000000-0000-4000-8000-000000000002"; // North branch
const RECORD =
  "insert into compliance_filings (entity_id, obligation_key, obligation_name, due_date, period_key, status, done_on) values ($1, $2, 'X', '2026-12-31', '2026-03-31', 'filed', '2026-12-01') returning id";

describe("Compliance: filing records", () => {
  it("Managers and Administrators record; Viewers can't; one record per item", async () => {
    await as(
      hartley,
      await signedIn(USERS.hartleyAdministrator),
      async (db) => {
        await db.query(RECORD, [HOLDINGS, "accounts"]);
        await db.query("savepoint a");
        await expect(db.query(RECORD, [HOLDINGS, "accounts"])).rejects.toThrow(
          /duplicate key/,
        );
        await db.query("rollback to savepoint a");
        await expect(
          db.query(
            "insert into compliance_filings (entity_id, obligation_key, obligation_name, due_date, period_key, status) values ($1, 'accounts', 'X', '2027-12-31', '2027-03-31', 'filed')",
            [HOLDINGS],
          ),
        ).rejects.toThrow(/check constraint/); // filed needs a date
      },
    );
    await expect(
      as(
        hartley,
        await signedIn(USERS.hartleyViewerWholeFamily, "aal1"),
        (db) => db.query(RECORD, [HOLDINGS, "accounts"]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("Viewers see the records of the entities they may see", async () => {
    await as(hartley, await signedIn(USERS.hartleyManager), async (db) => {
      await db.query(RECORD, [HOLDINGS, "accounts"]);
      await db.query(RECORD, [NORTH_TRUST, "trust_tax_return"]);
      await switchUser(db, hub, USERS.hartleyViewerBranch, "aal1");
      expect(
        (
          await db.query("select obligation_key from compliance_filings")
        ).rows.map((r) => r.obligation_key),
      ).toEqual(["trust_tax_return"]);
      await switchUser(db, hub, USERS.okaforManager);
      expect(await count(db, "select * from compliance_filings")).toBe(0);
    });
  });

  it("a record about an event is hidden from a Viewer who can't see that event", async () => {
    await as(hartley, await signedIn(USERS.hartleyManager), async (db) => {
      const b = (
        await db.query("select id from beneficiaries where entity_id = $1", [
          NORTH_TRUST,
        ])
      ).rows[0].id; // the South person
      await db.query(
        "insert into compliance_filings (entity_id, obligation_key, obligation_name, due_date, event_key, status, done_on) values ($1, 'bo_change', 'X', '2026-12-31', $2, 'filed', '2026-12-01')",
        [NORTH_TRUST, `beneficiary:${b}:start`],
      );
      await switchUser(db, hub, USERS.hartleyViewerBranch, "aal1");
      expect(
        await count(
          db,
          "select * from compliance_filings where event_key is not null",
        ),
      ).toBe(0);
      await switchUser(db, hub, USERS.hartleyViewerWholeFamily, "aal1");
      expect(
        await count(
          db,
          "select * from compliance_filings where event_key is not null",
        ),
      ).toBe(1);
    });
  });

  it("a record is removed only by two people", async () => {
    await as(hartley, await signedIn(USERS.hartleyManager), async (db) => {
      const id = (await db.query(RECORD, [HOLDINGS, "accounts"])).rows[0].id;
      expect((await db.query("delete from compliance_filings")).rowCount).toBe(
        0,
      );
      expect(await removeWithApproval(db, hub, "compliance_filings", id)).toBe(
        "approved",
      );
      expect(await count(db, "select * from compliance_filings")).toBe(0);
    });
  });
});
