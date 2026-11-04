import "server-only";
import type { FamilyContext } from "@/lib/family-context";
import type { Stage } from "@/lib/projects";
import type { Todo } from "../organising/organising-data";

// Projects (decision 2.1): stages, goals and their to-dos. Viewers see the
// progress counts (from project_progress), not the to-dos themselves.

export type Goal = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  lead_person_id: string | null;
  target_on: string | null;
  achieved_on: string | null;
  sort: number;
  total: number;
  done: number;
};

export type Project = {
  id: string;
  title: string;
  purpose: string | null;
  outcomes: string | null;
  stage: Stage;
  entity_id: string | null;
  branch_id: string | null;
  lead_person_id: string | null;
  owner_id: string | null;
  starts_on: string | null;
  target_on: string | null;
  finished_on: string | null;
  finished_note: string | null;
  created_at: string;
  goals: Goal[];
  total: number;
  done: number;
};

export async function loadProjects(ctx: FamilyContext, projectId?: string) {
  let q = ctx.db!.from("projects").select("*, project_goals(*)").order("created_at");
  if (projectId) q = q.eq("id", projectId);
  const { data } = await q;
  const rows = (data ?? []) as (Omit<Project, "goals" | "total" | "done"> & { project_goals: Omit<Goal, "total" | "done">[] })[];
  return Promise.all(
    rows.map(async ({ project_goals, ...p }) => {
      const { data: counts } = await ctx.db!.rpc("project_progress", { p_project: p.id });
      const by = new Map(((counts ?? []) as { goal_id: string; total: number; done: number }[]).map((c) => [c.goal_id, c]));
      const goals = [...(project_goals ?? [])]
        .sort((a, b) => a.sort - b.sort || (a.target_on ?? "9999").localeCompare(b.target_on ?? "9999") || a.title.localeCompare(b.title))
        .map((g) => ({ ...g, total: by.get(g.id)?.total ?? 0, done: by.get(g.id)?.done ?? 0 }));
      return { ...p, goals, total: goals.reduce((n, g) => n + g.total, 0), done: goals.reduce((n, g) => n + g.done, 0) } as Project;
    }),
  );
}

// The to-dos of a project's goals (Managers and Administrators only).
export async function loadGoalTodos(ctx: FamilyContext, goalIds: string[]) {
  if (!ctx.canEdit || goalIds.length === 0) return [] as Todo[];
  const { data } = await ctx.db!.from("todos").select("*").in("project_goal_id", goalIds).order("due_on", { ascending: true, nullsFirst: false });
  return (data ?? []) as Todo[];
}
