import { describe, expect, it } from "vitest";
import {
  beneficialOwners,
  holderColumns,
  meetsRule,
  ownershipShares,
  registerOfMembers,
  type EntityOwnership,
  type ShareTransaction,
} from "@/lib/ownership";

const ORD = {
  id: "ord",
  name: "Ordinary",
  currency: "GBP",
  par_value: 1,
  limited: true,
  voting: true,
};
const PREF = {
  id: "pref",
  name: "Preference",
  currency: "GBP",
  par_value: 1,
  limited: false,
  voting: false,
};
const tom = { kind: "person" as const, id: "tom" };
const sarah = { kind: "person" as const, id: "sarah" };
const agent = { kind: "organisation" as const, id: "agent" };

let n = 0;
function tx(t: Partial<ShareTransaction>): ShareTransaction {
  n += 1;
  return {
    id: `t${n}`,
    class_id: "ord",
    kind: "issue",
    transaction_date: "2020-01-01",
    shares: 0,
    status: "approved",
    approved_at: `2020-01-01T00:00:${String(n).padStart(2, "0")}`,
    certificate_number: null,
    balance_certificate_number: null,
    to: null,
    from: null,
    ...t,
  };
}

describe("the register of members", () => {
  it("adds up authorised and issued shares, and follows transfers with new and balance certificates", () => {
    const [r] = registerOfMembers(
      [ORD],
      [
        tx({ kind: "authorise", shares: 1000 }),
        tx({ shares: 100, to: tom, certificate_number: "1" }),
        tx({ shares: 50, to: tom, certificate_number: "2" }),
        tx({
          kind: "transfer",
          transaction_date: "2021-01-01",
          shares: 60,
          from: tom,
          to: sarah,
          certificate_number: "3",
          balance_certificate_number: "4",
        }),
        tx({ shares: 999, to: sarah, status: "draft" }), // drafts don't count
      ],
    );
    expect(r.authorised).toBe(1000);
    expect(r.issued).toBe(150);
    expect(r.holdings).toEqual([
      { holder: tom, shares: 90, certificates: [{ number: "4", shares: 90 }] },
      {
        holder: sarah,
        shares: 60,
        certificates: [{ number: "3", shares: 60 }],
      },
    ]);
  });

  it("takes transactions in date order, whatever order they were recorded in", () => {
    const [r] = registerOfMembers(
      [ORD],
      [
        tx({
          kind: "transfer",
          transaction_date: "2022-01-01",
          shares: 10,
          from: tom,
          to: sarah,
          certificate_number: "2",
        }),
        tx({
          transaction_date: "2020-01-01",
          shares: 10,
          to: tom,
          certificate_number: "1",
        }),
      ],
    );
    expect(r.holdings).toEqual([
      {
        holder: sarah,
        shares: 10,
        certificates: [{ number: "2", shares: 10 }],
      },
    ]);
  });

  it("works out each holder's share across classes", () => {
    const regs = registerOfMembers(
      [ORD, PREF],
      [
        tx({ shares: 30, to: tom }),
        tx({ shares: 10, to: sarah }),
        tx({ class_id: "pref", shares: 60, to: sarah }),
      ],
    );
    expect(
      ownershipShares(regs).map((o) => [
        o.holder.id,
        o.percent,
        o.votingPercent,
      ]),
    ).toEqual([
      ["sarah", 70, 25], // the preference shares carry no votes
      ["tom", 30, 75],
    ]);
  });
});

describe("holder choices from forms", () => {
  it("turns a choice into exactly one column", () => {
    expect(holderColumns("entity:e1", "to_")).toEqual({
      to_person_id: null,
      to_organisation_id: null,
      to_entity_id: "e1",
    });
    expect(holderColumns("person:p1", "")).toEqual({
      person_id: "p1",
      organisation_id: null,
      holder_entity_id: null,
    });
    expect(holderColumns("nonsense", "to_")).toBeNull();
    expect(holderColumns("table:x", "to_")).toBeNull();
  });
});

describe("the beneficial ownership rule", () => {
  it("applies 'more than', 'at least' and 'everyone'", () => {
    expect(
      meetsRule(25, { bo_rule: "more_than", bo_threshold_percent: 25 }),
    ).toBe(false);
    expect(
      meetsRule(25, { bo_rule: "at_least", bo_threshold_percent: "25.00" }),
    ).toBe(true);
    expect(
      meetsRule(0.5, { bo_rule: "everyone", bo_threshold_percent: null }),
    ).toBe(true);
    expect(
      meetsRule(24, { bo_rule: "at_least", bo_threshold_percent: null }),
    ).toBe(false); // 25% when none is set
  });
});

