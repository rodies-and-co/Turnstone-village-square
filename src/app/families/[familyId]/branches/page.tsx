import Link from "next/link";
import { AppShell, PageTitle } from "@/components/AppShell";
import { ConfirmRemove, SubmitButton, Toast } from "@/components/feedback";
import { Alert, Card, Fold, Notice, Row, Rows } from "@/components/ui";
import { branchNameFor, branchQuestions, type BAnswer, type BBranch, type BLink, type BPartnership, type BPerson } from "@/lib/branches";
import { getFamilyContext } from "@/lib/family-context";
import { errorMessage, savedMessage } from "@/lib/messages";
import { displayNames, lifeLine } from "@/lib/people";
import {
  addWealthCreator,
  askAgain,
  declineBranch,
  declineJoin,
  joinBranch,
  removeBranch,
  removeFromBranch,
  removeWealthCreator,
  renameBranch,
  startBranch,
} from "./actions";

export const dynamic = "force-dynamic";

type Person = BPerson & { maiden_name: string | null; deceased: boolean };

// The Branches. Branches come from the wealth creators: a Manager confirms
// who they are, then answers one question per child ("Does Sarah start a
// branch?") and per suggested member ("Add Emily to Tom Hartley Branch?").
export default async function BranchesPage({
  params,
  searchParams,
}: {
  params: Promise<{ familyId: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { familyId } = await params;
  const sp = await searchParams;
  const ctx = await getFamilyContext(familyId);
  const familyName = /family$/i.test(ctx.family.name.trim()) ? ctx.family.name : `${ctx.family.name} family`;

  let people: Person[] = [];
  let links: BLink[] = [];
  let partnerships: BPartnership[] = [];
  let branches: BBranch[] = [];
  let wealthCreators: string[] = [];
  let answers: (BAnswer & { id: string })[] = [];
  let createdWealth = new Set<string>();
  if (ctx.db) {
    const [p, l, m, b, w, a, d] = await Promise.all([
      ctx.db.from("people").select("id, member_type, branch_id, known_as, full_names, surname, maiden_name, birth_year, deceased").order("birth_year", { nullsFirst: false }),
      ctx.db.from("parent_child").select("parent_id, child_id, kind"),
      ctx.db.from("partnerships").select("person_a, person_b, end_date"),
      ctx.db.from("branches").select("id, name, head_person_id").order("name"),
      ctx.db.from("wealth_creators").select("person_id"),
      // Only Managers and Administrators get answers and personal details back.
      ctx.db.from("branch_answers").select("id, person_id, question, branch_id"),
      ctx.db.from("person_details").select("person_id, relationship_to_wealth"),
    ]);
    people = (p.data ?? []) as Person[];
    links = (l.data ?? []) as BLink[];
    partnerships = (m.data ?? []) as BPartnership[];
    branches = (b.data ?? []) as BBranch[];
    wealthCreators = ((w.data ?? []) as { person_id: string }[]).map((x) => x.person_id);
    answers = (a.data ?? []) as (BAnswer & { id: string })[];
    createdWealth = new Set(
      ((d.data ?? []) as { person_id: string; relationship_to_wealth: string | null }[])
        .filter((x) => x.relationship_to_wealth === "immigrant")
        .map((x) => x.person_id),
    );
  }

  const names = displayNames(people);
  const byId = new Map(people.map((p) => [p.id, p]));
  const name = (id: string) => names.get(id) ?? "Someone you can't see";
  const q = branchQuestions({ people, links, partnerships, branches, wealthCreators, answers });
  const creators = wealthCreators.filter((id) => byId.has(id));
  const parentsOf = (id: string) => links.filter((l) => l.child_id === id && creators.includes(l.parent_id)).map((l) => byId.get(l.parent_id));
  const personLink = (id: string) => (
    <Link href={`/families/${familyId}/tree/${id}`} className="hover:underline">
      {name(id)}
    </Link>
  );
  const questionCount = q.startQuestions.length + q.joinSuggestions.length;

  // Family members who could be wealth creators: suggested ones first.
  const candidates = people
    .filter((p) => p.member_type !== "non_family" && !creators.includes(p.id))
    .sort((a, b) => Number(createdWealth.has(b.id)) - Number(createdWealth.has(a.id)) || (a.birth_year ?? 9999) - (b.birth_year ?? 9999));

  const inNoBranch = people.filter(
    (p) =>
      p.member_type !== "non_family" &&
      !p.branch_id &&
      !creators.includes(p.id) &&
      !q.startQuestions.includes(p.id) &&
      !q.joinSuggestions.some((s) => s.personId === p.id),
  );

  return (
    <AppShell
      family={{ id: familyId, name: ctx.family.name }}
      section="branches"
      crumbs={[["My families", "/"], [familyName, `/families/${familyId}`], ["The Branches"]]}
      user={{ name: ctx.displayName, roleLabel: ctx.roleLabel, hasTwoFactor: ctx.hasTwoFactor }}
    >
      {sp.error && <Toast key={`e-${sp.error}-${Date.now()}`} kind="error" message={errorMessage(sp.error)!} />}
      {sp.saved && !sp.error && <Toast key={`s-${sp.saved}-${Date.now()}`} message={savedMessage(sp.saved)!} />}

      <PageTitle
        eyebrow="Recording the facts"
        title="The Branches"
        subtitle="Branches come from the wealth creators: each of their children may head a branch. Nothing changes until a Manager says yes."
      />

      <div className="space-y-5">
        {sp.error && <p className="alert">Not saved: {errorMessage(sp.error)}</p>}
        {!ctx.db && <Alert>This family&apos;s database isn&apos;t connected yet.</Alert>}

        {/* 1. Wealth creators */}
        <Card title="Wealth creators" description="The people who created the family's wealth. A Manager confirms them; they are never assumed.">
          {creators.length === 0 ? (
            <p className="border-y border-border py-3 text-ink-3">Not confirmed yet. The branch questions start once they are.</p>
          ) : (
            <Rows>
              {creators.map((id) => (
                <Row key={id} title={personLink(id)} meta={byId.get(id) ? lifeLine(byId.get(id)!) : undefined}>
                  {ctx.canManage && <ConfirmRemove action={removeWealthCreator.bind(null, familyId, id)} what={`${name(id)} as a wealth creator`} />}
                </Row>
              ))}
            </Rows>
          )}
          {ctx.canManage && candidates.length > 0 && (
            <Fold label={creators.length ? "Add another wealth creator" : "Who created the family's wealth?"} open={creators.length === 0}>
              <form action={addWealthCreator.bind(null, familyId)} className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
                <div>
                  <label htmlFor="person_id" className="mb-1 block text-sm font-medium text-ink">
                    Wealth creator
                  </label>
                  <select id="person_id" name="person_id" required defaultValue="" className="text-input">
                    <option value="">Choose…</option>
                    {candidates.map((p) => (
                      <option key={p.id} value={p.id}>
                        {name(p.id)}
                        {createdWealth.has(p.id) ? " (recorded as having created the wealth)" : ""}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-ink-3">
                    Someone born into the wealth may also be regarded as the wealth creator. Choose one at a time.
                  </p>
                </div>
                <SubmitButton pendingText="Confirming…">Confirm</SubmitButton>
              </form>
            </Fold>
          )}
        </Card>

        {/* 2. Questions waiting */}
        {ctx.canEdit && questionCount > 0 && (
          <Card
            title={`Questions waiting (${questionCount})`}
            description={ctx.canManage ? "Each answer is recorded. A “No” isn't asked again unless you choose to." : "A Manager answers these questions."}
          >
            <Rows>
              {q.startQuestions.map((id) => {
                const p = byId.get(id)!;
                const parents = parentsOf(id)
                  .filter(Boolean)
                  .map((x) => x!.known_as || x!.full_names.split(" ")[0]);
                return (
                  <Row
                    key={`s-${id}`}
                    title={<>Does {personLink(id)} start a branch?</>}
                    meta={`Child of ${parents.join(" and ")} · ${lifeLine(p)}${
                      p.branch_id ? ` · Now in ${branches.find((x) => x.id === p.branch_id)?.name ?? "another branch"}: “Yes” moves them to their own branch` : ""
                    }`}
                  >
                    {ctx.canManage && (
                      <>
                        <form action={startBranch.bind(null, familyId, id)}>
                          <SubmitButton pendingText="Creating…">
                            Yes, create “{branchNameFor(p)}”{p.branch_id ? " and move" : ""}
                          </SubmitButton>
                        </form>
                        <form action={declineBranch.bind(null, familyId, id)}>
                          <SubmitButton variant="secondary" pendingText="Saving…">
                            No
                          </SubmitButton>
                        </form>
                      </>
                    )}
                  </Row>
                );
              })}
              {q.joinSuggestions.map((s) => {
                const p = byId.get(s.personId)!;
                const branchName = (bid: string) => branches.find((b) => b.id === bid)?.name ?? "a branch";
                if (s.options.length === 1) {
                  const o = s.options[0];
                  return (
                    <Row
                      key={`j-${s.personId}`}
                      title={
                        <>
                          Add {personLink(s.personId)} to {branchName(o.branchId)}?
                        </>
                      }
                      meta={`${o.relation} · ${lifeLine(p)}`}
                    >
                      {ctx.canManage && (
                        <>
                          <form action={joinBranch.bind(null, familyId, s.personId, o.branchId)}>
                            <SubmitButton pendingText="Adding…">Yes, add</SubmitButton>
                          </form>
                          <form action={declineJoin.bind(null, familyId, s.personId, [o.branchId])}>
                            <SubmitButton variant="secondary">No</SubmitButton>
                          </form>
                        </>
                      )}
                    </Row>
                  );
                }
                return (
                  <Row
                    key={`j-${s.personId}`}
                    title={<>Which branch should {personLink(s.personId)} join?</>}
                    meta={`A person is in one branch. ${s.options.map((o) => `${o.relation} in ${branchName(o.branchId)}`).join("; ")}.`}
                  >
                    {ctx.canManage && (
                      <>
                        {s.options.map((o) => (
                          <form key={o.branchId} action={joinBranch.bind(null, familyId, s.personId, o.branchId)}>
                            <SubmitButton variant="secondary" pendingText="Adding…">
                              {branchName(o.branchId)}
                            </SubmitButton>
                          </form>
                        ))}
                        <form action={declineJoin.bind(null, familyId, s.personId, s.options.map((o) => o.branchId))}>
                          <SubmitButton variant="quiet">Neither</SubmitButton>
                        </form>
                      </>
                    )}
                  </Row>
                );
              })}
            </Rows>
          </Card>
        )}

        {/* 3. The branches */}
        {branches.length === 0 && (
          <Card title="No branches yet">
            <p className="text-ink-2">
              {creators.length ? "Answer the questions above to create the branches." : "Confirm the wealth creators first. The questions about branches follow."}
            </p>
          </Card>
        )}
        {branches.map((b) => {
          const members = people.filter((p) => p.branch_id === b.id).sort((x, y) => (x.id === b.head_person_id ? -1 : y.id === b.head_person_id ? 1 : 0));
          const head = b.head_person_id ? byId.get(b.head_person_id) : undefined;
          return (
            <Card key={b.id} title={b.name} description={head ? <>Headed by {personLink(head.id)}</> : "No head recorded"}>
              {q.branchesToCheck.includes(b.id) && (
                <div className="mb-4">
                  <Notice>
                    Please check: {head ? `${name(head.id)} isn't recorded as a child of a wealth creator` : "this branch has no head"}. Keep the branch if
                    it is right, or remove it below.
                  </Notice>
                </div>
              )}
              {members.length === 0 ? (
                <p className="border-y border-border py-3 text-ink-3">Nobody in this branch yet.</p>
              ) : (
                <Rows>
                  {members.map((p) => (
                    <Row key={p.id} title={personLink(p.id)} meta={[q.relationInBranch(b.id, p.id) ?? "Member", lifeLine(p)].join(" · ")}>
                      {ctx.canManage && p.id !== b.head_person_id && (
                        <ConfirmRemove action={removeFromBranch.bind(null, familyId, p.id, b.id)} what={`${name(p.id)} from ${b.name}`} label="Take out" />
                      )}
                    </Row>
                  ))}
                </Rows>
              )}
              {ctx.canManage && (
                <div className="mt-2 flex flex-wrap gap-x-6">
                  <Fold label="Rename the branch">
                    <form action={renameBranch.bind(null, familyId, b.id)} className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
                      <div>
                        <label htmlFor={`name-${b.id}`} className="mb-1 block text-sm font-medium text-ink">
                          Branch name
                        </label>
                        <input id={`name-${b.id}`} name="name" defaultValue={b.name} required className="text-input" />
                      </div>
                      <SubmitButton>Save name</SubmitButton>
                    </form>
                  </Fold>
                  <Fold label="Remove the branch" danger>
                    <p className="text-sm text-ink-2">
                      Its {members.length} {members.length === 1 ? "member stays" : "members stay"} in the Tree without a branch. Viewers whose access is
                      limited to this branch lose that access. The change is recorded in the history.
                    </p>
                    <form action={removeBranch.bind(null, familyId, b.id)} className="mt-3">
                      <SubmitButton pendingText="Removing…">Yes, remove {b.name}</SubmitButton>
                    </form>
                  </Fold>
                </div>
              )}
            </Card>
          );
        })}

        {/* 4. Family members not in a branch */}
        {inNoBranch.length > 0 && (
          <Card title="Not in a branch" description="Family members not suggested for any branch. A Manager can place someone under their Overview, in the Tree.">
            <Rows>
              {inNoBranch.map((p) => (
                <Row key={p.id} title={personLink(p.id)} meta={lifeLine(p)} />
              ))}
            </Rows>
          </Card>
        )}

        {/* 5. Answers given */}
        {ctx.canManage && answers.length > 0 && (
          <Card title="Questions answered “No”">
            <Fold label={`Show ${answers.length} ${answers.length === 1 ? "answer" : "answers"}`}>
              <Rows>
                {answers.map((a) => (
                  <Row
                    key={a.id}
                    title={
                      a.question === "starts_branch"
                        ? `${name(a.person_id)} doesn't start a branch`
                        : `${name(a.person_id)} doesn't join ${branches.find((b) => b.id === a.branch_id)?.name ?? "that branch"}`
                    }
                  >
                    <form action={askAgain.bind(null, familyId, a.id)}>
                      <SubmitButton variant="quiet" pendingText="Saving…">
                        Ask again
                      </SubmitButton>
                    </form>
                  </Row>
                ))}
              </Rows>
            </Fold>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
