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

// From the Hartley test data: Test Holdings Ltd has two directors (the North
// and South people) and two shareholders (North 100, the trust company 50).
// The North Family Trust's trustee is the trust company.
const HOLDINGS = "a9000000-0000-4000-8000-000000000001";
const NORTH_TRUST = "a9000000-0000-4000-8000-000000000002";
const ORDINARY = "aa000000-0000-4000-8000-000000000001";
const DRAFT_ISSUE = "ab000000-0000-4000-8000-000000000004";
const NORTH = "a2000000-0000-4000-8000-000000000001";
const SOUTH = "a2000000-0000-4000-8000-000000000002";
const OWN = "a2000000-0000-4000-8000-000000000003";
const ORG = "a8000000-0000-4000-8000-000000000001";
const COUNCIL = "a5000000-0000-4000-8000-000000000001";
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

// A board meeting of Test Holdings, held yesterday, with both directors
// present and one decision carried. Recorded by the Administrator.
async function heldBoardMeeting(
  db: Client,
  opts: { southPresent?: boolean } = {},
) {
  await switchUser(db, hub, ADMIN);
  const m = (
    await one(
      db,
      "insert into meetings (body, entity_id, title, meeting_on) values ('board', $1, 'Board meeting', current_date - 1) returning id",
      [HOLDINGS],
    )
  ).id;
  await db.query(
    "insert into meeting_attendees (meeting_id, person_id, is_chair) values ($1, $2, true)",
    [m, NORTH],
  );
  await db.query(
    "insert into meeting_attendees (meeting_id, person_id, attendance) values ($1, $2, $3)",
    [m, SOUTH, opts.southPresent === false ? "apologies" : "present"],
  );
  const d = (
    await one(
      db,
      "insert into decisions (meeting_id, item, title, wording) values ($1, 1, 'Allot shares', 'It was resolved to allot shares.') returning id",
      [m],
    )
  ).id;
  await db.query("update meetings set status = 'held' where id = $1", [m]);
  return { m, d };
}

describe("Meetings: who sees what", () => {
  it("a whole-family Viewer sees the company's and the council's meetings; a North Viewer only the council's; another family's Manager nothing", async () => {
    const counts = await as(hartley, await signedIn(ADMIN), async (db) => {
      await db.query(
        "insert into meetings (body, entity_id, title, meeting_on) values ('board', $1, 'Board', current_date)",
        [HOLDINGS],
      );
      await db.query(
        "insert into meetings (body, governance_body_id, title, meeting_on) values ('governance', $1, 'Council', current_date)",
        [COUNCIL],
      );
      await db.query(
        "insert into file_notes (entity_id, title, body) values ($1, 'Call with the bank', 'Discussed the account.')",
        [HOLDINGS],
      );
      const seen: Record<string, number[]> = {};
      for (const [u, aal] of [
        [USERS.hartleyViewerWholeFamily, "aal1"],
        [USERS.hartleyViewerBranch, "aal1"],
        [USERS.okaforManager, "aal2"],
      ] as const) {
        await switchUser(db, hub, u, aal);
        seen[u] = [
          await count(db, "select * from meetings"),
          await count(db, "select * from file_notes"),
        ];
      }
      return seen;
    });
    expect(counts[USERS.hartleyViewerWholeFamily]).toEqual([2, 1]);
    expect(counts[USERS.hartleyViewerBranch]).toEqual([1, 0]);
    expect(counts[USERS.okaforManager]).toEqual([0, 0]);
  });

  it("Viewers can't add meetings, and nobody removes one directly", async () => {
    await as(
      hartley,
      await signedIn(USERS.hartleyViewerWholeFamily, "aal1"),
      async (db) => {
        await refused(
          db,
          "insert into meetings (body, entity_id, title, meeting_on) values ('board', $1, 'x', current_date)",
          [HOLDINGS],
          /row-level security/,
        );
      },
    );
    await as(hartley, await signedIn(MANAGER), async (db) => {
      const m = (
        await one(
          db,
          "insert into meetings (body, entity_id, title, meeting_on) values ('board', $1, 'x', current_date) returning id",
          [HOLDINGS],
        )
      ).id;
      await db.query("delete from meetings where id = $1", [m]);
      expect(await count(db, "select * from meetings where id = $1", [m])).toBe(
        1,
      );
    });
  });
});