describe("beneficial owners", () => {
  const entity = (
    e: Partial<EntityOwnership> & { id: string },
  ): EntityOwnership => ({
    name: e.id,
    entity_type: "company",
    shareholders: [],
    parties: [],
    managers: [],
    ...e,
  });
  const UK = { bo_rule: "more_than" as const, bo_threshold_percent: 25 };

  it("lists direct shareholders over the threshold", () => {
    const list = [
      entity({
        id: "co",
        shareholders: [
          { holder: tom, percent: 80 },
          { holder: sarah, percent: 20 },
        ],
      }),
    ];
    expect(
      beneficialOwners("co", list, UK).map((o) => [o.holder.id, o.percent]),
    ).toEqual([["tom", 80]]);
  });

  it("multiplies through a chain of family companies and adds up a person's holdings", () => {
    const list = [
      entity({
        id: "co",
        shareholders: [
          { holder: { kind: "entity", id: "hold" }, percent: 60 },
          { holder: sarah, percent: 20 },
          { holder: tom, percent: 20 },
        ],
      }),
      entity({
        id: "hold",
        name: "Holdco",
        shareholders: [
          { holder: sarah, percent: 50 },
          { holder: tom, percent: 50 },
        ],
      }),
    ];
    const owners = beneficialOwners("co", list, UK);
    expect(
      owners.map((o) => [o.holder.id, Math.round(o.percent! * 100) / 100]),
    ).toEqual([
      ["sarah", 50],
      ["tom", 50],
    ]);
    expect(owners[0].reasons[0]).toContain("through Holdco");
  });

  it("looks through a family trust that holds enough shares: all its parties are owners", () => {
    const list = [
      entity({
        id: "co",
        shareholders: [
          { holder: { kind: "entity", id: "trust" }, percent: 40 },
          { holder: tom, percent: 60 },
        ],
      }),
      entity({
        id: "trust",
        name: "Family Trust",
        entity_type: "trust",
        parties: [
          { holder: tom, role: "Settlor" },
          { holder: agent, role: "Trustee" },
          { holder: sarah, role: "Beneficiary" },
        ],
      }),
    ];
    const owners = beneficialOwners("co", list, UK);
    expect(owners.map((o) => o.holder.id).sort()).toEqual([
      "agent",
      "sarah",
      "tom",
    ]);
    expect(owners.find((o) => o.holder.id === "sarah")!.reasons).toEqual([
      "Beneficiary of Family Trust, which holds 40%",
    ]);
    expect(owners.find((o) => o.holder.id === "tom")!.reasons).toHaveLength(2);
  });

  it("doesn't look through a trust whose holding is below the threshold", () => {
    const list = [
      entity({
        id: "co",
        shareholders: [
          { holder: { kind: "entity", id: "trust" }, percent: 10 },
          { holder: tom, percent: 90 },
        ],
      }),
      entity({
        id: "trust",
        entity_type: "trust",
        parties: [{ holder: sarah, role: "Beneficiary" }],
      }),
    ];
    expect(beneficialOwners("co", list, UK).map((o) => o.holder.id)).toEqual([
      "tom",
    ]);
  });

  it("for a trust itself, everyone with a role counts", () => {
    const list = [
      entity({
        id: "trust",
        entity_type: "trust",
        parties: [
          { holder: tom, role: "Settlor" },
          { holder: sarah, role: "Beneficiary" },
        ],
      }),
    ];
    expect(
      beneficialOwners("trust", list, {
        bo_rule: "everyone",
        bo_threshold_percent: null,
      })
        .map((o) => o.holder.id)
        .sort(),
    ).toEqual(["sarah", "tom"]);
  });

  it("reports the directors when nobody meets the rule, and marks outside organisations", () => {
    const list = [
      entity({
        id: "co",
        shareholders: [
          { holder: agent, percent: 30 },
          { holder: tom, percent: 10 },
          { holder: sarah, percent: 10 },
        ],
        managers: [{ holder: sarah, role: "Director" }],
      }),
    ];
    const owners = beneficialOwners("co", list, UK);
    expect(
      owners.map((o) => [o.holder.id, Boolean(o.outside), Boolean(o.fallback)]),
    ).toEqual([
      ["agent", true, false],
      ["sarah", false, true],
    ]);
  });

  it("works nothing out until shareholders (or parties) are recorded", () => {
    const list = [
      entity({ id: "co", managers: [{ holder: sarah, role: "Director" }] }),
    ];
    expect(beneficialOwners("co", list, UK)).toEqual([]);
  });

  it("lists a family company it can't look through, rather than leaving it out", () => {
    const list = [
      entity({
        id: "co",
        shareholders: [
          { holder: { kind: "entity", id: "hold" }, percent: 100 },
        ],
        managers: [{ holder: sarah, role: "Director" }],
      }),
      entity({ id: "hold", name: "Holdco" }), // its own register is empty
    ];
    const owners = beneficialOwners("co", list, UK);
    expect(
      owners.map((o) => [
        o.holder.id,
        Boolean(o.unresolved),
        Boolean(o.fallback),
      ]),
    ).toEqual([
      ["hold", true, false],
      ["sarah", false, true],
    ]);
    // An entity that isn't visible at all is listed the same way.
    expect(beneficialOwners("co", [list[0]], UK)[0]).toMatchObject({
      holder: { id: "hold" },
      unresolved: true,
    });
  });

  it("doesn't loop forever when companies hold each other", () => {
    const list = [
      entity({
        id: "a",
        shareholders: [
          { holder: { kind: "entity", id: "b" }, percent: 50 },
          { holder: tom, percent: 50 },
        ],
      }),
      entity({
        id: "b",
        shareholders: [{ holder: { kind: "entity", id: "a" }, percent: 100 }],
      }),
    ];
    expect(
      beneficialOwners("a", list, {
        bo_rule: "at_least",
        bo_threshold_percent: 25,
      }).map((o) => o.holder.id),
    ).toEqual(["tom"]);
  });
});
