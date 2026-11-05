import { describe, expect, it } from "vitest";
import { arrange, dateText, parseKinds, type TimelineItem } from "@/lib/timeline";

const items: TimelineItem[] = [
  { key: "a", kind: "family", date: "1950-01-01", precision: "year", title: "Born: Anna", personIds: ["anna"] },
  { key: "b", kind: "entities", date: "1990-06-15", precision: "day", title: "Holdings formed", personIds: [] },
  { key: "c", kind: "governance", date: "1990-09-01", precision: "month", title: "First Family Council", personIds: ["anna"] },
  { key: "d", kind: "added", date: "2001-03-03", precision: "day", title: "Moved to York", detail: "The whole family moved", personIds: [] },
];

describe("the timeline", () => {
  it("writes dates as exactly as they are known", () => {
    expect(dateText("1950-01-01", "year")).toBe("1950");
    expect(dateText("1990-09-01", "month")).toBe("September 1990");
    expect(dateText("2026-11-02", "day")).toBe("2 November 2026");
  });
  it("shows every kind unless some are ticked", () => {
    expect(parseKinds(undefined)).toHaveLength(5);
    expect(parseKinds(undefined, "")).toEqual([]);
    expect(parseKinds(["family", "nonsense"])).toEqual(["family"]);
    expect(parseKinds(undefined, "governance,added")).toEqual(["governance", "added"]);
  });
  it("filters by kind, person and words, and groups by year", () => {
    const all = arrange(items, { kinds: parseKinds(undefined) });
    expect(all.years.map(([y, l]) => [y, l.length])).toEqual([["1950", 1], ["1990", 2], ["2001", 1]]);
    expect(arrange(items, { kinds: ["family", "governance"], personId: "anna" }).count).toBe(2);
    expect(arrange(items, { kinds: parseKinds(undefined), words: "york" }).years[0][1][0].key).toBe("d");
    expect(arrange(items, { kinds: parseKinds(undefined), newestFirst: true }).years[0][0]).toBe("2001");
  });
});