describe("Meetings: recorded by one person, confirmed by another", () => {
  it("only those entitled to vote attend as voters; outcomes only once held", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      const m = (
        await one(
          db,
          "insert into meetings (body, entity_id, title, meeting_on) values ('board', $1, 'Board', current_date) returning id",
          [HOLDINGS],
        )
      ).id;
      await refused(
        db,
        "insert into meeting_attendees (meeting_id, person_id) values ($1, $2)",
        [m, OWN],
        /entitled to vote/,
      );
      await db.query(
        "insert into meeting_attendees (meeting_id, person_id, capacity) values ($1, $2, 'in_attendance')",
        [m, OWN],
      );
      const d = (
        await one(
          db,
          "insert into decisions (meeting_id, item, title, wording) values ($1, 1, 't', 'w') returning id",
          [m],
        )
      ).id;
      await refused(
        db,
        "update decisions set outcome = 'carried' where id = $1",
        [d],
        /held/,
      );
      await refused(
        db,
        "update decisions set passed_on = current_date where id = $1",
        [d],
        /counts as passed only/,
      );
      await refused(
        db,
        "update meetings set status = 'held', meeting_on = current_date + 1 where id = $1",
        [m],
        /on or after its date/,
      );
      await refused(
        db,
        "insert into meetings (body, entity_id, title, meeting_on) values ('members', $1, 'x', current_date)",
        [NORTH_TRUST],
        /company or an LLC/,
      );
    });
  });

  it("needs the quorum recorded, a Manager who didn't record it, and then the carried decisions count from the meeting date", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      const { m, d } = await heldBoardMeeting(db);
      await db.query(
        "update decisions set outcome = 'carried', votes_for = 2 where id = $1",
        [d],
      );
      await refused(
        db,
        "update meetings set status = 'confirmed' where id = $1",
        [m],
        /only a Manager/,
      );
      await switchUser(db, hub, MANAGER);
      await refused(
        db,
        "update meetings set status = 'confirmed' where id = $1",
        [m],
        /quorum isn't recorded/,
      );
      await switchUser(db, hub, ADMIN);
      await db.query(
        "update entities set board_quorum_rule = 'number', board_quorum_number = 2 where id = $1",
        [HOLDINGS],
      );
      await switchUser(db, hub, MANAGER);
      await db.query("update meetings set status = 'confirmed' where id = $1", [
        m,
      ]);
      expect(
        await one(
          db,
          "select number, quorum_met, confirmed_by from meetings where id = $1",
          [m],
        ),
      ).toEqual({ number: 1, quorum_met: true, confirmed_by: MANAGER });
      expect(
        (
          await one(
            db,
            "select passed_on = current_date - 1 as ok from decisions where id = $1",
            [d],
          )
        ).ok,
      ).toBe(true);

      // Kept as it was: only the minutes can still change, until approved.
      await refused(
        db,
        "update meetings set title = 'Changed' where id = $1",
        [m],
        /confirmed meeting can't be changed/,
      );
      await refused(
        db,
        "update decisions set wording = 'Changed' where id = $1",
        [d],
        /confirmed or cancelled/,
      );
      await refused(
        db,
        "insert into meeting_attendees (meeting_id, person_id, capacity) values ($1, $2, 'in_attendance')",
        [m, OWN],
        /can't change/,
      );
      // The minutes: written by the Administrator, approved by a Manager who didn't write them.
      await switchUser(db, hub, ADMIN);
      await db.query(
        "update meetings set minutes = 'The minutes.', minutes_status = 'circulated' where id = $1",
        [m],
      );
      await refused(
        db,
        "update meetings set minutes_status = 'approved', minutes_approved_on = current_date where id = $1",
        [m],
        /only a Manager/,
      );
      await switchUser(db, hub, MANAGER);
      await refused(
        db,
        "update meetings set minutes_status = 'approved' where id = $1",
        [m],
        /check constraint/,
      );
      await refused(
        db,
        "update meetings set minutes = 'Rewritten', minutes_status = 'approved', minutes_approved_on = current_date where id = $1",
        [m],
        /can't also record them as approved/,
      );
      await db.query(
        "update meetings set minutes_status = 'approved', minutes_approved_on = current_date, minutes_signed_by = $2 where id = $1",
        [m, NORTH],
      );
      await refused(
        db,
        "update meetings set minutes = 'Again' where id = $1",
        [m],
        /approved minutes/,
      );
      await refused(
        db,
        "select public.request_removal('meetings', $1)",
        [m],
        /minute book/,
      );
    });
  });

  it("whoever changed the record, even an attendee, can't confirm it", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      const { m, d } = await heldBoardMeeting(db);
      await db.query(
        "update entities set board_quorum_rule = 'majority' where id = $1",
        [HOLDINGS],
      );
      await switchUser(db, hub, MANAGER);
      await db.query("update decisions set outcome = 'carried' where id = $1", [
        d,
      ]);
      await refused(
        db,
        "update meetings set status = 'confirmed' where id = $1",
        [m],
        /can't also confirm/,
      );
    });
  });

  it("without a quorum, no decision can be carried", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      const { m, d } = await heldBoardMeeting(db, { southPresent: false });
      await db.query(
        "update entities set board_quorum_rule = 'all' where id = $1",
        [HOLDINGS],
      );
      await db.query("update decisions set outcome = 'carried' where id = $1", [
        d,
      ]);
      await switchUser(db, hub, MANAGER);
      await refused(
        db,
        "update meetings set status = 'confirmed' where id = $1",
        [m],
        /1 of 2 entitled to vote were present, and 2 were needed/,
      );
      await switchUser(db, hub, ADMIN);
      await db.query(
        "update decisions set outcome = 'not_carried' where id = $1",
        [d],
      );
      await switchUser(db, hub, MANAGER);
      await db.query("update meetings set status = 'confirmed' where id = $1", [
        m,
      ]);
      expect(
        await one(
          db,
          "select m.quorum_met, d.passed_on from meetings m join decisions d on d.meeting_id = m.id where m.id = $1",
          [m],
        ),
      ).toEqual({
        quorum_met: false,
        passed_on: null,
      });
    });
  });

  it("a draft meeting is removed by two people; its decisions go with it", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      const { m } = await heldBoardMeeting(db);
      expect(await removeWithApproval(db, hub, "meetings", m)).toBe("approved");
      expect(
        await count(db, "select * from decisions where meeting_id = $1", [m]),
      ).toBe(0);
    });
  });

  it("a Family Council meeting counts the council's seats, not the company's directors", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      const m = (
        await one(
          db,
          "insert into meetings (body, governance_body_id, title, meeting_on) values ('governance', $1, 'Council', current_date) returning id",
          [COUNCIL],
        )
      ).id;
      await db.query(
        "insert into meeting_attendees (meeting_id, person_id) values ($1, $2)",
        [m, SOUTH],
      );
      await refused(
        db,
        "insert into meeting_attendees (meeting_id, person_id) values ($1, $2)",
        [m, OWN],
        /entitled to vote/,
      );
      await db.query(
        "update governance_bodies set quorum_rule = 'number', quorum_number = 2 where id = $1",
        [COUNCIL],
      );
      expect(
        await one(db, "select * from public.meeting_quorum($1)", [m]),
      ).toEqual({ entitled: 2, present: 1, needed: 2 });
    });
  });
});

