import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageTitle } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { getFamilyContext } from "@/lib/family-context";

export const dynamic = "force-dynamic";

type Section = { id: string; title: string; href?: string; points: string[] };

// A short guide to each part of Village Square, in plain English. Each page's
// "Help with this page" link opens its section here.
const SECTIONS: Section[] = [
  {
    id: "start",
    title: "Getting started",
    points: [
      "Village Square keeps the family's records in one safe place, so succession works: who belongs to the family, what it owns, who decides, and what it stands for.",
      "What you can see and do depends on your role. Managers and Administrators keep the records; Managers also approve. Family members and advisors are Viewers: they can read what their access allows (the whole family, a branch, or their own record).",
      "Nothing is removed by one person alone. Whoever asks for a removal can't approve it; another Manager does, on the family Overview.",
      "Whoever prepares a record (a share transaction, a risk rating, the minutes) is never the one who approves it.",
      "Every button shows it is working, and a message confirms what happened.",
    ],
  },
  {
    id: "overview",
    title: "The family Overview",
    href: "",
    points: [
      "The family's front page: what needs attention, and any removals waiting for a second person's approval.",
    ],
  },
  {
    id: "tree",
    title: "The Tree",
    href: "/tree",
    points: [
      "Everyone connected to the family, grouped by generation: family members, those who are family but not part of succession, and non-family (such as advisors who hold office).",
      "Open a person to see their details, identity documents, addresses, family links and roles, Book of Life, to-dos, risks and history.",
      "Information is entered once: a date of birth on the Overview, each family link once (it shows on both people), brothers and sisters worked out from parents.",
      "Viewers see the year of birth only. Only a Manager places a person in a branch or links them to a login.",
    ],
  },
  {
    id: "branches",
    title: "The Branches",
    href: "/branches",
    points: [
      "Branches come from the wealth creators: each child of a wealth creator can head a branch. The system suggests and asks; nothing is created by itself.",
      "Governance records the Family Assembly, Family Council, branch councils and committees, with their members.",
      "Advisors are recorded once and placed in the family's circle or a branch's circle. Purpose & values holds the family's statements, adopted by a Manager who didn't prepare them.",
    ],
  },
  {
    id: "organisation",
    title: "The Organisation",
    href: "/organisation",
    points: [
      "Each of the family's companies, trusts, foundations, LLCs and partnerships, checked against its Entity Standard (the rules for that kind of entity in that jurisdiction).",
      "Tabs cover officers and appointments, ownership and control (shares, settlors, beneficiaries, beneficial owners), the statutory registers, compliance and filings, decisions and file notes, to-dos, risks and history.",
      "Share transactions and appointments follow a passed decision of the board or members. The register of members is worked out from approved transactions.",
    ],
  },
  {
    id: "story",
    title: "The Story",
    href: "/story",
    points: [
      "The family story, in chapters, and the stories of its people. Each story says who may read it: the whole family, one branch, or only the people it is about.",
      "Each person has a Book of Life in the Tree: their stories and life events together, with prompts to help them begin. Family members can send in their own stories; the team reads them first.",
    ],
  },
  {
    id: "meetings",
    title: "Meetings & resolutions",
    href: "/meetings",
    points: [
      "Board, members' and family governance meetings: planned, held, then confirmed by a Manager who didn't record them. Written resolutions are circulated and their signatures recorded.",
      "When an officer or shareholding changes, the decision is drafted for you; the change happens once the decision passes. Confirmed minutes and passed resolutions are kept for good.",
    ],
  },
  {
    id: "distributions",
    title: "Distributions & dividends",
    href: "/distributions",
    points: [
      "Distributions from trusts and foundations (from the income or capital pool) and dividends from companies: decided by a meeting or written resolution, then paid and recorded.",
    ],
  },
  {
    id: "projects",
    title: "Projects",
    href: "/projects",
    points: [
      "A project moves through stages (Idea, Planning, Under way, Completed) and is broken into goals, and each goal into to-dos. The progress bars show how far each has come.",
    ],
  },
  {
    id: "risks",
    title: "Risk management",
    href: "/risks",
    points: [
      "The family's one risk register. Each risk is rated for likelihood and impact (1 to 5), before and after controls; the rating counts once a Manager who didn't prepare it approves it.",
      "The heat map shows where the risks sit. Suggested risks are worked out from the records; you add them to the register or dismiss them with a reason.",
    ],
  },
  {
    id: "organising",
    title: "Organising: to-do list and calendars",
    href: "/organising",
    points: [
      "One to-do list for the family: what the records say needs doing (filings, meetings, approvals, payments, reviews, setup gaps) appears by itself and clears once done. Add your own to-dos too.",
      "The calendar shows meetings, filings, payments, reviews, project dates, family dates and passport expiry; each kind can be switched off. The compliance calendar lists every filing.",
    ],
  },
  {
    id: "reports",
    title: "Reports",
    href: "/reports",
    points: [
      "The family timeline, officers and offices (by person or by entity), each entity's registers, the structure chart, the risk heat map, and My records.",
      "Everything can be printed or saved as a PDF from your browser (File → Print).",
    ],
  },
  {
    id: "elder",
    title: "Ask the Elder",
    href: "/village/elder",
    points: [
      "Ask about the family's records, or for general guidance on governance and succession. The Elder uses Claude through Turnstone's own account; names are replaced with placeholders before anything is sent.",
      "Answers can be wrong: check them against the records, and ask an advisor before acting on anything legal, tax or financial.",
    ],
  },
  {
    id: "advisors",
    title: "Circles of advisors",
    href: "/village/advisors",
    points: ["Every advisor in one place: the family's circle, each branch's circle, what each advises on, and the firms that serve the family's entities."],
  },
];

export default async function HelpPage({ params }: { params: Promise<{ familyId: string }> }) {
  const { familyId } = await params;
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db) notFound();
  const familyName = /family$/i.test(ctx.family.name.trim()) ? ctx.family.name : `${ctx.family.name} family`;
  const f = `/families/${familyId}`;
  return (
    <AppShell
      family={{ id: familyId, name: ctx.family.name }}
      section="help"
      crumbs={[["My families", "/"], [familyName, f], ["Help"]]}
      user={{ name: ctx.displayName, roleLabel: ctx.roleLabel, hasTwoFactor: ctx.hasTwoFactor }}
    >
      <PageTitle title="Help" subtitle="A short guide to each part of Village Square." />
      <nav aria-label="Contents" className="mb-5">
        <ul className="flex flex-wrap gap-x-4">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="inline-flex min-h-11 items-center text-sm text-ink underline">
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="space-y-5">
        {SECTIONS.map((s) => (
          <section key={s.id} id={s.id} className="scroll-mt-6">
            <Card
              title={s.title}
              actions={
                s.href !== undefined ? (
                  <Link href={`${f}${s.href}`} className="btn-secondary">
                    Go there
                  </Link>
                ) : undefined
              }
            >
              <ul className="list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-ink-2">
                {s.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </Card>
          </section>
        ))}
      </div>
    </AppShell>
  );
}
