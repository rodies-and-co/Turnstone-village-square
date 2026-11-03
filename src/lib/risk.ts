// Risk management: scores, bands and wording. Pure helpers (no database), so
// pages and tests can share them.

export const LIKELIHOOD: Record<number, string> = {
  1: "Rare",
  2: "Unlikely",
  3: "Possible",
  4: "Likely",
  5: "Almost certain",
};
export const IMPACT: Record<number, string> = {
  1: "Insignificant",
  2: "Minor",
  3: "Moderate",
  4: "Major",
  5: "Severe",
};

// The four ways of handling a risk ("the four Ts").
export const RESPONSES = {
  treat: "Treat – reduce it",
  tolerate: "Tolerate – accept it",
  transfer: "Transfer – e.g. insure it",
  terminate: "Terminate – stop the activity",
} as const;
export type Response = keyof typeof RESPONSES;

export type Band = "low" | "medium" | "high" | "critical";
export const BANDS: Record<Band, string> = { low: "Low", medium: "Medium", high: "High", critical: "Critical" };
// Text colour on the band's background meets WCAG AA; the band is always written out too.
export const BAND_STYLE: Record<Band, string> = {
  low: "bg-[#e3eee0] text-[#1f3d1a]",
  medium: "bg-[#f6e7b8] text-[#4a3800]",
  high: "bg-[#f3c9a8] text-[#5a2400]",
  critical: "bg-[#8f2a1d] text-white",
};

export function score(likelihood: number, impact: number) {
  return likelihood * impact;
}

// 1–4 low, 5–9 medium, 10–16 high, 20–25 critical.
export function band(s: number): Band {
  if (s >= 20) return "critical";
  if (s >= 10) return "high";
  if (s >= 5) return "medium";
  return "low";
}

export type Rating = {
  inherent_likelihood: number;
  inherent_impact: number;
  residual_likelihood: number;
  residual_impact: number;
};

export function describe(r: Rating, which: "inherent" | "residual") {
  const l = which === "inherent" ? r.inherent_likelihood : r.residual_likelihood;
  const i = which === "inherent" ? r.inherent_impact : r.residual_impact;
  const s = score(l, i);
  return { likelihood: l, impact: i, score: s, band: band(s), text: `${BANDS[band(s)]} (${s}): ${LIKELIHOOD[l].toLowerCase()}, ${IMPACT[i].toLowerCase()}` };
}

// A 5 x 5 grid of counts: grid[impact - 1][likelihood - 1].
export function heatGrid(ratings: Rating[], which: "inherent" | "residual") {
  const grid = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => 0));
  for (const r of ratings) {
    const d = describe(r, which);
    grid[d.impact - 1][d.likelihood - 1] += 1;
  }
  return grid;
}

export function isScore(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5;
}

// The checks the database also makes, in plain words, before saving.
export function ratingProblem(r: Rating): string | null {
  if (![r.inherent_likelihood, r.inherent_impact, r.residual_likelihood, r.residual_impact].every(isScore))
    return "Please choose a likelihood and an impact, before and after controls.";
  if (score(r.residual_likelihood, r.residual_impact) > score(r.inherent_likelihood, r.inherent_impact))
    return "After controls the risk can't score higher than before them.";
  return null;
}
