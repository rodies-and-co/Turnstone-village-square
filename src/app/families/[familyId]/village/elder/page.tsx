import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageTitle } from "@/components/AppShell";
import { SubmitButton, Toast } from "@/components/feedback";
import { Card } from "@/components/ui";
import { getFamilyContext } from "@/lib/family-context";
import { errorMessage, savedMessage } from "@/lib/messages";
import { TextArea } from "../../meetings/DecisionsArea";
import { loadTeam } from "../../organising/organising-data";
import { cookies } from "next/headers";
import { Fold } from "@/components/ui";
import { askElder, cancelElder, previewElder } from "../actions";
import { whatWillBeSent } from "../elder-context";

export const dynamic = "force-dynamic";
// The Elder can take up to a minute to answer.
export const maxDuration = 90;

type Q = { id: string; asked_by: string; question: string; answer: string | null; failed: boolean; placeholders: number; created_at: string };

const EXAMPLES = [
  "Who are the directors of each of our companies?",
  "Which trusts is the next generation a beneficiary of?",
  "What does a protector of a trust do?",
  "How do other families prepare the next generation to take over?",
];

// Ask the Elder: questions about the family's records (only what the person
// may see) and general guidance on governance and succession.
export default async function ElderPage({ params, searchParams }: { params: Promise<{ familyId: string }>; searchParams: Promise<{ all?: string; check?: string; edit?: string; saved?: string; error?: string }> }) {
  const { familyId } = await params;
  const sp = await searchParams;
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db) notFound();
  const all = sp.all === "1" && ctx.canManage;
  let q = ctx.db.from("elder_questions").select("id, asked_by, question, answer, failed, placeholders, created_at").order("created_at", { ascending: false }).limit(50);
  if (!all) q = q.eq("asked_by", ctx.user?.id ?? "");
  const [{ data }, team] = await Promise.all([q, loadTeam(ctx)]);
  const asked = (data ?? []) as Q[];
  // Checking a question before it is sent.
  const kept = sp.check === "1" || sp.edit === "1" ? ((await cookies()).get("vs_elder_draft")?.value ?? "") : "";
  const draft = sp.check === "1" ? kept : "";
  const sending = draft ? await whatWillBeSent(ctx, draft) : null;
  const familyName = /family$/i.test(ctx.family.name.trim()) ? ctx.family.name : `${ctx.family.name} family`;
  const when = (ts: string) => new Date(ts).toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

  return (
    <AppShell
      family={{ id: familyId, name: ctx.family.name }}
      section="elder"
      crumbs={[["My families", "/"], [familyName, `/families/${familyId}`], ["Ask the Elder"]]}
      user={{ name: ctx.displayName, roleLabel: ctx.roleLabel, hasTwoFactor: ctx.hasTwoFactor }}
    >
      {sp.error && <Toast key={`e-${sp.error}-${Date.now()}`} kind="error" message={errorMessage(sp.error)!} />}
      {sp.saved && !sp.error && <Toast key={`s-${sp.saved}-${Date.now()}`} message={savedMessage(sp.saved)!} />}
      <PageTitle title="Ask the Elder" subtitle="Ask about the family's records, or for general guidance on family governance and succession." />
      <div className="space-y-5">
        <Card title="How your information is protected">
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
            <li>The Elder uses Claude, through Turnstone&apos;s own account. Claude doesn&apos;t learn from what it is sent.</li>
            <li>It is only told about the records you may already see. Names in the records, and the names it knows in your question, are replaced with placeholders (such as “Person 1”) before anything is sent, and put back in the answer here.</li>
            <li>Dates of birth, addresses, ID, tax and account numbers, and notes are never taken from the records. Numbers, dates, postcodes and email addresses typed into a question are removed.</li>
            <li>Before anything is sent, you see exactly what will go, and decide whether to send it.</li>
            <li>Your questions and answers are kept in the family&apos;s own records{ctx.canManage ? "; Managers can see everyone's, to check how the Elder is used" : ", where the family's Managers can see them"}.</li>
            <li>Answers can be wrong. Check them against the records, and ask an advisor before acting on anything legal, tax or financial.</li>
          </ul>
        </Card>
        {sending ? (
          <Card title="Check before sending" description="This is exactly what will be sent to Claude. If a name or detail you'd rather not send is still showing, change the question.">
            <p className="text-sm font-medium text-ink">Your question, as it will be sent</p>
            <p className="mt-1 whitespace-pre-wrap rounded-lg border border-border bg-white px-4 py-3 text-ink">{sending.masked}</p>
            <p className="mt-2 text-sm text-ink-3">The real names are put back into the answer here.</p>
            <Fold label="Show the records that will be sent with it">
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-white p-3 text-xs text-ink">{sending.records}</pre>
            </Fold>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <form action={askElder.bind(null, familyId)}>
                <SubmitButton pendingText="The Elder is thinking…">Send to the Elder</SubmitButton>
              </form>
              <form action={cancelElder.bind(null, familyId)}>
                <SubmitButton variant="secondary" pendingText="Clearing…">Change the question</SubmitButton>
              </form>
            </div>
          </Card>
        ) : (
          <Card title="Your question">
            <form action={previewElder.bind(null, familyId)} className="space-y-3">
              <TextArea id="elder-q" label="What would you like to ask?" name="question" rows={3} defaultValue={kept || undefined} />
              <SubmitButton pendingText="Preparing…">Check what will be sent</SubmitButton>
            </form>
            <p className="mt-3 text-sm text-ink-3">For example: {EXAMPLES.map((e) => `“${e}”`).join(" · ")}</p>
          </Card>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink">{all ? "Everyone's questions" : "Your questions"}</h2>
          {ctx.canManage && (
            <Link href={`/families/${familyId}/village/elder${all ? "" : "?all=1"}`} className="inline-flex min-h-11 items-center text-ink underline">
              {all ? "Show only mine" : "Show everyone's (Managers)"}
            </Link>
          )}
        </div>
        {asked.length === 0 && <p className="rounded-lg border border-border bg-card px-4 py-3 text-ink-2">No questions yet.</p>}
        {asked.map((x) => (
          <section key={x.id} id={`q-${x.id}`} className="scroll-mt-6 rounded-lg border border-border bg-card px-5 py-4">
            <p className="text-sm text-ink-3">
              {when(x.created_at)}
              {all ? ` · ${x.asked_by === ctx.user?.id ? "You" : (team.get(x.asked_by) ?? "A family member")}` : ""}
              {x.placeholders ? ` · ${x.placeholders} ${x.placeholders === 1 ? "name" : "names"} replaced before sending` : ""}
            </p>
            <p className="mt-1 font-medium text-ink">{x.question}</p>
            <div className={`mt-3 whitespace-pre-wrap border-l-4 pl-4 text-[15px] leading-relaxed ${x.failed ? "border-primary text-ink-2" : "border-[#2f5d50] text-ink"}`}>
              {x.answer ?? "No answer was recorded."}
            </div>
          </section>
        ))}
      </div>
    </AppShell>
  );
}
