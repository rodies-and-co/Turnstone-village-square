import { describe, expect, it } from "vitest";
import { bodyLabel, decisionRef, parseBasis, quorumText } from "@/lib/meetings";

const fmt = (d: string) => d.split("-").reverse().join("/");

describe("meetings: words and small rules", () => {
  it("names who decides", () => {
    expect(
      bodyLabel("board", {
        name: "Visser Holdings Limited",
        entity_type: "company",
      }),
    ).toBe("Board of directors of Visser Holdings Limited");
    expect(
      bodyLabel("board", {
        name: "Visser Foundation",
        entity_type: "foundation",
      }),
    ).toBe("Council of Visser Foundation");
    expect(bodyLabel("members", { name: "X LLC", entity_type: "llc" })).toBe(
      "Members of X LLC",
    );
    expect(
      bodyLabel("governance", null, { name: "Visser Family Council" }),
    ).toBe("Visser Family Council");
  });
  it("gives each decision its reference in the registers", () => {
    expect(
      decisionRef(
        { item: 2 },
        { kind: "meeting", number: 3, meeting_on: "2026-10-29" },
        fmt,
      ),
    ).toBe("Minute 3, item 2");
    expect(
      decisionRef(
        { item: 1 },
        { kind: "meeting", number: null, meeting_on: "2026-10-29" },
        fmt,
      ),
    ).toBe("Meeting of 29/10/2026, item 1");
    expect(
      decisionRef({ item: 1 }, { kind: "resolution", number: 4 }, fmt),
    ).toBe("Resolution 4, item 1");
  });
  it("reads 'Decided by'", () => {
    const id = "d0000000-0000-4000-8000-000000000001";
    expect(parseBasis(`decision:${id}`, "")).toEqual({
      basis: "decision",
      decision_id: id,
      basis_note: null,
    });
    expect(parseBasis("formation", "ignored")).toEqual({
      basis: "formation",
      decision_id: null,
      basis_note: null,
    });
    expect(parseBasis("instrument", "")).toHaveProperty("error");
    expect(parseBasis("instrument", " Deed, 1 March 2026 ")).toEqual({
      basis: "instrument",
      decision_id: null,
      basis_note: "Deed, 1 March 2026",
    });
    expect(parseBasis("earlier", "")).toHaveProperty("error");
    expect(parseBasis("decision:not-an-id", "")).toHaveProperty("error");
  });
  it("says whether the quorum is met", () => {
    expect(quorumText({ entitled: 3, present: 2, needed: 2 })).toMatch(
      /Quorum met/,
    );
    expect(quorumText({ entitled: 3, present: 1, needed: 2 })).toMatch(
      /not met/,
    );
    expect(quorumText({ entitled: 3, present: 1, needed: null })).toMatch(
      /No quorum is recorded/,
    );
  });
});
