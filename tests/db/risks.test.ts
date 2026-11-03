import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DB, HARTLEY_DB, USERS, as, connect, count, hubClaims, removeWithApproval, switchUser, type Session } from "./db";

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
const HOLDINGS = "a9000000-0000-4000-8000-000000000001"; // a whole-family company
const NORTH_TRUST = "a9000000-0000-4000-8000-000000000002"; // in the North branch
const ADMIN = USERS.hartleyAdministrator;
const MANAGER = USERS.hartleyManager;
const one = async (db: Client, sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0];
const rating = { inherent_likelihood: 4, inherent_impact: 5, residual_likelihood: 2, residual_impact: 4, controls: "Board meets quarterly" };
async function addRisk(db: Client, risk: Record<string, unknown>, r: Record<string, unknown> | null = rating) {
  return (await one(db, "select public.add_risk($1, $2) as id", [{ category: "governance", ...risk }, r])).id as string;
}
async function fails(db: Client, sql: string, params: unknown[], match: RegExp) {
  await db.query("savepoint f");
  await expect(db.query(sql, params)).rejects.toThrow(match);
  await db.query("rollback to savepoint f");
}

describe("Risks", () => {
  it("are seen by who may see what they are about; risks about a person only by the team", async () => {
    const seen = await as(hartley, await signedIn(ADMIN), async (db) => {
      await addRisk(db, { title: "No succession plan" });
      await addRisk(db, { title: "Holdings key person", entity_id: HOLDINGS });
      await addRisk(db, { title: "North trust deed lost", entity_id: NORTH_TRUST });
      await addRisk(db, { title: "North branch dispute", branch_id: HARTLEY_DB.northBranch });
      await addRisk(db, { title: "North person's incapacity planning", person_id: HARTLEY_DB.northPerson });
      const out: Record<string, string[]> = {};
      for (const [u, aal] of [
        [ADMIN, "aal2"],
        [USERS.hartleyViewerWholeFamily, "aal1"],
        [USERS.hartleyViewerBranch, "aal1"],
        [USERS.hartleyViewerOwnRecord, "aal1"],
        [USERS.okaforManager, "aal2"],
      ] as const) {
        await switchUser(db, hub, u, aal);
        out[u] = (await db.query("select title from risks order by title")).rows.map((r) => r.title);
        if (u !== ADMIN) expect(await count(db, "select 1 from risk_reviews v join risks r on r.id = v.risk_id where r.person_id is not null")).toBe(0);
      }
      return out;
    });
    expect(seen[ADMIN]).toHaveLength(5);
    expect(seen[USERS.hartleyViewerWholeFamily]).toEqual(["Holdings key person", "No succession plan", "North branch dispute", "North trust deed lost"]);
    expect(seen[USERS.hartleyViewerBranch]).toEqual(["North branch dispute", "North trust deed lost"]);
    expect(seen[USERS.hartleyViewerOwnRecord]).toEqual([]);
    expect(seen[USERS.okaforManager]).toEqual([]);
  });

  it("a rating is a draft until a Manager who didn't prepare it approves it, and is then fixed", async () => {
    await as(hartley, await signedIn(MANAGER), async (db) => {
      const id = await addRisk(db, { title: "Concentration in one company" });
      const review = (await one(db, "select id, status, prepared_by from risk_reviews where risk_id = $1", [id]));
      expect(review.status).toBe("draft");
      expect(review.prepared_by).toBe(MANAGER);
      await fails(db, "update risk_reviews set status = 'approved' where id = $1", [review.id], /can't also approve/);
      await switchUser(db, hub, ADMIN);
      await fails(db, "update risk_reviews set status = 'approved' where id = $1", [review.id], /only a Manager/);
      // Someone else changing the draft doesn't let its preparer approve it.
      await db.query("update risk_reviews set residual_impact = 3 where id = $1", [review.id]);
      expect((await one(db, "select prepared_by, changed_by from risk_reviews where id = $1", [review.id]))).toEqual({ prepared_by: MANAGER, changed_by: [ADMIN] });
      await switchUser(db, hub, MANAGER);
      await fails(db, "update risk_reviews set status = 'approved' where id = $1", [review.id], /can't also approve/);
      // A Manager who neither prepared nor changed it (here the Super User) approves it.
      await switchUser(db, hub, USERS.superUser);
      await db.query("update risk_reviews set status = 'approved' where id = $1", [review.id]);
      const after = await one(db, "select v.status, v.approved_by, r.next_review_on, v.reviewed_on from risk_reviews v join risks r on r.id = v.risk_id where v.id = $1", [review.id]);
      expect(after.status).toBe("approved");
      expect(after.approved_by).toBe(USERS.superUser);
      await switchUser(db, hub, MANAGER);
      expect(after.next_review_on).not.toBeNull();
      await fails(db, "update risk_reviews set notes = 'x' where id = $1", [review.id], /can't be changed/);
      // A second draft is fine; a third at the same time isn't.
      await db.query("insert into risk_reviews (risk_id, inherent_likelihood, inherent_impact, residual_likelihood, residual_impact) values ($1, 3, 3, 2, 2)", [id]);
      await fails(db, "insert into risk_reviews (risk_id, inherent_likelihood, inherent_impact, residual_likelihood, residual_impact) values ($1, 3, 3, 2, 2)", [id], /risk_reviews_one_draft/);
    });
  });

  it("controls can't make a risk worse; ratings can't be dated in the future or start approved", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      const id = await addRisk(db, { title: "x" }, null);
      await fails(db, "insert into risk_reviews (risk_id, inherent_likelihood, inherent_impact, residual_likelihood, residual_impact) values ($1, 2, 2, 3, 3)", [id], /check constraint/);
      await fails(db, "insert into risk_reviews (risk_id, reviewed_on, inherent_likelihood, inherent_impact, residual_likelihood, residual_impact) values ($1, current_date + 1, 2, 2, 1, 1)", [id], /future/);
      await fails(db, "insert into risk_reviews (risk_id, status, inherent_likelihood, inherent_impact, residual_likelihood, residual_impact) values ($1, 'approved', 2, 2, 1, 1)", [id], /starts as a draft/);
      await fails(db, "insert into risk_reviews (risk_id, inherent_likelihood, inherent_impact, residual_likelihood, residual_impact) values ($1, 6, 2, 1, 1)", [id], /check constraint/);
    });
  });

  it("only a Manager changes what a risk is about, or closes it (with a reason)", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      const id = await addRisk(db, { title: "North dispute", branch_id: HARTLEY_DB.northBranch });
      await db.query("update risks set title = 'North branch dispute', owner_id = $2 where id = $1", [id, ADMIN]);
      await fails(db, "update risks set branch_id = null where id = $1", [id], /only a Manager can change what a risk is about/);
      await fails(db, "update risks set status = 'closed', closed_on = current_date, closed_reason = 'Settled' where id = $1", [id], /only a Manager can close/);
      await switchUser(db, hub, MANAGER);
      await fails(db, "update risks set status = 'closed', closed_on = current_date where id = $1", [id], /check constraint/);
      await db.query("update risks set status = 'closed', closed_on = current_date, closed_reason = 'Settled' where id = $1", [id]);
      expect((await one(db, "select closed_by from risks where id = $1", [id])).closed_by).toBe(MANAGER);
      await switchUser(db, hub, ADMIN);
      await fails(db, "update risks set closed_reason = 'Something else' where id = $1", [id], /can't change/);
      await switchUser(db, hub, MANAGER);
      await db.query("update risks set status = 'open' where id = $1", [id]);
      expect((await one(db, "select closed_on, closed_reason from risks where id = $1", [id])).closed_reason).toBeNull();
    });
  });

  it("whole-family risks need a current Viewer role, not just a grant", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      await addRisk(db, { title: "Whole-family" });
      await switchUser(db, hub, USERS.hartleyViewerWithMfa, "aal1"); // has two-factor but didn't use it
      expect(await count(db, "select 1 from risks")).toBe(0);
      expect(await count(db, "select 1 from risk_reviews")).toBe(0);
      expect(await count(db, "select 1 from file_notes")).toBe(0);
    });
  });

  it("an approved rating moves a review date that is due soon to a year later", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      const id = await addRisk(db, { title: "Due soon", next_review_on: new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10) });
      await switchUser(db, hub, MANAGER);
      await db.query("update risk_reviews set status = 'approved' where risk_id = $1", [id]);
      const r = await one(db, "select next_review_on > current_date + 300 as moved from risks where id = $1", [id]);
      expect(r.moved).toBe(true);
    });
  });

  it("Viewers can't add risks or ratings", async () => {
    await as(hartley, await signedIn(USERS.hartleyViewerWholeFamily, "aal1"), async (db) => {
      await expect(db.query("insert into risks (title, category) values ('x', 'governance')")).rejects.toThrow(/row-level security/);
    });
  });

  it("are removed by two people only while unrated; a rated risk is closed instead", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      const unrated = await addRisk(db, { title: "Draft only" });
      expect(await removeWithApproval(db, hub, "risks", unrated)).toBe("approved");
      expect(await count(db, "select 1 from risk_reviews where risk_id = $1", [unrated])).toBe(0);

      await switchUser(db, hub, ADMIN);
      const rated = await addRisk(db, { title: "Rated" });
      await switchUser(db, hub, MANAGER);
      await db.query("update risk_reviews set status = 'approved' where risk_id = $1", [rated]);
      await switchUser(db, hub, ADMIN);
      await expect(db.query("select public.request_removal('risks', $1)", [rated])).rejects.toThrow(/Close the risk instead/);
    });
  });

  it("a person, entity or branch with risks can't be removed until the risks go", async () => {
    await as(hartley, await signedIn(MANAGER), async (db) => {
      const person = (await one(db, "insert into people (member_type, full_names, surname) values ('family', 'Test', 'Risky') returning id")).id;
      const r = await addRisk(db, { title: "About a person", person_id: person }, null);
      await db.query("savepoint s");
      await expect(removeWithApproval(db, hub, "people", person)).rejects.toThrow(/risks about this/);
      await db.query("rollback to savepoint s");
      expect(await removeWithApproval(db, hub, "risks", r)).toBe("approved");
      expect(await removeWithApproval(db, hub, "people", person)).toBe("approved");
    });
  });

  it("suggestions are dismissed with a reason; only a Manager asks again", async () => {
    await as(hartley, await signedIn(ADMIN), async (db) => {
      await fails(db, "insert into risk_suggestion_answers (suggestion_key) values ('one-director:x')", [], /check constraint/);
      await db.query("insert into risk_suggestion_answers (suggestion_key, reason) values ('one-director:x', 'A second director is being appointed')");
      await fails(db, "update risk_suggestion_answers set dismissed = false where suggestion_key = 'one-director:x'", [], /only a Manager/);
      await switchUser(db, hub, MANAGER);
      await db.query("update risk_suggestion_answers set dismissed = false, reason = null where suggestion_key = 'one-director:x'");
      await switchUser(db, hub, USERS.hartleyViewerWholeFamily, "aal1");
      expect(await count(db, "select 1 from risk_suggestion_answers")).toBe(0);
    });
  });
});

describe("Risk categories (hub)", () => {
  it("start as the ten domains; everyone signed in reads them; only the Super User and System Admin change them", async () => {
    const manager = await signedIn(MANAGER);
    const superUser = await signedIn(USERS.superUser);
    await as(hub, manager, async (db) => {
      expect(await count(db, "select 1 from risk_categories where active")).toBe(10);
      expect((await db.query("update risk_categories set name = 'x' where key = 'tax'")).rowCount).toBe(0);
      await expect(db.query("insert into risk_categories (key, name) values ('climate', 'Climate')")).rejects.toThrow(/row-level security/);
    });
    await as(hub, superUser, async (db) => {
      expect((await db.query("update risk_categories set name = 'Tax and reporting' where key = 'tax'")).rowCount).toBe(1);
      await db.query("insert into risk_categories (key, name) values ('climate', 'Climate and environment')");
      expect((await db.query("delete from risk_categories where key = 'climate'")).rowCount).toBe(0);
      await expect(db.query("update risk_categories set key = 'tax2' where key = 'tax'")).rejects.toThrow(/key can't change/);
    });
  });
});