describe("Written resolutions", () => {
  async function draftResolution(
    db: Client,
    body: "board" | "members",
    required = "all",
  ) {
    await switchUser(db, hub, ADMIN);
    const w = (
      await one(
        db,
        "insert into written_resolutions (body, entity_id, title, required) values ($1, $2, 'Resolution', $3) returning id",
        [body, HOLDINGS, required],
      )
    ).id;
    await db.query(
      "insert into decisions (resolution_id, item, title, wording) values ($1, 1, 'Allot', 'Resolved to allot shares.')",
      [w],
    );
    return w as string;
  }

  it("a board resolution goes to every director, and passes when the last one signs", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      await refused(
        db,
        "insert into written_resolutions (body, entity_id, title, required) values ('board', $1, 'x', 'majority')",
        [HOLDINGS],
        /check constraint/,
      );
      const w = await draftResolution(db, "board");
      await db.query(
        "insert into resolution_signatories (resolution_id, person_id) values ($1, $2)",
        [w, NORTH],
      );
      await refused(
        db,
        "insert into resolution_signatories (resolution_id, person_id) values ($1, $2)",
        [w, OWN],
        /entitled to vote/,
      );
      await refused(
        db,
        "update written_resolutions set status = 'circulated', circulated_on = current_date - 5 where id = $1",
        [w],
        /1 entitled to vote .* is not listed/,
      );
      await db.query(
        "insert into resolution_signatories (resolution_id, person_id) values ($1, $2)",
        [w, SOUTH],
      );
      await db.query(
        "update written_resolutions set status = 'circulated', circulated_on = current_date - 5 where id = $1",
        [w],
      );
      await refused(
        db,
        "update decisions set wording = 'x' where resolution_id = $1",
        [w],
        /circulated/,
      );
      await refused(
        db,
        "update resolution_signatories set signed_on = current_date - 6 where resolution_id = $1",
        [w],
        /between the day it was circulated/,
      );
      await db.query(
        "update resolution_signatories set signed_on = current_date - 4 where resolution_id = $1 and person_id = $2",
        [w, NORTH],
      );

      await switchUser(db, hub, MANAGER);
      await refused(
        db,
        "update written_resolutions set status = 'passed' where id = $1",
        [w],
        /not enough signatures/,
      );
      await switchUser(db, hub, ADMIN);
      await db.query(
        "update resolution_signatories set signed_on = current_date - 2 where resolution_id = $1 and person_id = $2",
        [w, SOUTH],
      );
      await switchUser(db, hub, MANAGER);
      await db.query(
        "update written_resolutions set status = 'passed' where id = $1",
        [w],
      );
      expect(
        await one(
          db,
          "select number, passed_on = current_date - 2 as on_last from written_resolutions where id = $1",
          [w],
        ),
      ).toEqual({ number: 1, on_last: true });
      expect(
        await one(
          db,
          "select outcome, passed_on = current_date - 2 as ok from decisions where resolution_id = $1",
          [w],
        ),
      ).toEqual({ outcome: "carried", ok: true });
      await refused(
        db,
        "update resolution_signatories set signed_on = null where resolution_id = $1",
        [w],
        /passed or lapsed/,
      );
    });
  });

  it("whoever records a signature can't confirm that it passed", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      const w = await draftResolution(db, "board");
      for (const p of [NORTH, SOUTH])
        await db.query(
          "insert into resolution_signatories (resolution_id, person_id) values ($1, $2)",
          [w, p],
        );
      await db.query(
        "update written_resolutions set status = 'circulated' where id = $1",
        [w],
      );
      await switchUser(db, hub, MANAGER);
      await db.query(
        "update resolution_signatories set signed_on = current_date where resolution_id = $1",
        [w],
      );
      await refused(
        db,
        "update written_resolutions set status = 'passed' where id = $1",
        [w],
        /can't also confirm/,
      );
    });
  });

  it("a members' resolution counts votes by voting shares: North's 100 of 150 is a majority", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      const w = await draftResolution(db, "members", "majority");
      await db.query(
        "insert into resolution_signatories (resolution_id, person_id) values ($1, $2)",
        [w, NORTH],
      );
      await db.query(
        "insert into resolution_signatories (resolution_id, organisation_id) values ($1, $2)",
        [w, ORG],
      );
      await db.query(
        "update written_resolutions set status = 'circulated' where id = $1",
        [w],
      );
      expect(
        (
          await db.query(
            "select votes from resolution_signatories where resolution_id = $1 order by votes",
            [w],
          )
        ).rows.map((r) => Number(r.votes)),
      ).toEqual([50, 100]);
      await db.query(
        "update resolution_signatories set signed_on = current_date where resolution_id = $1 and person_id = $2",
        [w, NORTH],
      );
      await switchUser(db, hub, MANAGER);
      await db.query(
        "update written_resolutions set status = 'passed' where id = $1",
        [w],
      );
      expect(
        (
          await one(
            db,
            "select status from written_resolutions where id = $1",
            [w],
          )
        ).status,
      ).toBe("passed");
    });
  });
});

