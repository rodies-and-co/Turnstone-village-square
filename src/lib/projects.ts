// Projects: stages and progress. Pure helpers (no database), shared by pages
// and tests.

export const STAGES = {
  idea: "Idea",
  planning: "Planning",
  under_way: "Under way",
  completed: "Completed",
  stopped: "Stopped",
} as const;
export type Stage = keyof typeof STAGES;
export const LIVE_STAGES: Stage[] = ["idea", "planning", "under_way"];

export function percent(done: number, total: number) {
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

// A goal is achieved when it is marked so; otherwise under way once any of
// its to-dos is done.
export function goalState(g: { achieved_on: string | null; done: number; total: number }) {
  if (g.achieved_on) return "Achieved";
  if (g.done > 0) return "Under way";
  return "Not started";
}

// "3 of 5 to-dos done (60%)", or a plain word when there are none.
export function progressText(done: number, total: number) {
  if (total === 0) return "No to-dos yet";
  return `${done} of ${total} to-do${total === 1 ? "" : "s"} done (${percent(done, total)}%)`;
}
