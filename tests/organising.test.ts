import { describe, expect, it } from "vitest";
import { byDue, inMonth, londonDate, monthGrid, on, shiftMonth } from "@/lib/organising";

describe("the calendar", () => {
  it("lays a month out in weeks starting on Monday", () => {
    const g = monthGrid("2026-11");
    expect(g[0][0]).toBe("2026-10-26"); // 1 November 2026 is a Sunday
    expect(g[0][6]).toBe("2026-11-01");
    expect(g.at(-1)!.at(-1)).toBe("2026-12-06");
    expect(g).toHaveLength(6);
  });
  it("moves between months across the year end", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
  it("shows entries running over several days on each day", () => {
    const e = [{ date: "2026-11-27", endDate: "2026-12-02" }, { date: "2026-11-03" }];
    expect(on("2026-11-30", e)).toHaveLength(1);
    expect(inMonth("2026-12", e)).toHaveLength(1);
    expect(inMonth("2026-11", e)).toHaveLength(2);
  });
});

describe("the to-do list order", () => {
  it("puts the earliest due first, undated last, then high priority", () => {
    const list = [
      { k: "c", due: null, priority: "high" as const },
      { k: "b", due: "2026-12-01", priority: "low" as const },
      { k: "a", due: "2026-11-01", priority: "normal" as const },
      { k: "d", due: null, priority: "low" as const },
    ];
    expect(list.sort(byDue).map((x) => x.k)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("londonDate", () => {
  it("uses the London date, not UTC", () => {
    expect(londonDate("2026-07-01T23:30:00Z")).toBe("2026-07-02");
    expect(londonDate("2026-12-01T23:30:00Z")).toBe("2026-12-01");
    expect(londonDate(null)).toBeNull();
  });
});
