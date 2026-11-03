import { describe, expect, it } from "vitest";
import { band, describe as rate, heatGrid, ratingProblem, score } from "@/lib/risk";
import { riskSuggestions } from "@/lib/risk-suggestions";

describe("risk scores", () => {
  it("are likelihood × impact, in four bands", () => {
    expect(score(4, 5)).toBe(20);
    expect([1, 4, 5, 9, 10, 16, 20, 25].map(band)).toEqual(["low", "low", "medium", "medium", "high", "high", "critical", "critical"]);
    expect(rate({ inherent_likelihood: 4, inherent_impact: 5, residual_likelihood: 2, residual_impact: 3 }, "residual").text).toBe("Medium (6): unlikely, moderate");
  });

  it("can't be higher after controls, and need all four numbers", () => {
    expect(ratingProblem({ inherent_likelihood: 2, inherent_impact: 2, residual_likelihood: 3, residual_impact: 2 })).toMatch(/can't score higher/);
    expect(ratingProblem({ inherent_likelihood: 2, inherent_impact: 0, residual_likelihood: 1, residual_impact: 1 })).toMatch(/choose/);
    expect(ratingProblem({ inherent_likelihood: 5, inherent_impact: 5, residual_likelihood: 5, residual_impact: 5 })).toBeNull();
  });

  it("fill the heat map by impact and likelihood", () => {
    const g = heatGrid(
      [
        { inherent_likelihood: 5, inherent_impact: 5, residual_likelihood: 2, residual_impact: 4 },
        { inherent_likelihood: 5, inherent_impact: 5, residual_likelihood: 2, residual_impact: 4 },
      ],
      "residual",
    );
    expect(g[3][1]).toBe(2);
    expect(g.flat().reduce((a, b) => a + b, 0)).toBe(2);
  });
});

describe("suggested risks", () => {
  const base = {
    entities: [
      { id: "e1", name: "Holdings Ltd", entity_type: "company", status: "active" },
      { id: "e2", name: "Old Ltd", entity_type: "company", status: "dissolved" },
      { id: "t1", name: "Family Trust", entity_type: "trust", status: "active" },
    ],
    appointments: [
      { entity_id: "e1", role: "director", ceased_on: null },
      { entity_id: "e1", role: "secretary", ceased_on: null },
      { entity_id: "e2", role: "director", ceased_on: null },
      { entity_id: "t1", role: "trustee", ceased_on: null },
      { entity_id: "t1", role: "trustee", ceased_on: null },
      { entity_id: "t1", role: "trustee", ceased_on: "2020-01-01" },
    ],
    overdueFilings: new Map([["e1", 2]]),
    adoptedStatements: ["mission"],
    governanceBodies: ["board"],
    expiredPassports: [{ id: "p1", personId: "x", name: "Test Person", country: "Netherlands" }],
    answered: new Set<string>(),
  };

  it("come from overdue filings, a single director, missing purpose or council, and expired passports", () => {
    expect(riskSuggestions(base).map((s) => s.key)).toEqual(["filings-overdue:e1", "one-board:e1", "no-purpose-values", "no-family-council", "passport-expired:p1"]);
  });

  it("leave out what is already in the register or dismissed, and what is in place", () => {
    const keys = riskSuggestions({ ...base, adoptedStatements: ["values"], governanceBodies: ["family_council"], answered: new Set(["one-board:e1", "passport-expired:p1"]) }).map((s) => s.key);
    expect(keys).toEqual(["filings-overdue:e1"]);
  });

  it("start with a rating that controls don't make worse", () => {
    for (const s of riskSuggestions(base)) expect(ratingProblem(s.rating)).toBeNull();
  });
});
