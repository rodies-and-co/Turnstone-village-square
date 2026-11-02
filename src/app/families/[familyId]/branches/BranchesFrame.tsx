import type { ReactNode } from "react";
import { AppShell, PageTitle } from "@/components/AppShell";
import { Toast } from "@/components/feedback";
import { UnderlineTabs } from "@/components/ui";
import type { FamilyContext } from "@/lib/family-context";
import { errorMessage, savedMessage } from "@/lib/messages";

export type BranchesTab = "branches" | "governance" | "advisors" | "values";

const TABS: [BranchesTab, string, string][] = [
  ["branches", "Branches", ""],
  ["governance", "Governance", "/governance"],
  ["advisors", "Advisors", "/advisors"],
  ["values", "Purpose & values", "/values"],
];

const SUBTITLES: Record<BranchesTab, string> = {
  branches:
    "Branches come from the wealth creators: each of their children may head a branch. Nothing changes until a Manager says yes.",
  governance:
    "How the family governs itself: its Family Assembly, Family Council and other bodies, and who sits on them.",
  advisors:
    "The circles of advisors: who advises the whole family, who advises each branch, and on what.",
  values:
    "The family's purpose, values, arrangements and guidance. Each is prepared, then adopted by a Manager who didn't prepare it.",
};

// The frame around the four Branches pages: side menu, breadcrumbs, title,
// tabs, and the message after a button is pressed.
export function BranchesFrame({
  ctx,
  familyId,
  tab,
  saved,
  error,
  children,
}: {
  ctx: FamilyContext;
  familyId: string;
  tab: BranchesTab;
  saved?: string;
  error?: string;
  children: ReactNode;
}) {
  const familyName = /family$/i.test(ctx.family.name.trim())
    ? ctx.family.name
    : `${ctx.family.name} family`;
  const tabName = TABS.find(([t]) => t === tab)![1];
  return (
    <AppShell
      family={{ id: familyId, name: ctx.family.name }}
      section="branches"
      crumbs={[
        ["My families", "/"],
        [familyName, `/families/${familyId}`],
        [
          "The Branches",
          tab === "branches" ? undefined : `/families/${familyId}/branches`,
        ],
        ...(tab === "branches" ? [] : ([[tabName]] as [string][])),
      ]}
      user={{
        name: ctx.displayName,
        roleLabel: ctx.roleLabel,
        hasTwoFactor: ctx.hasTwoFactor,
      }}
    >
      {error && (
        <Toast
          key={`e-${error}-${Date.now()}`}
          kind="error"
          message={errorMessage(error)!}
        />
      )}
      {saved && !error && (
        <Toast
          key={`s-${saved}-${Date.now()}`}
          message={savedMessage(saved)!}
        />
      )}
      <PageTitle
        eyebrow="Recording the facts"
        title="The Branches"
        subtitle={SUBTITLES[tab]}
      />
      <UnderlineTabs
        label="Branches sections"
        current={tab}
        items={TABS.map(([t, text, path]) => [
          t,
          text,
          `/families/${familyId}/branches${path}`,
        ])}
      />
      <div className="mt-6 space-y-5">
        {error && <p className="alert">Not saved: {errorMessage(error)}</p>}
        {!ctx.db && (
          <p className="alert">
            This family&apos;s database isn&apos;t connected yet.
          </p>
        )}
        {children}
      </div>
    </AppShell>
  );
}
