import { describe, expect, it } from "vitest";
import { PROMPTS, cleanThemes, excerpt } from "@/lib/story";

describe("stories", () => {
  it("keeps only known themes, once each", () => {
    expect(cleanThemes(["origins", "nonsense", "origins", "hopes", "constructor"])).toEqual(["origins", "hopes"]);
  });
  it("shortens a long story for lists", () => {
    expect(excerpt("one two three", 2)).toBe("one two…");
    expect(excerpt("  one two  ", 5)).toBe("one two");
  });
  it("has prompts that are questions", () => {
    for (const p of PROMPTS) expect(p.endsWith("?")).toBe(true);
  });
});