describe("Share transactions and appointments need a passed decision", () => {
  async function passedDecision(db: Client, entity = HOLDINGS) {
    await switchUser(db, hub, ADMIN);
    const w = (
      await one(
        db,
        "insert into written_resolutions (body, entity_id, title) values ('board', $1, 'R') returning id",
        [entity],
      )
    ).id;
    const d = (
      await one(
        db,
        "insert into decisions (resolution_id, item, title, wording) values ($1, 1, 't', 'w') returning id",
        [w],
      )
    ).id;
    for (const p of [NORTH, SOUTH])
      await db.query(
        "insert into resolution_signatories (resolution_id, person_id) values ($1, $2)",
        [w, p],
      );
    await db.query(
      "update written_resolutions set status = 'circulated', circulated_on = current_date - 3 where id = $1",
      [w],
    );
    return { w, d } as { w: string; d: string };
  }

  it("a share transaction is approved only on a passed decision of the same company, dated on or before it", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      const { w, d } = await passedDecision(db);
      await db.query(
        "update share_transactions set basis = 'decision', decision_id = $2, transaction_date = current_date where id = $1",
        [DRAFT_ISSUE, d],
      );
      await switchUser(db, hub, MANAGER);
      await refused(
        db,
        "update share_transactions set status = 'approved' where id = $1",
        [DRAFT_ISSUE],
        /hasn't passed yet/,
      );
      await switchUser(db, hub, ADMIN);
      await db.query(
        "update resolution_signatories set signed_on = current_date - 1 where resolution_id = $1",
        [w],
      );
      await db.query(
        "update share_transactions set transaction_date = current_date - 2 where id = $1",
        [DRAFT_ISSUE],
      );
      await switchUser(db, hub, USERS.superUser);
      await db.query(
        "update written_resolutions set status = 'passed' where id = $1",
        [w],
      );
      await switchUser(db, hub, MANAGER);
      await refused(
        db,
        "update share_transactions set status = 'approved' where id = $1",
        [DRAFT_ISSUE],
        /after the date of/,
      );
      await switchUser(db, hub, ADMIN);
      await db.query(
        "update share_transactions set transaction_date = current_date where id = $1",
        [DRAFT_ISSUE],
      );
      await switchUser(db, hub, MANAGER);
      await db.query(
        "update share_transactions set status = 'approved' where id = $1",
        [DRAFT_ISSUE],
      );
      expect(
        (
          await one(db, "select status from share_transactions where id = $1", [
            DRAFT_ISSUE,
          ])
        ).status,
      ).toBe("approved");
      // The resolution is now a record: it can't be removed.
      await refused(
        db,
        "select public.request_removal('written_resolutions', $1)",
        [w],
        /register of resolutions/,
      );
    });
  });

  it("a decision of another entity, no basis, or 'earlier' are refused", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      await db.query(
        "insert into appointments (entity_id, role, organisation_id, basis) values ($1, 'trustee', $2, 'formation') on conflict do nothing",
        [NORTH_TRUST, ORG],
      );
      const { d } = await passedDecision(db);
      await refused(
        db,
        "update share_transactions set basis = 'earlier' where id = $1",
        [DRAFT_ISSUE],
        /made before decisions/,
      );
      await refused(
        db,
        "insert into appointments (entity_id, role, person_id) values ($1, 'secretary', $2)",
        [HOLDINGS, NORTH],
        /say what it was decided by/,
      );
      await refused(
        db,
        "insert into appointments (entity_id, role, person_id, basis) values ($1, 'protector', $2, 'decision')",
        [NORTH_TRUST, NORTH],
        /choose the decision/,
      );
      await refused(
        db,
        "insert into appointments (entity_id, role, person_id, basis, decision_id) values ($1, 'protector', $2, 'decision', $3)",
        [NORTH_TRUST, NORTH, d],
        /one of this entity's/,
      );
      await refused(
        db,
        "insert into appointments (entity_id, role, person_id, basis) values ($1, 'protector', $2, 'instrument')",
        [NORTH_TRUST, NORTH],
        /deed or letter/,
      );
      await db.query(
        "insert into appointments (entity_id, role, person_id, basis, basis_note) values ($1, 'protector', $2, 'instrument', 'Deed of appointment, 1 March 2026')",
        [NORTH_TRUST, NORTH],
      );
      await refused(
        db,
        "insert into appointments (entity_id, role, person_id, basis, decision_id) values ($1, 'secretary', $2, 'decision', $3)",
        [HOLDINGS, NORTH, d],
        /hasn't passed yet/,
      );
    });
  });

  it("records made before decisions were kept here are marked 'earlier' and can still be ended", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      expect(
        await count(db, "select * from appointments where basis = 'earlier'"),
      ).toBeGreaterThan(0);
      expect(
        await count(
          db,
          "select * from share_transactions where status = 'approved' and basis is distinct from 'earlier'",
        ),
      ).toBe(0);
      await db.query(
        "update appointments set ceased_on = current_date where entity_id = $1 and person_id = $2",
        [HOLDINGS, SOUTH],
      );
    });
  });
});

