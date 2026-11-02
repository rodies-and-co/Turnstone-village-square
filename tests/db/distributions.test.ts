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

// Hartley test data: Test Holdings Ltd (directors North and South; North
// holds 100 Ordinary £1 shares, the trust company 50). The North Family Trust
// (trustee: the trust company; beneficiary: South; class "Descendants" with North).
const HOLDINGS = "a9000000-0000-4000-8000-000000000001";
const NORTH_TRUST = "a9000000-0000-4000-8000-000000000002";
const ORDINARY = "aa000000-0000-4000-8000-000000000001";
const NORTH = "a2000000-0000-4000-8000-000000000001";
const SOUTH = "a2000000-0000-4000-8000-000000000002";
const ORG = "a8000000-0000-4000-8000-000000000001";
const ADMIN = USERS.hartleyAdministrator;
const MANAGER = USERS.hartleyManager;

async function refused(
  db: Client,
  sql: string,
  params: unknown[],
  message: RegExp,
) {
  await db.query("savepoint step");
  await expect(db.query(sql, params)).rejects.toThrow(message);
  await db.query("rollback to savepoint step");
}
const one = async (db: Client, sql: string, params: unknown[] = []) =>
  (await db.query(sql, params)).rows[0];

// A draft written resolution of an entity's board, with one item of this kind.
async function drafted(db: Client, entity: string, action: string) {
  await switchUser(db, hub, ADMIN);
  const w = (
    await one(
      db,
      "insert into written_resolutions (body, entity_id, title) values ('board', $1, 'R') returning id",
      [entity],
    )
  ).id as string;
  const d = (
    await one(
      db,
      "insert into decisions (resolution_id, item, title, wording, action) values ($1, 1, 't', 'w', $2) returning id",
      [w, action],
    )
  ).id as string;
  return { w, d };
}
async function pass(db: Client, w: string, signers: [string, string][]) {
  await switchUser(db, hub, ADMIN);
  for (const [col, id] of signers)
    await db.query(
      `insert into resolution_signatories (resolution_id, ${col}) values ($1, $2)`,
      [w, id],
    );
  await db.query(
    "update written_resolutions set status = 'circulated', circulated_on = current_date - 2 where id = $1",
    [w],
  );
  await db.query(
    "update resolution_signatories set signed_on = current_date - 1 where resolution_id = $1",
    [w],
  );
  await switchUser(db, hub, MANAGER);
  await db.query(
    "update written_resolutions set status = 'passed' where id = $1",
    [w],
  );
}

describe("Distributions", () => {
  it("are drafted, declared when the trustees' resolution passes, then recorded as paid", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      const b = (
        await one(
          db,
          "select id from beneficiaries where entity_id = $1 and person_id = $2",
          [NORTH_TRUST, SOUTH],
        )
      ).id;
      const { w, d } = await drafted(db, NORTH_TRUST, "distribution");
      const dist = (
        await one(
          db,
          "insert into distributions (entity_id, beneficiary_id, pool, currency, amount, decision_id, letter_of_wishes) values ($1, $2, 'income', 'ZAR', 1000, $3, true) returning id",
          [NORTH_TRUST, b, d],
        )
      ).id;
      await refused(
        db,
        "update distributions set amount = 2000 where id = $1",
        [dist],
        /fixed as drafted/,
      );
      await refused(
        db,
        "update distributions set status = 'cancelled' where id = $1",
        [dist],
        /once its decision is withdrawn/,
      );
      await pass(db, w, [["organisation_id", ORG]]);
      expect(
        await one(
          db,
          "select status, declared_on = current_date - 1 as ok from distributions where id = $1",
          [dist],
        ),
      ).toEqual({ status: "declared", ok: true });
      await switchUser(db, hub, ADMIN);
      await refused(
        db,
        "update distributions set pool = 'capital' where id = $1",
        [dist],
        /Only its payment/,
      );
      await db.query(
        "update distributions set status = 'paid', paid_on = current_date, receipt_reference = 'Receipt 1' where id = $1",
        [dist],
      );
      await refused(
        db,
        "update distributions set receipt_reference = 'x' where id = $1",
        [dist],
        /paid or cancelled/,
      );
      await refused(
        db,
        "select public.request_removal('distributions', $1)",
        [dist],
        /kept as a record/,
      );
    });
  });

  it("go only to a current beneficiary or class member of a trust or foundation, with a drafted decision", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      const member = (
        await one(
          db,
          "select id from beneficiary_class_members where entity_id = $1 and person_id = $2",
          [NORTH_TRUST, NORTH],
        )
      ).id;
      const b = (
        await one(db, "select id from beneficiaries where entity_id = $1", [
          NORTH_TRUST,
        ])
      ).id;
      const { d } = await drafted(db, NORTH_TRUST, "distribution");
      const { d: other } = await drafted(db, NORTH_TRUST, "share_transaction");
      const { d: co } = await drafted(db, HOLDINGS, "distribution");
      const ins =
        "insert into distributions (entity_id, beneficiary_id, class_member_id, pool, currency, amount, decision_id) values ($1, $2, $3, 'capital', 'ZAR', 10, $4)";
      await refused(
        db,
        ins,
        [HOLDINGS, null, member, co],
        /only a trust or foundation/,
      );
      await refused(
        db,
        ins,
        [NORTH_TRUST, null, member, other],
        /drafted for it/,
      );
      await refused(
        db,
        ins,
        [NORTH_TRUST, null, member, null],
        /drafted for it/,
      );
      await db.query(
        "update beneficiaries set ceased_on = current_date where id = $1",
        [b],
      );
      await refused(db, ins, [NORTH_TRUST, b, null, d], /current beneficiary/);
      await db.query(ins, [NORTH_TRUST, null, member, d]);
      await refused(
        db,
        ins,
        [NORTH_TRUST, null, member, d],
        /duplicate key|one_per_decision/,
      );
    });
  });

  it("a withdrawn decision lets the proposal be cancelled; a Viewer sees only distributions to people they can see", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      const member = (
        await one(
          db,
          "select id from beneficiary_class_members where entity_id = $1 and person_id = $2",
          [NORTH_TRUST, NORTH],
        )
      ).id;
      const b = (
        await one(
          db,
          "select id from beneficiaries where entity_id = $1 and person_id = $2",
          [NORTH_TRUST, SOUTH],
        )
      ).id;
      const { d } = await drafted(db, NORTH_TRUST, "distribution");
      const { d: d2 } = await drafted(db, NORTH_TRUST, "distribution");
      const x = (
        await one(
          db,
          "insert into distributions (entity_id, class_member_id, pool, currency, amount, decision_id) values ($1, $2, 'income', 'ZAR', 5, $3) returning id",
          [NORTH_TRUST, member, d],
        )
      ).id;
      await db.query(
        "insert into distributions (entity_id, beneficiary_id, pool, currency, amount, decision_id) values ($1, $2, 'income', 'ZAR', 5, $3)",
        [NORTH_TRUST, b, d2],
      );
      await db.query(
        "update decisions set outcome = 'withdrawn' where id = $1",
        [d],
      );
      await db.query(
        "update distributions set status = 'cancelled' where id = $1",
        [x],
      );
      await switchUser(db, hub, USERS.hartleyViewerBranch, "aal1");
      expect(await count(db, "select * from distributions")).toBe(1); // North's, not South's
    });
  });
});

