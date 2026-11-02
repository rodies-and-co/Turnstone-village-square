import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DB,
  HARTLEY,
  OKAFOR,
  USERS,
  as,
  asOwner,
  connect,
  count,
  hubClaims,
  tablesWithRls,
  type Session,
} from "./db";

let hub: Client;

beforeAll(async () => {
  hub = await connect(DB.hub);
});

afterAll(async () => {
  await hub.end();
});

const user = (id: string, aal: "aal1" | "aal2" = "aal2"): Session => ({
  kind: "user",
  id,
  aal,
});
const anonymous: Session = { kind: "anonymous" };

describe("hub: every table is protected", () => {
  it("has row-level security switched on for every table", async () => {
    const tables = await tablesWithRls(hub);
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables)
      expect(t.rls, `${t.table} must have RLS`).toBe(true);
  });

  it("shows nothing to visitors who are not signed in", async () => {
    for (const table of ["families", "staff", "family_access", "audit_log"]) {
      await expect(
        as(hub, anonymous, (db) => db.query(`select * from ${table}`)),
      ).rejects.toThrow(/permission denied/);
    }
  });
});

describe("hub: who can see which families", () => {
  it("Super User and System Admin see every family, after two-factor only", async () => {
    for (const id of [USERS.superUser, USERS.systemAdmin]) {
      expect(
        await as(hub, user(id), (db) => count(db, "select * from families")),
      ).toBe(2);
      expect(
        await as(hub, user(id, "aal1"), (db) =>
          count(db, "select * from families"),
        ),
      ).toBe(0);
    }
  });

  it("a Manager sees only their own family, after two-factor only", async () => {
    const ids = await as(hub, user(USERS.hartleyManager), async (db) =>
      (await db.query("select id from families")).rows.map((r) => r.id),
    );
    expect(ids).toEqual([HARTLEY]);
    expect(
      await as(hub, user(USERS.hartleyManager, "aal1"), (db) =>
        count(db, "select * from families"),
      ),
    ).toBe(0);
  });

  it("a Viewer without two-factor set up can open their family; with it set up, only after using it", async () => {
    expect(
      await as(hub, user(USERS.hartleyViewerWholeFamily, "aal1"), (db) =>
        count(db, "select * from families"),
      ),
    ).toBe(1);
    expect(
      await as(hub, user(USERS.hartleyViewerWithMfa, "aal1"), (db) =>
        count(db, "select * from families"),
      ),
    ).toBe(0);
    expect(
      await as(hub, user(USERS.hartleyViewerWithMfa, "aal2"), (db) =>
        count(db, "select * from families"),
      ),
    ).toBe(1);
  });

  it("someone with no access sees no families", async () => {
    expect(
      await as(hub, user(USERS.nobody), (db) =>
        count(db, "select * from families"),
      ),
    ).toBe(0);
  });
});

