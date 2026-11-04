import { describe, expect, it } from "vitest";
import { goalState, percent, progressText } from "@/lib/projects";

describe("project progress", () => {
  it("counts to-dos done", () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(0, 0)).toBe(0);
    expect(progressText(3, 5)).toBe("3 of 5 to-dos done (60%)");
    expect(progressText(1, 1)).toBe("1 of 1 to-do done (100%)");
    expect(progressText(0, 0)).toBe("No to-dos yet");
  });
  it("says where each goal is", () => {
    expect(goalState({ achieved_on: null, done: 0, total: 2 })).toBe("Not started");
    expect(goalState({ achieved_on: null, done: 1, total: 2 })).toBe("Under way");
    expect(goalState({ achieved_on: "2026-11-01", done: 0, total: 0 })).toBe("Achieved");
  });
});
