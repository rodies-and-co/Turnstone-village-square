import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageTitle } from "@/components/AppShell";
import { SubmitButton, Toast } from "@/components/feedback";
import { Card, Field, Fold, Select } from "@/components/ui";
import { getFamilyContext } from "@/lib/family-context";
import { formatDate } from "@/lib/governance";
import { errorMessage, savedMessage } from "@/lib/messages";
import { londonDate } from "@/lib/organising";
import { LIVE_STAGES, STAGES, type Stage } from "@/lib/projects";
import { TextArea } from "../meetings/DecisionsArea";
import { loadTeam } from "../organising/organising-data";
import { loadLook } from "../risks/risk-data";
import { addProject } from "./actions";
import { loadProjects } from "./project-data";
import { ProgressBar, aboutOf } from "./ProjectParts";

export const dynamic = "force-dynamic";

// Projects (decision 2.1): what each is about, its stage and how far its
// goals have come.
export default async function ProjectsPage({
  params,
  searchParams,
}: {
  params: Promise<{ familyId: string }>;
  searchParams: Promise<{ show?: string; saved?: string; error?: string }>;
}) {
  const { familyId } = await params;
  const sp = await searchParams;
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db) notFound();
  const [projects, look, team] = await Promise.all([loadProjects(ctx), loadLook(ctx), loadTeam(ctx)]);
  const now = londonDate(new Date().toISOString())!;
  const me = ctx.user?.id ?? "";
  const familyName = /family$/i.test(ctx.family.name.trim()) ? ctx.family.name : `${ctx.family.name} family`;
  const showFinished = sp.show === "finished";
  const stages: Stage[] = showFinished ? ["completed", "stopped"] : LIVE_STAGES;
  const finishedCount = projects.filter((p) => !LIVE_STAGES.includes(p.stage)).length;
  const people = [...look.names.entries()].sort((a, b) => a[1].localeCompare(b[1]));

  return (
    <AppShell
      family={{ id: familyId, name: ctx.family.name }}
      section="projects"
      crumbs={[["My families", "/"], [familyName, `/families/${familyId}`], ["Projects"]]}
      user={{ name: ctx.displayName, roleLabel: ctx.roleLabel, hasTwoFactor: ctx.hasTwoFactor }}
    >
      {sp.error && <Toast key={`e-${sp.error}-${Date.now()}`} kind="error" message={errorMessage(sp.error)!} />}
      {sp.saved && !sp.error && <Toast key={`s-${sp.saved}-${Date.now()}`} message={savedMessage(sp.saved)!} />}
      <PageTitle title="Projects" subtitle="What each project is about, the stage it is at, and how far its goals have come. Each goal is broken into to-dos, which also show on the to-do list." />
      <div className="mt-6 space-y-5">
        {sp.error && <p className="alert">Not saved: {errorMessage(sp.error)}</p>}
        {ctx.canEdit && (
          <Card title="Start a project">
            <Fold label="Start a project">
              <form action={addProject.bind(null, familyId)} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Field label="Name of the project" name="title" required />
                  </div>
                  <div className="sm:col-span-2">
                    <TextArea label="What it is about" name="purpose" rows={3} />
                  </div>
                  <div className="sm:col-span-2">
                    <TextArea label="What it should achieve (the outcomes)" name="outcomes" rows={3} />
                  </div>
                  <Select
                    label="About"
                    name="about"
                    includeBlank="The whole family"
                    options={[
                      ...[...look.entities.entries()].map(([id, n]) => [`entity:${id}`, n] as [string, string]),
                      ...[...look.branches.entries()].map(([id, n]) => [`branch:${id}`, n] as [string, string]),
                    ]}
                    hint="Viewers who may see this see the project and its progress."
                  />
                  <Select label="Stage" name="stage" options={{ idea: STAGES.idea, planning: STAGES.planning, under_way: STAGES.under_way }} defaultValue="idea" />
                  <Select label="Project lead (from the Tree)" name="lead_person_id" options={people} includeBlank="Nobody yet" />
                  <Select label="Owner (with a login)" name="owner_id" options={[...team.entries()].map(([id, n]) => [id, id === me ? `${n} (me)` : n] as [string, string])} includeBlank="Nobody yet" defaultValue={me} />
                  <Field label="Start" name="starts_on" type="date" />
                  <Field label="Target date" name="target_on" type="date" />
                </div>
                <SubmitButton>Start the project</SubmitButton>
              </form>
            </Fold>
          </Card>
        )}

        <p className="flex flex-wrap gap-4">
          <Link href={`/families/${familyId}/projects`} aria-current={!showFinished ? "page" : undefined} className={`inline-flex min-h-11 items-center ${!showFinished ? "font-semibold text-ink" : "text-ink-2 underline"}`}>
            Current projects
          </Link>
          <Link href={`/families/${familyId}/projects?show=finished`} aria-current={showFinished ? "page" : undefined} className={`inline-flex min-h-11 items-center ${showFinished ? "font-semibold text-ink" : "text-ink-2 underline"}`}>
            Completed and stopped ({finishedCount})
          </Link>
        </p>

        {stages.map((stage) => {
          const list = projects.filter((p) => p.stage === stage);
          if (list.length === 0) return null;
          return (
            <Card key={stage} title={`${STAGES[stage]} (${list.length})`}>
              <ul className="divide-y divide-border border-y border-border">
                {list.map((p) => {
                  const achieved = p.goals.filter((g) => g.achieved_on).length;
                  const late = LIVE_STAGES.includes(p.stage) && p.target_on && p.target_on < now;
                  return (
                    <li key={p.id} className="grid gap-3 py-4 md:grid-cols-[1fr_16rem]">
                      <div className="min-w-0">
                        <Link href={`/families/${familyId}/projects/${p.id}`} className="inline-flex min-h-11 items-center text-[15px] font-medium text-ink hover:underline">
                          {p.title}
                        </Link>
                        <p className="text-sm text-ink-3">
                          {[
                            aboutOf(p, look),
                            p.lead_person_id && look.names.get(p.lead_person_id) ? `Led by ${look.names.get(p.lead_person_id)}` : null,
                            p.goals.length ? `${achieved} of ${p.goals.length} goal${p.goals.length === 1 ? "" : "s"} achieved` : "No goals yet",
                            p.finished_on ? `${STAGES[p.stage]} ${formatDate(p.finished_on)}` : p.target_on ? (late ? `Past its target of ${formatDate(p.target_on)}` : `Target ${formatDate(p.target_on)}`) : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        {p.purpose && <p className="mt-1 line-clamp-2 text-sm text-ink-2">{p.purpose}</p>}
                      </div>
                      <ProgressBar done={p.done} total={p.total} label={`Progress of ${p.title}`} />
                    </li>
                  );
                })}
              </ul>
            </Card>
          );
        })}
        {projects.filter((p) => stages.includes(p.stage)).length === 0 && (
          <p className="rounded-lg border border-border bg-card px-4 py-3 text-ink-2">{showFinished ? "No completed or stopped projects." : "No current projects."}</p>
        )}
      </div>
    </AppShell>
  );
}