describe("hub: managing access", () => {
  const add =
    (familyId: string, userId: string, role: string) => (db: Client) =>
      db.query(
        "insert into family_access (family_id, user_id, role) values ($1, $2, $3)",
        [familyId, userId, role],
      );

  it("a Manager can add Viewers and Administrators to their own family", async () => {
    await as(
      hub,
      user(USERS.hartleyManager),
      add(HARTLEY, USERS.nobody, "viewer"),
    );
    await as(
      hub,
      user(USERS.hartleyManager),
      add(HARTLEY, USERS.nobody, "administrator"),
    );
  });

  it("a Manager cannot add another Manager", async () => {
    await expect(
      as(
        hub,
        user(USERS.hartleyManager),
        add(HARTLEY, USERS.nobody, "manager"),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("a Manager cannot add anyone to another family", async () => {
    await expect(
      as(hub, user(USERS.hartleyManager), add(OKAFOR, USERS.nobody, "viewer")),
    ).rejects.toThrow(/row-level security/);
  });

  it("a Manager cannot remove or promote someone into a Manager", async () => {
    const changed = await as(
      hub,
      user(USERS.hartleyManager),
      async (db) =>
        (
          await db.query(
            "update family_access set role = 'manager' where user_id = $1",
            [USERS.hartleyViewerWholeFamily],
          )
        ).rowCount,
    ).catch(() => "refused");
    expect(changed === 0 || changed === "refused").toBe(true);
  });

  it("Administrators and Viewers cannot manage access", async () => {
    for (const id of [
      USERS.hartleyAdministrator,
      USERS.hartleyViewerWholeFamily,
    ]) {
      await expect(
        as(hub, user(id), add(HARTLEY, USERS.nobody, "viewer")),
      ).rejects.toThrow(/row-level security/);
    }
  });

  it("nobody but a Super User can give themselves access", async () => {
    await expect(
      as(
        hub,
        user(USERS.systemAdmin),
        add(HARTLEY, USERS.systemAdmin, "manager"),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      as(
        hub,
        user(USERS.hartleyManager),
        add(OKAFOR, USERS.hartleyManager, "viewer"),
      ),
    ).rejects.toThrow(/row-level security/);
    const changed = await as(
      hub,
      user(USERS.hartleyAdministrator),
      async (db) =>
        (
          await db.query(
            "update family_access set role = 'manager' where user_id = $1",
            [USERS.hartleyAdministrator],
          )
        ).rowCount,
    );
    expect(changed).toBe(0);
  });

  it("only a Super User can give Turnstone staff with a system role a family role", async () => {
    await expect(
      as(
        hub,
        user(USERS.hartleyManager),
        add(HARTLEY, USERS.systemAdmin, "administrator"),
      ),
    ).rejects.toThrow(/row-level security/);
    await as(
      hub,
      user(USERS.superUser),
      add(HARTLEY, USERS.systemAdmin, "viewer"),
    );
  });

  it("a System Admin can add a Manager; only a Super User can add a family or staff", async () => {
    await as(
      hub,
      user(USERS.systemAdmin),
      add(OKAFOR, USERS.nobody, "manager"),
    );
    await expect(
      as(hub, user(USERS.systemAdmin), (db) =>
        db.query("insert into families (name) values ('Test')"),
      ),
    ).rejects.toThrow(/row-level security/);
    await as(hub, user(USERS.superUser), (db) =>
      db.query("insert into families (name) values ('Test')"),
    );
    await expect(
      as(hub, user(USERS.systemAdmin), (db) =>
        db.query(
          "insert into staff (user_id, display_name, system_role) values ($1, 'X', 'super_user')",
          [USERS.nobody],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("a Manager sees the access list of their own family only", async () => {
    const families = await as(hub, user(USERS.hartleyManager), async (db) =>
      (await db.query("select distinct family_id from family_access")).rows.map(
        (r) => r.family_id,
      ),
    );
    expect(families).toEqual([HARTLEY]);
  });

  it("a Viewer sees only their own access row", async () => {
    const n = await as(hub, user(USERS.hartleyViewerBranch), (db) =>
      count(db, "select * from family_access"),
    );
    expect(n).toBe(1);
  });
});

describe("hub: where family databases live", () => {
  it("only a Super User can change a family's database address", async () => {
    const set = (db: Client) =>
      db.query(
        "update families set database_url = 'https://attacker.supabase.co' where id = $1",
        [HARTLEY],
      );
    expect((await as(hub, user(USERS.systemAdmin), set)).rowCount).toBe(0);
    expect((await as(hub, user(USERS.hartleyManager), set)).rowCount).toBe(0);
    expect((await as(hub, user(USERS.superUser), set)).rowCount).toBe(1);
  });

  it("refuses an address that is not a Supabase project, and a secret key", async () => {
    await expect(
      asOwner(hub, (db) =>
        db.query(
          "update families set database_url = 'https://evil.example.com' where id = $1",
          [HARTLEY],
        ),
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      asOwner(hub, (db) =>
        db.query(
          "update families set database_publishable_key = 'sb_secret_x' where id = $1",
          [HARTLEY],
        ),
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it("hides archived families from their members", async () => {
    await asOwner(hub, async (db) => {
      await db.query("update families set status = 'archived' where id = $1", [
        HARTLEY,
      ]);
      await db.query("set local role authenticated");
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({
          sub: USERS.hartleyManager,
          role: "authenticated",
          aal: "aal2",
        }),
      ]);
      expect(await count(db, "select * from families")).toBe(0);
    });
  });
});

describe("hub: audit log", () => {
  it("cannot be emptied or written to, even with the secret key", async () => {
    await asOwner(hub, async (db) => {
      await expect(db.query("truncate audit_log")).rejects.toThrow(
        /cannot be changed/,
      );
    });
    await asOwner(hub, async (db) => {
      await db.query("set local role service_role");
      await expect(
        db.query("insert into audit_log (action) values ('fake')"),
      ).rejects.toThrow(/permission denied/);
    });
    await asOwner(hub, async (db) => {
      await db.query("set local role service_role");
      await expect(db.query("delete from audit_log")).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  it("records changes, can be read by system staff only, and cannot be changed", async () => {
    await asOwner(hub, async (db) => {
      await db.query(
        "insert into family_access (family_id, user_id, role) values ($1, $2, 'viewer')",
        [OKAFOR, USERS.nobody],
      );
      expect(
        await count(
          db,
          "select * from audit_log where table_name = 'family_access'",
        ),
      ).toBeGreaterThan(0);
      await expect(db.query("delete from audit_log")).rejects.toThrow(
        /cannot be changed/,
      );
    });
    await expect(
      as(hub, user(USERS.superUser), (db) =>
        db.query("insert into audit_log (action) values ('x')"),
      ),
    ).rejects.toThrow(/permission denied/);
    expect(
      await as(hub, user(USERS.hartleyManager), (db) =>
        count(db, "select * from audit_log"),
      ),
    ).toBe(0);
  });
});

describe("hub: sign-in token hook", () => {
  it("adds the user's family roles, system role and two-factor status", async () => {
    const manager = await hubClaims(hub, USERS.hartleyManager);
    expect(manager.vs).toEqual({
      system_role: null,
      families: { [HARTLEY]: "manager" },
      mfa: true,
    });

    const superUser = await hubClaims(hub, USERS.superUser);
    expect(superUser.vs).toEqual({
      system_role: "super_user",
      families: {},
      mfa: true,
    });

    const viewer = await hubClaims(hub, USERS.hartleyViewerOwnRecord);
    expect(viewer.vs).toEqual({
      system_role: null,
      families: { [HARTLEY]: "viewer" },
      mfa: false,
    });
  });

  it("leaves out archived families", async () => {
    await asOwner(hub, async (db) => {
      await db.query("update families set status = 'archived' where id = $1", [
        HARTLEY,
      ]);
      await db.query("set local role supabase_auth_admin");
      const { rows } = await db.query(
        "select public.custom_access_token_hook($1::jsonb) as r",
        [JSON.stringify({ user_id: USERS.hartleyManager, claims: {} })],
      );
      expect(rows[0].r.claims.vs.families).toEqual({});
    });
  });

  it("cannot be called by signed-in users", async () => {
    await expect(
      as(hub, user(USERS.superUser), (db) =>
        db.query("select public.custom_access_token_hook('{}'::jsonb)"),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
