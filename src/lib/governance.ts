// Governance, advisors, purpose and values: labels and form checks.

export const BODY_KINDS = {
  family_assembly: "Family Assembly",
  family_council: "Family Council",
  branch_council: "Branch council",
  board: "Board",
  committee: "Committee",
  other: "Other",
} as const;

// What each kind of body usually is, shown as guidance when adding one.
export const BODY_HINTS: Record<string, string> = {
  family_assembly: "Usually every adult family member. Meets once or twice a year.",
  family_council: "A smaller group chosen by the Assembly that acts for the family between meetings.",
  branch_council: "A branch's own forum. Often chooses the branch's representative on the Family Council.",
  board: "The board of a family company or office.",
  committee: "A group with one task, e.g. education, philanthropy or next generation.",
};

export const MEMBER_ROLES = {
  chair: "Chair",
  vice_chair: "Vice chair",
  secretary: "Secretary",
  member: "Member",
  branch_representative: "Branch representative",
  independent: "Independent member",
  observer: "Observer",
} as const;

export const PROFESSIONS = {
  lawyer: "Lawyer",
  accountant: "Accountant",
  tax_adviser: "Tax adviser",
  wealth_manager: "Wealth manager",
  fiduciary: "Trustee or fiduciary",
  banker: "Banker",
  family_business_adviser: "Family business adviser",
  facilitator: "Facilitator",
  insurance: "Insurance",
  other: "Other",
} as const;

export const STATEMENT_KINDS = {
  purpose: "Purpose",
  vision: "Vision",
  mission: "Mission",
  values: "Values",
  arrangement: "Arrangement",
  guidance: "Guidance",
} as const;

export const STATEMENT_HINTS: Record<string, string> = {
  purpose: "Why the family stays together and what its wealth is for.",
  vision: "Where the family wants to be in a generation's time.",
  mission: "What the family does to get there.",
  values: "What the family holds to, e.g. stewardship, fairness, education.",
  arrangement: "An agreed way of doing things, e.g. how family members join the business.",
  guidance: "Advice the family gives itself, e.g. on prenuptial agreements or employment.",
};

export function oneOf<T extends string>(value: string, options: Record<T, string>): value is T {
  return Object.prototype.hasOwnProperty.call(options, value);
}

export function isDate(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
}

export function formatDate(d: string | null | undefined) {
  if (!d) return null;
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function governanceError(message: string | undefined) {
  const m = message ?? "";
  if (/^Statement: /.test(m)) return m.replace(/^Statement: /, "");
  if (/governance_bodies_name/.test(m)) return "There is already a body with that name.";
  if (/body_members_current/.test(m)) return "That person already has a seat on this body.";
  if (/advisors_email_check|email/.test(m) && /check constraint/.test(m)) return "That email address doesn't look right.";
  if (/advisors_phone_check|phone/.test(m) && /check constraint/.test(m)) return "Please enter the phone number with digits only, e.g. +44 20 7946 0000.";
  if (/check constraint/.test(m)) return "Some of the details don't look right. Please check and try again.";
  if (/row-level security|permission denied/.test(m)) return "You don't have permission to do that.";
  return "Something went wrong. Please try again, and tell the Turnstone team if it keeps happening.";
}