describe("File notes", () => {
  it("record who wrote them, which can't be changed", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      const n = await one(
        db,
        "insert into file_notes (title, body, written_by) values ('Note', 'Text', $1) returning id, written_by",
        [MANAGER],
      );
      expect(n.written_by).toBe(ADMIN);
      await db.query("update file_notes set written_by = $2 where id = $1", [
        n.id,
        MANAGER,
      ]);
      expect(
        (
          await one(db, "select written_by from file_notes where id = $1", [
            n.id,
          ])
        ).written_by,
      ).toBe(ADMIN);
    });
  });
});

describe("Review fixes", () => {
  it("the quorum counts only those still entitled to vote on the day", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      const { m, d } = await heldBoardMeeting(db);
      await db.query(
        "update entities set board_quorum_rule = 'number', board_quorum_number = 2 where id = $1",
        [HOLDINGS],
      );
      await db.query("update decisions set outcome = 'carried' where id = $1", [
        d,
      ]);
      // South stopped being a director before the meeting.
      await db.query(
        "update appointments set ceased_on = current_date - 30 where entity_id = $1 and person_id = $2",
        [HOLDINGS, SOUTH],
      );
      expect(
        await one(db, "select * from public.meeting_quorum($1)", [m]),
      ).toEqual({ entitled: 1, present: 1, needed: 2 });
      await switchUser(db, hub, MANAGER);
      await refused(
        db,
        "update meetings set status = 'confirmed' where id = $1",
        [m],
        /were present, and 2 were needed/,
      );
    });
  });

  it("who holds an appointment, and which role, can't be changed; it is ended and a new one recorded", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      await refused(
        db,
        "update appointments set person_id = $3 where entity_id = $1 and person_id = $2",
        [HOLDINGS, SOUTH, OWN],
        /can't be changed/,
      );
      await refused(
        db,
        "update appointments set role = 'secretary' where entity_id = $1 and person_id = $2",
        [HOLDINGS, SOUTH],
        /can't be changed/,
      );
    });
  });

  it("a share transaction can't rely on a deed of appointment, and the formation documents only cover formation", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      await refused(
        db,
        "update share_transactions set basis = 'instrument', basis_note = 'x' where id = $1",
        [DRAFT_ISSUE],
        /minute or resolution/,
      );
      await db.query(
        "update entities set registered_on = '2020-01-01' where id = $1",
        [HOLDINGS],
      );
      await db.query(
        "update share_transactions set basis = 'formation', transaction_date = '2021-01-02' where id = $1",
        [DRAFT_ISSUE],
      );
      await switchUser(db, hub, MANAGER);
      await refused(
        db,
        "update share_transactions set status = 'approved' where id = $1",
        [DRAFT_ISSUE],
        /within 30 days of registration/,
      );
    });
  });

  it("a note about the whole family is for editors and whole-family Viewers only", async () => {
    const seen = await as(hartley, await signedIn(ADMIN), async (db) => {
      await db.query(
        "insert into file_notes (title, body) values ('Family call', 'Private discussion.')",
      );
      const out: number[] = [];
      for (const [u, aal] of [
        [USERS.hartleyViewerWholeFamily, "aal1"],
        [USERS.hartleyViewerBranch, "aal1"],
        [USERS.hartleyViewerOwnRecord, "aal1"],
      ] as const) {
        await switchUser(db, hub, u, aal);
        out.push(
          await count(
            db,
            "select * from file_notes where title = 'Family call'",
          ),
        );
      }
      return out;
    });
    expect(seen).toEqual([1, 0, 0]);
  });

  it("a cancelled meeting can only be planned again; the voter list isn't open to callers directly", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      const m = (
        await one(
          db,
          "insert into meetings (body, entity_id, title, meeting_on) values ('board', $1, 'x', current_date - 1) returning id",
          [HOLDINGS],
        )
      ).id;
      await db.query("update meetings set status = 'cancelled' where id = $1", [
        m,
      ]);
      await refused(
        db,
        "update meetings set status = 'held' where id = $1",
        [m],
        /planned again/,
      );
      await refused(
        db,
        "select * from private.voters('members', $1, null, current_date)",
        [HOLDINGS],
        /permission denied/,
      );
      await switchUser(db, hub, USERS.hartleyViewerBranch, "aal1");
      expect(
        await count(
          db,
          "select * from public.body_voters('members', $1, null, current_date)",
          [HOLDINGS],
        ),
      ).toBe(0);
    });
  });
});

