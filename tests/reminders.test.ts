import { describe, expect, it } from "vitest";
import { compose, dueToday, lines } from "@/lib/reminders";

describe("email reminders", () => {
  it("go out weekly on Mondays, or every weekday, or never", () => {
    expect(dueToday("weekly", "2026-11-09")).toBe(true); // a Monday
    expect(dueToday("weekly", "2026-11-10")).toBe(false);
    expect(dueToday("daily", "2026-11-13")).toBe(true); // a Friday
    expect(dueToday("daily", "2026-11-14")).toBe(false); // a Saturday
    expect(dueToday("off", "2026-11-09")).toBe(false);
  });
  it("say how many, in plain words, with no names, details or links", () => {
    expect(lines({ todos_overdue: 1, todos_this_week: 2, approvals: 3 })).toEqual([
      "1 to-do given to you is overdue",
      "2 to-dos given to you are due in the next week",
      "3 items are waiting for a Manager's approval",
    ]);
    const m = compose("Test <Manager>", [
      { name: "Hartley family", counts: { risk_reviews: 1 } },
      { name: "Visser family", counts: {} },
    ]);
    expect(m.text).toContain("Hartley family:\n- 1 risk you own is due for review");
    expect(m.text).not.toContain("Visser");
    expect(m.items).toBe(1);
    expect(m.html).not.toMatch(/<a\s|href=|https?:/i);
    expect(m.text).not.toMatch(/https?:/i);
    expect(m.html).toContain("Test &lt;Manager&gt;");
  });
});
