import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageTitle } from "@/components/AppShell";
import { ConfirmRemove, SubmitButton, Toast } from "@/components/feedback";
import { Card, Chip, Facts, Field, Fold, Select } from "@/components/ui";
import { getFamilyContext } from "@/lib/family-context";
import { formatDate } from "@/lib/governance";
import { errorMessage, savedMessage } from "@/lib/messages";
import { londonDate } from "@/lib/organising";
import { LIVE_STAGES, STAGES, goalState } from "@/lib/projects";
import { TextArea } from "../../meetings/DecisionsArea";
import { loadTeam, type Item } from "../../organising/organising-data";
import { TodoList } from "../../organising/TodoList";
import { loadLook } from "../../risks/risk-data";
import { addGoal, removeGoal, removeProject, setGoalAchieved, setStage, updateGoal, updateProject } from "../actions";
import { loadGoalTodos, loadProjects, type Goal } from "../project-data";
import { ProgressBar, aboutOf } from "../ProjectParts";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ familyId: string; projectId: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { familyId, projectId } = await params;
  const sp = await searchParams;
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db) notFound();
  const [[project], look, team] = await Promise.all([loadProjects(ctx, projectId), loadLook(ctx), loadTeam(ctx)]);
  if (!project) notFound();
  const todos = await loadGoalTodos(ctx, project.goals.map((g) => g.id));
  const now = londonDate(new Date().toISOString())!;
  const me = ctx.user?.id ?? "";
  const here = `/families/${familyId}/projects/${projectId}`;
  const familyName = /family$/i.test(ctx.family.name.trim()) ? ctx.family.name : `${ctx.family.name} family`;
  const people = [...look.names.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const live = LIVE_STAGES.includes(project.stage);
  const achieved = project.goals.filter((g) => g.achieved_on).length;
  const personName = (id: string | null) => (id ? (look.names.get(id) ?? "Someone you can't see") : null);
  const entities = [...look.entities.entries()] as [string, string][];

  const goalFields = (g?: Goal, prefix = "new-goal") => (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field id={`${prefix}-title`} label="The goal" name="title" required defaultValue={g?.title} />
      </div>
      <div className="sm:col-span-2">
        <TextArea id={`${prefix}-description`} label="What it means, and how we'll know it is achieved" name="description" defaultValue={g?.description} rows={2} />
      </div>
      <Select id={`${prefix}-lead`} label="Lead (anyone in the Tree)" name="lead_person_id" options={people} includeBlank="Nobody yet" defaultValue={g?.lead_person_id} />
      <Field id={`${prefix}-target`} label="Target date" name="target_on" type="date" defaultValue={g?.target_on} />
    </div>
  );

  return (
    <AppShell
      family={{ id: familyId, name: ctx.family.name }}
      section="projects"
      crumbs={[["My families", "/"], [familyName, `/families/${familyId}`], ["Projects", `/families/${familyId}/projects`], [project.title]]}
      user={{ name: ctx.displayName, roleLabel: ctx.roleLabel, hasTwoFactor: ctx.hasTwoFactor }}
    >
      {sp.error && <Toast key={`e-${sp.error}-${Date.now()}`} kind="error" message={errorMessage(sp.error)!} />}
      {sp.saved && !sp.error && <Toast key={`s-${sp.saved}-${Date.now()}`} message={savedMessage(sp.saved)!} />}
      <PageTitle title={project.title} subtitle={`${aboutOf(project, look)} · ${STAGES[project.stage]}${project.finished_on ? ` ${formatDate(project.finished_on)}` : ""}`} />
      <div className="mt-6 space-y-5">
        {sp.error && <p className="alert">Not saved: {errorMessage(sp.error)}</p>}

        <Card title="Progress">
          {/* The stages, in order, with the current one marked in words. */}
          <ol className="mb-5 flex flex-wrap gap-2" aria-label="Stage">
            {(["idea", "planning", "under_way", "completed"] as const).map((s, i, all) => {
              const at = all.indexOf(project.stage as (typeof all)[number]);
              const current = project.stage === s;
              const past = at > i;
              return (
                <li
                  key={s}
                  aria-current={current ? "step" : undefined}
                  className={`rounded-full border px-3 py-1 text-sm ${current ? "border-ink bg-ink font-semibold text-white" : past ? "border-[#2f5d50] text-ink" : "border-border text-ink-3"}`}
                >
                  {past ? "✓ " : ""}
                  {STAGES[s]}
                  {current ? " (now)" : ""}
                </li>
              );
            })}
            {project.stage === "stopped" && <li className="rounded-full border border-ink bg-ink px-3 py-1 text-sm font-semibold text-white">Stopped</li>}
          </ol>
          <ProgressBar done={project.done} total={project.total} label="Progress of the whole project" size="lg" />
          <p className="mt-1 text-sm text-ink-2">
            {achieved} of {project.goals.length} goal{project.goals.length === 1 ? "" : "s"} achieved
            {project.target_on ? ` · Target ${formatDate(project.target_on)}${live && project.target_on < now ? " (passed)" : ""}` : ""}
          </p>
          {project.finished_note && <p className="mt-2 text-sm text-ink">{project.finished_note}</p>}
          {ctx.canEdit && (
            <Fold label="Move to another stage">
              <form action={setStage.bind(null, familyId, project.id)} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Select label="Stage" name="stage" options={STAGES} defaultValue={project.stage} />
                  <Field label="Date (when completed or stopped)" name="finished_on" type="date" defaultValue={project.finished_on ?? now} />
                </div>
                <TextArea label="Note (when completed or stopped)" name="finished_note" rows={2} defaultValue={project.finished_note} />
                <SubmitButton>Save the stage</SubmitButton>
              </form>
            </Fold>
          )}
        </Card>

        <Card title="About the project">
          <Facts
            items={[
              ["What it is about", project.purpose],
              ["What it should achieve", project.outcomes],
              ["Project lead", personName(project.lead_person_id) ?? "Nobody yet"],
              ...(ctx.canEdit ? ([["Owner", project.owner_id ? (team.get(project.owner_id) ?? "A former team member") : "Nobody yet"]] as [string, string][]) : []),
              ["Start", formatDate(project.starts_on) || null],
              ["Target date", formatDate(project.target_on) || null],
            ]}
          />
          {ctx.canEdit && (
            <div className="mt-4 flex flex-wrap items-start gap-4">
              <Fold label="Change the details">
                <form action={updateProject.bind(null, familyId, project.id)} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <Field label="Name of the project" name="title" required defaultValue={project.title} />
                    </div>
                    <div className="sm:col-span-2">
                      <TextArea label="What it is about" name="purpose" rows={3} defaultValue={project.purpose} />
                    </div>
                    <div className="sm:col-span-2">
                      <TextArea label="What it should achieve (the outcomes)" name="outcomes" rows={3} defaultValue={project.outcomes} />
                    </div>
                    {ctx.canManage ? (
                      <Select
                        label="About"
                        name="about"
                        includeBlank="The whole family"
                        options={[
                          ...entities.map(([id, n]) => [`entity:${id}`, n] as [string, string]),
                          ...[...look.branches.entries()].map(([id, n]) => [`branch:${id}`, n] as [string, string]),
                        ]}
                        defaultValue={project.entity_id ? `entity:${project.entity_id}` : project.branch_id ? `branch:${project.branch_id}` : ""}
                        hint="Changes who sees the project, so only a Manager can change it."
                      />
                    ) : (
                      <div>
                        <p className="mb-1 text-sm font-medium text-ink">About</p>
                        <p className="text-ink">{aboutOf(project, look)}</p>
                        <p className="mt-1 text-xs text-ink-3">Only a Manager can change this, because it changes who sees the project.</p>
                      </div>
                    )}
                    <Select label="Project lead (from the Tree)" name="lead_person_id" options={people} includeBlank="Nobody yet" defaultValue={project.lead_person_id} />
                    <Select
                      label="Owner (with a login)"
                      name="owner_id"
                      options={[
                        ...[...team.entries()].map(([id, n]) => [id, id === me ? `${n} (me)` : n] as [string, string]),
                        ...(project.owner_id && !team.has(project.owner_id) ? ([[project.owner_id, "A former team member (choose someone new)"]] as [string, string][]) : []),
                      ]}
                      includeBlank="Nobody yet"
                      defaultValue={project.owner_id}
                    />
                    <Field label="Start" name="starts_on" type="date" defaultValue={project.starts_on} />
                    <Field label="Target date" name="target_on" type="date" defaultValue={project.target_on} />
                  </div>
                  <SubmitButton>Save</SubmitButton>
                </form>
              </Fold>
              <ConfirmRemove action={removeProject.bind(null, familyId, project.id)} what={`the project "${project.title}", with its goals and their to-dos`} />
            </div>
          )}
        </Card>

        <h2 className="pt-2 text-lg font-semibold text-ink">Goals ({project.goals.length})</h2>
        {project.goals.length === 0 && <p className="rounded-lg border border-border bg-card px-4 py-3 text-ink-2">No goals yet. Break the project into goals, then each goal into to-dos.</p>}
        {project.goals.map((g, i) => {
          const state = goalState(g);
          const late = !g.achieved_on && g.target_on && g.target_on < now;
          const items: Item[] = todos
            .filter((t) => t.project_goal_id === g.id)
            .map((t) => ({ key: `todo:${t.id}`, group: "projects", title: t.title, detail: t.details, due: t.due_on, href: `${here}#goal-${g.id}`, entityId: t.entity_id, personIds: t.person_id ? [t.person_id] : [], todo: t }));
          return (
            <section key={g.id} id={`goal-${g.id}`} className="scroll-mt-6">
              <Card
                title={`Goal ${i + 1}: ${g.title}`}
                actions={<span className="flex flex-wrap gap-2">{late ? <Chip>Past its target</Chip> : null}<Chip>{state}</Chip></span>}
              >
                <p className="mb-3 text-sm text-ink-3">
                  {[
                    personName(g.lead_person_id) ? `Led by ${personName(g.lead_person_id)}` : "No lead yet",
                    g.target_on ? `Target ${formatDate(g.target_on)}` : null,
                    g.achieved_on ? `Achieved ${formatDate(g.achieved_on)}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {g.description && <p className="mb-3 whitespace-pre-wrap text-sm text-ink-2">{g.description}</p>}
                <ProgressBar done={g.done} total={g.total} label={`Progress of the goal ${g.title}`} />
                {ctx.canEdit && (
                  <div className="mt-4 space-y-4">
                    <TodoList
                      familyId={familyId}
                      items={items}
                      team={team}
                      names={look.names}
                      entities={entities}
                      here={`${here}#goal-${g.id}`}
                      now={now}
                      me={me}
                      canEdit={ctx.canEdit}
                      fixed={{ goalId: g.id, ...(project.entity_id ? { entityId: project.entity_id } : {}) }}
                      title="To-dos for this goal"
                      compact
                    />
                    <div className="flex flex-wrap items-start gap-4">
                      {g.achieved_on ? (
                        <form action={setGoalAchieved.bind(null, familyId, project.id, g.id, false)}>
                          <SubmitButton variant="quiet" pendingText="Saving…">
                            Not achieved after all
                          </SubmitButton>
                        </form>
                      ) : (
                        <Fold label="Mark as achieved">
                          <form action={setGoalAchieved.bind(null, familyId, project.id, g.id, true)} className="space-y-4">
                            <Field id={`ach-${g.id}`} label="Achieved on" name="achieved_on" type="date" defaultValue={now} />
                            <SubmitButton variant="secondary">Mark as achieved</SubmitButton>
                          </form>
                        </Fold>
                      )}
                      <Fold label="Change the goal">
                        <form action={updateGoal.bind(null, familyId, project.id, g.id)} className="space-y-4">
                          {goalFields(g, `goal-${g.id}`)}
                          <SubmitButton>Save</SubmitButton>
                        </form>
                      </Fold>
                      <ConfirmRemove action={removeGoal.bind(null, familyId, project.id, g.id)} what={`the goal "${g.title}" and its to-dos`} />
                    </div>
                  </div>
                )}
              </Card>
            </section>
          );
        })}

        {ctx.canEdit && (
          <Card title="Add a goal">
            <Fold label="Add a goal" open={project.goals.length === 0}>
              <form action={addGoal.bind(null, familyId, project.id)} className="space-y-4">
                {goalFields()}
                <SubmitButton>Add the goal</SubmitButton>
              </form>
            </Fold>
          </Card>
        )}

        <p>
          <Link href={`/families/${familyId}/projects`} className="inline-flex min-h-11 items-center text-ink underline">
            Back to the projects
          </Link>
        </p>
      </div>
    </AppShell>
  );
}
