// The Story: themes, audiences and prompts. Pure helpers (no database),
// shared by pages and tests.

export const THEMES = {
  origins: "Origins",
  work_and_wealth: "Work and wealth",
  values_and_faith: "Values and faith",
  family_life: "Family life",
  turning_points: "Turning points",
  giving: "Giving",
  places: "Places",
  traditions: "Traditions",
  lessons: "Lessons learnt",
  hopes: "Hopes",
} as const;
export type Theme = keyof typeof THEMES;

export const AUDIENCES = {
  family: "The whole family",
  branch: "One branch",
  people: "Only the people it is about (and the team)",
} as const;
export type Audience = keyof typeof AUDIENCES;

// Gentle questions to help someone tell their story.
export const PROMPTS = [
  "What is your earliest memory?",
  "Where did you grow up, and what was it like?",
  "What did your parents teach you about money?",
  "Who in the family do you most admire, and why?",
  "What was the hardest decision you have had to make?",
  "What family tradition matters most to you?",
  "What do you know about how the family business began?",
  "What would you like your grandchildren to know about you?",
  "What does the family's wealth mean to you?",
  "When did you feel most proud of the family?",
  "What do you hope the next generation will keep, and what should they change?",
  "Which place feels most like home, and why?",
] as const;

export function cleanThemes(values: string[]): Theme[] {
  return [...new Set(values.filter((v): v is Theme => Object.hasOwn(THEMES, v)))];
}

// A short opening of a story for lists.
export function excerpt(body: string, words = 30) {
  const all = body.trim().split(/\s+/);
  return all.length <= words ? body.trim() : `${all.slice(0, words).join(" ")}…`;
}