describe("Changes that follow a decision", () => {
  const passResolution = async (db: Client, w: string) => {
    for (const p of [NORTH, SOUTH])
      await db.query(
        "insert into resolution_signatories (resolution_id, person_id) values ($1, $2)",
        [w, p],
      );
    await db.query(
      "update written_resolutions set status = 'circulated', circulated_on = current_date - 3 where id = $1",
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
  };

  it("an appointment drafted into a written resolution is recorded when it passes", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      const w = (
        await one(
          db,
          "insert into written_resolutions (body, entity_id, title) values ('board', $1, 'Secretary') returning id",
          [HOLDINGS],
        )
      ).id;
      await db.query(
        "insert into decisions (resolution_id, item, title, wording, action, proposed) values ($1, 1, 'Appointment', 'That … be appointed secretary.', 'appoint', $2)",
        [w, JSON.stringify({ role: "secretary", person_id: OWN })],
      );
      expect(
        await count(db, "select * from appointments where person_id = $1", [
          OWN,
        ]),
      ).toBe(0);
      await passResolution(db, w);
      expect(
        await one(
          db,
          "select role, basis, appointed_on = current_date - 1 as on_pass from appointments where person_id = $1",
          [OWN],
        ),
      ).toEqual({
        role: "secretary",
        basis: "decision",
        on_pass: true,
      });
    });
  });

  it("a removal carried at a confirmed meeting ends the appointment on the meeting date; one not carried changes nothing", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      await db.query(
        "update entities set board_quorum_rule = 'majority' where id = $1",
        [HOLDINGS],
      );
      const appt = (
        await one(
          db,
          "select id from appointments where entity_id = $1 and person_id = $2",
          [HOLDINGS, SOUTH],
        )
      ).id;
      const { m, d } = await heldBoardMeeting(db);
      await db.query("update decisions set outcome = 'carried' where id = $1", [
        d,
      ]);
      const r = (
        await one(
          db,
          "insert into decisions (meeting_id, item, title, wording, action, appointment_id) values ($1, 2, 'Removal', 'w', 'end_appointment', $2) returning id",
          [m, appt],
        )
      ).id;
      await refused(
        db,
        "update decisions set appointment_id = null where id = $1",
        [r],
        /can't be altered/,
      );
      await db.query("update decisions set outcome = 'carried' where id = $1", [
        r,
      ]);
      await switchUser(db, hub, MANAGER);
      await db.query("update meetings set status = 'confirmed' where id = $1", [
        m,
      ]);
      expect(
        (
          await one(
            db,
            "select ceased_on = current_date - 1 as ok from appointments where id = $1",
            [appt],
          )
        ).ok,
      ).toBe(true);
    });
    await as(hartley, await signedIn(ADMIN), async (db) => {
      await db.query(
        "update entities set board_quorum_rule = 'majority' where id = $1",
        [HOLDINGS],
      );
      const appt = (
        await one(
          db,
          "select id from appointments where entity_id = $1 and person_id = $2",
          [HOLDINGS, SOUTH],
        )
      ).id;
      const { m, d } = await heldBoardMeeting(db);
      await db.query(
        "update decisions set outcome = 'not_carried', action = null where id = $1",
        [d],
      );
      await db.query(
        "insert into decisions (meeting_id, item, title, wording, action, appointment_id, outcome) values ($1, 2, 'Removal', 'w', 'end_appointment', $2, 'not_carried')",
        [m, appt],
      );
      await switchUser(db, hub, MANAGER);
      await db.query("update meetings set status = 'confirmed' where id = $1", [
        m,
      ]);
      expect(
        (
          await one(db, "select ceased_on from appointments where id = $1", [
            appt,
          ])
        ).ceased_on,
      ).toBeNull();
    });
  });

  it("a share transaction drafted for a resolution goes on the register when it passes, dated the day it passed", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      const w = (
        await one(
          db,
          "insert into written_resolutions (body, entity_id, title) values ('board', $1, 'Allotment') returning id",
          [HOLDINGS],
        )
      ).id;
      const d = (
        await one(
          db,
          "insert into decisions (resolution_id, item, title, wording, action) values ($1, 1, 'Allotment', 'w', 'share_transaction') returning id",
          [w],
        )
      ).id;
      await db.query(
        "update share_transactions set basis = 'decision', decision_id = $2, transaction_date = current_date - 10 where id = $1",
        [DRAFT_ISSUE, d],
      );
      await passResolution(db, w);
      expect(
        await one(
          db,
          "select status, transaction_date = current_date - 1 as on_pass from share_transactions where id = $1",
          [DRAFT_ISSUE],
        ),
      ).toEqual({
        status: "approved",
        on_pass: true,
      });
    });
  });

  it("a resignation is noted, not decided, once it has been recorded; governance bodies don't change officers", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      const appt = (
        await one(
          db,
          "select id from appointments where entity_id = $1 and person_id = $2",
          [HOLDINGS, SOUTH],
        )
      ).id;
      const m = (
        await one(
          db,
          "insert into meetings (body, entity_id, title, meeting_on) values ('board', $1, 'Board', current_date) returning id",
          [HOLDINGS],
        )
      ).id;
      await refused(
        db,
        "insert into decisions (meeting_id, item, title, wording, action, appointment_id, outcome) values ($1, 1, 'Resignation', 'w', 'note_resignation', $2, 'noted')",
        [m, appt],
        /record the resignation/,
      );
      await db.query(
        "update appointments set ceased_on = current_date - 2 where id = $1",
        [appt],
      );
      await db.query(
        "insert into decisions (meeting_id, item, title, wording, action, appointment_id, outcome) values ($1, 1, 'Resignation', 'The board noted the resignation.', 'note_resignation', $2, 'noted')",
        [m, appt],
      );
      const g = (
        await one(
          db,
          "insert into meetings (body, governance_body_id, title, meeting_on) values ('governance', $1, 'Council', current_date) returning id",
          [COUNCIL],
        )
      ).id;
      await refused(
        db,
        "insert into decisions (meeting_id, item, title, wording, action, proposed) values ($1, 1, 't', 'w', 'appoint', $2)",
        [g, JSON.stringify({ role: "director", person_id: OWN })],
        /board or members/,
      );
      const w = (
        await one(
          db,
          "insert into written_resolutions (body, entity_id, title) values ('board', $1, 'x') returning id",
          [HOLDINGS],
        )
      ).id;
      await refused(
        db,
        "insert into decisions (resolution_id, item, title, wording, outcome) values ($1, 1, 't', 'w', 'noted')",
        [w],
        /check constraint|written resolution/,
      );
    });
  });
});
