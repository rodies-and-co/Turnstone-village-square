import { describe, expect, it } from "vitest";
import { branchNameFor, branchQuestions, type BPerson } from "@/lib/branches";

// The fictional Hartley practice family.
const P = (id: string, known_as: string, birth_year: number, branch_id: string | null = null, member_type = "family"): BPerson => ({
  id,
  known_as,
  full_names: known_as,
  surname: "Hartley",
  birth_year,
  branch_id,
  member_type,
});
const people = [
  P("george", "George", 1946),
  P("maggie", "Maggie", 1949),
  P("tom", "Tom", 1975, "bTom"),
  P("sarah", "Sarah", 1978),
  P("emily", "Emily", 2004),
  P("claire", "Claire", 1976),
  P("peter", "Peter", 1968, null, "non_family"),
];
const birth = (parent_id: string, child_id: string) => ({ parent_id, child_id, kind: "birth" });
const links = [birth("george", "tom"), birth("maggie", "tom"), birth("george", "sarah"), birth("maggie", "sarah"), birth("tom", "emily")];
const partnerships = [
  { person_a: "george", person_b: "maggie", end_date: null },
  { person_a: "claire", person_b: "tom", end_date: null },
];
const branches = [{ id: "bTom", name: "Tom Hartley Branch", head_person_id: "tom" }];

describe("branch questions", () => {
  it("asks nothing until the wealth creators are confirmed", () => {
    const q = branchQuestions({ people, links, partnerships, branches, wealthCreators: [], answers: [] });
    expect(q.startQuestions).toEqual([]);
    expect(q.branchesToCheck).toEqual([]);
  });

  it("asks whether each child of the wealth creators starts a branch, unless they already head one", () => {
    const q = branchQuestions({ people, links, partnerships, branches, wealthCreators: ["george", "maggie"], answers: [] });
    expect(q.startQuestions).toEqual(["sarah"]);
  });

  it("doesn't ask again after a Manager said no", () => {
    const q = branchQuestions({
      people,
      links,
      partnerships,
      branches,
      wealthCreators: ["george", "maggie"],
      answers: [{ person_id: "sarah", question: "starts_branch", branch_id: null }],
    });
    expect(q.startQuestions).toEqual([]);
  });

  it("suggests the head's partner and descendants for the branch, never the wealth creators or non-family", () => {
    const q = branchQuestions({ people, links, partnerships, branches, wealthCreators: ["george", "maggie"], answers: [] });
    expect(q.joinSuggestions).toEqual([
      { personId: "claire", options: [{ branchId: "bTom", relation: "Spouse / partner of the head" }] },
      { personId: "emily", options: [{ branchId: "bTom", relation: "Child" }] },
    ]);
    const declined = branchQuestions({
      people,
      links,
      partnerships,
      branches,
      wealthCreators: ["george"],
      answers: [{ person_id: "emily", question: "joins_branch", branch_id: "bTom" }],
    });
    expect(declined.joinSuggestions.map((s) => s.personId)).toEqual(["claire"]);
  });

  it("offers a choice when someone descends from two branches (e.g. cousins married)", () => {
    const more = [...people, P("sam", "Sam", 1979), P("kid", "Kid", 2010)];
    const q = branchQuestions({
      people: more,
      links: [...links, birth("tom", "kid"), birth("sam", "kid")],
      partnerships,
      branches: [...branches, { id: "bSam", name: "Sam Hartley Branch", head_person_id: "sam" }],
      wealthCreators: ["george"],
      answers: [],
    });
    expect(q.joinSuggestions.find((s) => s.personId === "kid")?.options.map((o) => o.branchId).sort()).toEqual(["bSam", "bTom"]);
    // Sam isn't a child of a wealth creator, so his branch is pointed out for checking.
    expect(q.branchesToCheck).toEqual(["bSam"]);
  });

  it("names a branch after its head", () => {
    expect(branchNameFor({ known_as: "Sarah", full_names: "Sarah Jane", surname: "Hartley" })).toBe("Sarah Hartley Branch");
    expect(branchNameFor({ known_as: null, full_names: "Pieter Johannes", surname: "Visser" })).toBe("Pieter Visser Branch");
  });
});
