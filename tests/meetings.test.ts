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

describe("drafted wording", () => {
  it("writes the decision for officer and share changes", async () => {
    const {
      appointWording,
      removalWording,
      resignationWording,
      shareWording,
      parseTarget,
    } = await import("@/lib/meetings");
    expect(
      appointWording({ name: "Pieter Visser", role: "Director" }).wording,
    ).toBe(
      "That Pieter Visser be appointed as director, with effect from the date of this decision, and that the register be updated.",
    );
    expect(
      removalWording({
        name: "Hans Visser",
        role: "Director",
        from: "2026-12-01",
      }).wording,
    ).toMatch(/removed as director with effect from 1 December 2026/);
    expect(
      resignationWording({
        name: "Hans Visser",
        role: "Director",
        on: "2026-11-01",
        inMeeting: true,
        board: "Board of directors",
      }).wording,
    ).toBe(
      "The board of directors noted the resignation of Hans Visser as director on 1 November 2026.",
    );
    expect(
      resignationWording({
        name: "Hans Visser",
        role: "Director",
        on: "2026-11-01",
        inMeeting: false,
        board: "Board of directors",
      }).wording,
    ).toBe(
      "That the resignation of Hans Visser as director on 1 November 2026 be noted.",
    );
    expect(
      shareWording({
        kind: "transfer",
        shares: 5000,
        className: "Ordinary",
        from: "A",
        to: "B",
      }).title,
    ).toBe("Transfer of 5,000 Ordinary shares");
    expect(parseTarget("new_resolution:board")).toEqual({
      kind: "new_resolution",
      body: "board",
    });
    expect(parseTarget("meeting:not-an-id")).toBeNull();
  });
});

describe("where a removal may be decided", () => {
  it("maps a meeting or resolution to the way it decides", async () => {
    const { wayOf } = await import("@/lib/meetings");
    expect(wayOf("meeting", "members")).toBe("members_meeting");
    expect(wayOf("resolution", "members")).toBe("members_written");
    expect(wayOf("resolution", "board")).toBe("board");
    expect(wayOf("meeting", "governance")).toBeNull();
  });
});
