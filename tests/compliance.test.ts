import { describe, expect, it } from "vitest";
import { layout } from "@/lib/structure";
import { addBusinessDays, addMonths, describeRule, entityCalendar, eventMatches, recurringDates, type Obligation } from "@/lib/compliance";

const base: Obligation = {
  key: "x",
  name: "X",
  authority: null,
  kind: "recurring",
  basis: "year_end",
  offset_months: 0,
  offset_days: 0,
  business_days: false,
  fixed_month: null,
  fixed_day: null,
  alt_month: null,
  alt_day: null,
  event_type: null,
  event_roles: null,
  to_confirm: false,
  notes: null,
};
const ob = (o: Partial<Obligation>): Obligation => ({ ...base, ...o });
const company = { id: "e", registered_on: "2020-04-15", year_end_month: 3, year_end_day: 31, status: "active" };

describe("dates", () => {
  it("adds months, keeping month ends and short months right", () => {
    expect(addMonths("2026-03-31", 9)).toBe("2026-12-31");
    expect(addMonths("2026-09-30", 1)).toBe("2026-10-31");
    expect(addMonths("2026-01-30", 1)).toBe("2026-02-28");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
  });
  it("counts business days Monday to Friday", () => {
    expect(addBusinessDays("2026-10-30", 1)).toBe("2026-11-02"); // Friday + 1 = Monday
    expect(addBusinessDays("2026-11-02", 10)).toBe("2026-11-16");
  });
});

describe("recurring obligations", () => {
  it("UK accounts: 9 months after each year end", () => {
    const dates = recurringDates(ob({ offset_months: 9 }), company, "2025-11-01", "2028-02-01");
    expect(dates).toEqual([
      { due: "2025-12-31", period: "Year ended 31 Mar 2025" },
      { due: "2026-12-31", period: "Year ended 31 Mar 2026" },
      { due: "2027-12-31", period: "Year ended 31 Mar 2027" },
    ]);
  });
  it("IoM annual return: 1 month after each anniversary of registration, not before registration", () => {
    const dates = recurringDates(ob({ basis: "anniversary", offset_months: 1 }), { ...company, registered_on: "2025-06-10" }, "2024-01-01", "2027-12-31");
    expect(dates).toEqual([
      { due: "2026-07-10", period: "Anniversary 10 Jun 2026" },
      { due: "2027-07-10", period: "Anniversary 10 Jun 2027" },
    ]);
  });
  it("BVI annual fee: 31 May or 30 Nov by the half-year of registration", () => {
    const o = ob({ basis: "half_year", fixed_month: 5, fixed_day: 31, alt_month: 11, alt_day: 30 });
    expect(recurringDates(o, { ...company, registered_on: "2015-03-01" }, "2026-01-01", "2026-12-31")).toEqual([{ due: "2026-05-31", period: "2026" }]);
    expect(recurringDates(o, { ...company, registered_on: "2015-08-01" }, "2026-01-01", "2026-12-31")).toEqual([{ due: "2026-11-30", period: "2026" }]);
  });
  it("says what is missing when it can't work out a date", () => {
    expect(recurringDates(ob({}), { ...company, year_end_month: null, year_end_day: null }, "2026-01-01", "2026-12-31")).toMatch(/year end/);
    expect(recurringDates(ob({ basis: "anniversary" }), { ...company, registered_on: null }, "2026-01-01", "2026-12-31")).toMatch(/registration/);
  });
  it("describes the rule in words", () => {
    expect(describeRule(ob({ offset_months: 12, offset_days: 1 }))).toBe("Within 12 months and 1 day after each financial year end");
    expect(describeRule(ob({ kind: "event", basis: null, event_type: "officer_change", offset_days: 10, business_days: true }))).toBe(
      "Within 10 business days after an appointment or resignation",
    );
  });
});

describe("events", () => {
  const directorChange = ob({ kind: "event", basis: null, event_type: "officer_change", event_roles: ["director"], offset_days: 14, key: "officer_change" });
  const bo = ob({ kind: "event", basis: null, event_type: "bo_change", offset_days: 30, key: "bo_change" });
  it("matches only the roles named", () => {
    expect(eventMatches(directorChange, { type: "officer_change", role: "director", date: "2026-01-01", key: "a", label: "" })).toBe(true);
    expect(eventMatches(directorChange, { type: "officer_change", role: "auditor", date: "2026-01-01", key: "a", label: "" })).toBe(false);
  });
  it("a change of members also counts as a possible change of beneficial owners", () => {
    expect(eventMatches(bo, { type: "member_change", date: "2026-01-01", key: "t", label: "" })).toBe(true);
  });
});

describe("the calendar", () => {
  const today = "2026-11-02";
  const accounts = ob({ key: "accounts", name: "Accounts", offset_months: 9 });
  const notice = ob({ key: "officer_change", name: "Officer change", kind: "event", basis: null, event_type: "officer_change", offset_days: 14 });

  it("marks overdue, due soon, upcoming, and what has been filed", () => {
    const { items } = entityCalendar(
      company,
      [accounts, notice],
      [{ type: "officer_change", role: "director", date: "2026-10-20", key: "appt:1:start", label: "Director appointed" }],
      [{ id: "f", obligation_key: "accounts", due_date: "2025-12-31", event_key: null, status: "filed", done_on: "2025-12-01", reference: null }],
      today,
    );
    expect(items.map((i) => [i.obligation.key, i.due, i.status])).toEqual([
      ["accounts", "2025-12-31", "filed"],
      ["officer_change", "2026-11-03", "due_soon"],
      ["accounts", "2026-12-31", "due_soon"],
      ["accounts", "2027-12-31", "upcoming"],
    ]);
  });

  it("an unfiled date in the past is overdue; events more than a year old are left out", () => {
    const { items } = entityCalendar(
      company,
      [notice],
      [
        { type: "officer_change", role: "director", date: "2026-09-01", key: "a", label: "" },
        { type: "officer_change", role: "director", date: "2024-01-01", key: "b", label: "" },
      ],
      [],
      today,
    );
    expect(items.map((i) => [i.due, i.status])).toEqual([["2026-09-15", "overdue"]]);
  });

  it("nothing is due for a dissolved entity, and missing dates are reported", () => {
    expect(entityCalendar({ ...company, status: "dissolved" }, [accounts], [], [], today).items).toEqual([]);
    const { problems } = entityCalendar({ ...company, year_end_month: null, year_end_day: null }, [accounts], [], [], today);
    expect(problems[0].reason).toMatch(/year end/);
  });
});

describe("the structure chart", () => {
  it("puts owners in the row above what they own, even when that is low down", () => {
    const n = (key: string) => ({ key, label: key, sub: "", kind: "entity" as const });
    const { nodes } = layout(
      [n("hans"), n("foundation"), n("pieter"), n("holdings")],
      [
        { from: "hans", to: "foundation", label: "Founder" },
        { from: "foundation", to: "holdings", label: "70%" },
        { from: "pieter", to: "holdings", label: "30%" },
      ],
    );
    const row = Object.fromEntries(nodes.map((x) => [x.key, x.row]));
    expect(row).toEqual({ hans: 0, foundation: 1, pieter: 1, holdings: 2 });
  });
  it("doesn't loop forever when entities own each other", () => {
    const n = (key: string) => ({ key, label: key, sub: "", kind: "entity" as const });
    const { nodes } = layout([n("a"), n("b")], [{ from: "a", to: "b", label: "50%" }, { from: "b", to: "a", label: "50%" }]);
    expect(nodes).toHaveLength(2);
  });
});
