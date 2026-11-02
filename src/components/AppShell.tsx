import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/actions";
import { MobileMenu } from "@/components/MobileMenu";

// The frame around every signed-in page, in The Family Square's layout: a
// side menu on the left (logo, the family, its sections, the person signed
// in) and the page on the right, with breadcrumbs at the top. On a phone the
// menu folds away behind a "Menu" button.

export type Crumb = [text: string, href?: string];

type Section = "family-overview" | "tree" | "branches" | "organisation" | "meetings" | "standards" | null;

// The plan's areas. Built ones are links (with their section and address
// within the family); the rest say "later".
type Item = string | [text: string, section: Section, path: string];
const LATER_GROUPS: [string, Item[]][] = [
  ["Things to do", [["Meetings & resolutions", "meetings", "/meetings"], "Projects", "Distributions", "Share transactions", "Risk management"]],
  ["Organising", ["To-do list", "Calendar", "Compliance calendar"]],
  ["Reports", ["Registers & charts", "Timeline", "Risk heat map"]],
  ["Village Square", ["Help", "Ask the Elder", "Circles of advisors"]],
  ["Investments", ["Portfolios & properties"]],
];

function NavLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-11 items-center rounded-md border-l-2 px-3 text-[15px] ${
        active ? "border-primary bg-card font-medium text-ink" : "border-transparent text-ink-2 hover:bg-muted hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

function Later({ children }: { children: ReactNode }) {
  return (
    <li className="flex min-h-9 items-center justify-between px-3 text-[15px] text-ink-3">
      <span>{children}</span>
      <span className="text-xs">later</span>
    </li>
  );
}

export function AppShell({
  family,
  section = null,
  crumbs,
  user,
  children,
}: {
  family?: { id: string; name: string };
  section?: Section;
  crumbs: Crumb[];
  user: { name?: string; roleLabel?: string | null; hasTwoFactor?: boolean };
  children: ReactNode;
}) {
  const familyName = family ? (/family$/i.test(family.name.trim()) ? family.name : `${family.name} family`) : null;

  const menu = (
    <div className="flex h-full flex-col gap-6">
      {family && (
        <div className="px-1">
          <p className="text-xs tracking-wider text-ink-3 uppercase">Family</p>
          <p className="text-[17px] font-semibold text-ink">{familyName}</p>
        </div>
      )}

      {family && (
        <nav aria-label="Family sections" className="space-y-5">
          <ul>
            <li>
              <NavLink href={`/families/${family.id}`} active={section === "family-overview"}>
                Overview
              </NavLink>
            </li>
          </ul>
          <div>
            <p className="mb-1 px-1 font-semibold text-ink">Recording the facts</p>
            <ul>
              <li>
                <NavLink href={`/families/${family.id}/tree`} active={section === "tree"}>
                  The Tree
                </NavLink>
              </li>
              <li>
                <NavLink href={`/families/${family.id}/branches`} active={section === "branches"}>
                  The Branches
                </NavLink>
              </li>
              <li>
                <NavLink href={`/families/${family.id}/organisation`} active={section === "organisation"}>
                  The Organisation
                </NavLink>
              </li>
              <Later>The Story</Later>
              <Later>The Vault</Later>
            </ul>
          </div>
          {/* The other areas fold away, so the menu stays short. Only one opens
              at a time: opening one closes the others (they share a name). The
              area of the page being shown starts open. */}
          <div className="space-y-1">
            {LATER_GROUPS.map(([group, items]) => (
              <details
                key={group}
                name="side-menu-areas"
                className="group"
                open={items.some((i) => Array.isArray(i) && i[1] === section) || undefined}
              >
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-md px-1 font-semibold text-ink-2 hover:bg-muted [&::-webkit-details-marker]:hidden">
                  {group}
                  <span aria-hidden="true" className="text-sm transition-transform group-open:rotate-90">
                    ›
                  </span>
                </summary>
                <ul className="pb-2">
                  {items.map((i) =>
                    Array.isArray(i) ? (
                      <li key={i[0]}>
                        <NavLink href={`/families/${family.id}${i[2]}`} active={section === i[1]}>
                          {i[0]}
                        </NavLink>
                      </li>
                    ) : (
                      <Later key={i}>{i}</Later>
                    ),
                  )}
                </ul>
              </details>
            ))}
          </div>
        </nav>
      )}

      <div className="mt-auto space-y-1 border-t border-border pt-4">
        <NavLink href="/" active={!family && section === null}>
          My families
        </NavLink>
        <NavLink href="/standards" active={section === "standards"}>
          Entity Standards
        </NavLink>
        {!user.hasTwoFactor && <NavLink href="/mfa" active={false}>Set up two-factor</NavLink>}
        {user.name && (
          <div className="px-3 pt-2">
            <p className="text-sm font-semibold text-ink">{user.name}</p>
            {user.roleLabel && <p className="text-sm text-ink-3">{user.roleLabel}</p>}
          </div>
        )}
        <form action={signOut}>
          <button type="submit" className="btn-quiet w-full justify-start px-3 text-[15px]">
            Sign out
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen md:grid md:grid-cols-[16rem_1fr] print:block">
      <aside className="border-b border-border bg-background print:hidden md:sticky md:top-0 md:flex md:h-screen md:flex-col md:overflow-y-auto md:border-r md:border-b-0">
        <div className="flex items-center justify-between gap-3 px-4 py-4 md:block md:px-4 md:pt-6">
          <Link href="/" className="block min-h-11">
            {/* The Turnstone logo: public/Turnstone-Logo.jpg */}
            {/* "multiply" lets the logo's white background take the page colour. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/Turnstone-Logo.jpg" alt="Turnstone" className="h-12 w-auto mix-blend-multiply md:h-[4.5rem]" />
            <span className="mt-2 block text-[19px] font-semibold tracking-tight text-ink">Village Square</span>
          </Link>
          <MobileMenu>{menu}</MobileMenu>
        </div>
        <div className="hidden grow px-4 pb-6 md:block">{menu}</div>
      </aside>

      <div className="min-w-0">
        <main className="mx-auto max-w-[70rem] px-4 py-6 sm:px-6 md:px-10 md:py-8">
          <nav aria-label="Breadcrumb" className="print:hidden">
            <ol className="flex flex-wrap items-center gap-x-2 text-sm text-ink-2">
              {crumbs.map(([text, href], i) => (
                <li key={i} className="flex items-center gap-2">
                  {i > 0 && <span aria-hidden="true">/</span>}
                  {href ? (
                    <Link href={href} className="inline-flex min-h-11 items-center hover:underline">
                      {text}
                    </Link>
                  ) : (
                    <span aria-current="page" className="font-medium text-ink">
                      {text}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
          <div className="mt-2">{children}</div>
        </main>
      </div>
    </div>
  );
}

// The page title block: a small orange label, the title, a line under it and
// buttons on the right.
export function PageTitle({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div data-page-title className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="mt-1 text-[28px] leading-tight font-semibold text-ink sm:text-[30px]">{title}</h1>
        {subtitle && <p className="mt-1 text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 print:hidden">{actions}</div>}
    </div>
  );
}