describe("Dividends", () => {
  it("declared when the directors' resolution passes: a line for each holder on the record date, then paid", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      const { w, d } = await drafted(db, HOLDINGS, "dividend");
      await refused(
        db,
        "insert into dividends (entity_id, class_id, per_share, currency, decision_id) values ($1, $2, 0.5, 'USD', $3)",
        [HOLDINGS, ORDINARY, d],
        /class's currency/,
      );
      const dv = (
        await one(
          db,
          "insert into dividends (entity_id, class_id, kind, per_share, currency, decision_id) values ($1, $2, 'final', 0.333333, 'GBP', $3) returning id",
          [HOLDINGS, ORDINARY, d],
        )
      ).id;
      await refused(
        db,
        "update dividends set per_share = 1 where id = $1",
        [dv],
        /fixed as drafted/,
      );
      await pass(db, w, [
        ["person_id", NORTH],
        ["person_id", SOUTH],
      ]);
      expect(
        await one(
          db,
          "select status, record_date = current_date - 1 as on_pass from dividends where id = $1",
          [dv],
        ),
      ).toEqual({ status: "declared", on_pass: true });
      const lines = (
        await db.query(
          "select coalesce(person_id, organisation_id) as who, shares::int, amount::text from dividend_payments where dividend_id = $1 order by shares desc",
          [dv],
        )
      ).rows;
      expect(lines).toEqual([
        { who: NORTH, shares: 100, amount: "33.33" },
        { who: ORG, shares: 50, amount: "16.67" },
      ]);
      await switchUser(db, hub, ADMIN);
      await refused(
        db,
        "update dividend_payments set amount = 1 where dividend_id = $1",
        [dv],
        /only the date paid/,
      );
      await refused(
        db,
        "insert into dividend_payments (dividend_id, person_id, shares, amount) values ($1, $2, 1, 1)",
        [dv, SOUTH],
        /worked out when/,
      );
      await db.query(
        "update dividend_payments set paid_on = current_date, voucher = 'V1' where dividend_id = $1 and person_id = $2",
        [dv, NORTH],
      );
      expect(
        (await one(db, "select status from dividends where id = $1", [dv]))
          .status,
      ).toBe("declared");
      await db.query(
        "update dividend_payments set paid_on = current_date, voucher = 'V2' where dividend_id = $1 and organisation_id = $2",
        [dv, ORG],
      );
      expect(
        (await one(db, "select status from dividends where id = $1", [dv]))
          .status,
      ).toBe("paid");
    });
  });

  it("a proposed dividend can be removed by two people; a declared one is kept", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      const { d } = await drafted(db, HOLDINGS, "dividend");
      const dv = (
        await one(
          db,
          "insert into dividends (entity_id, class_id, per_share, currency, decision_id) values ($1, $2, 1, 'GBP', $3) returning id",
          [HOLDINGS, ORDINARY, d],
        )
      ).id;
      expect(await removeWithApproval(db, hub, "dividends", dv)).toBe(
        "approved",
      );
    });
  });
});
