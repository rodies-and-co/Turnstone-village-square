// The Tree: labels, display names and form checks. Pure functions, no
// database access, so they can be tested on their own.

export const MEMBER_TYPES = {
  family: "Family member",
  family_not_succession: "Family, not part of succession",
  non_family: "Non-family",
} as const;
export type MemberType = keyof typeof MEMBER_TYPES;

// The three circle model: family, ownership and business.
export const THREE_CIRCLE_ROLES = {
  family_member: "Family member",
  outside_owner: "Outside owner",
  employee: "Employee",
  employee_owner: "Employee owner",
  family_employee: "Family employee",
  family_owner: "Family owner",
  family_leader: "Family leader",
} as const;
export type ThreeCircleRole = keyof typeof THREE_CIRCLE_ROLES;

export const SEX_OPTIONS = {
  unspecified: "Not recorded",
  female: "Female",
  male: "Male",
  other: "Other",
} as const;

// James Grubman's description of how a person came to the family's wealth.
export const RELATIONSHIP_TO_WEALTH = {
  immigrant: "Immigrant (created the wealth)",
  native: "Native (born into the wealth)",
  married_in: "Married in",
  mixed: "Mixed",
} as const;

export const ADDRESS_KINDS = { home: "Home", postal: "Postal", work: "Work", other: "Other" } as const;

export const PARENT_KINDS = { birth: "Birth", adopted: "Adopted", step: "Step", foster: "Foster" } as const;

// Shown under the heading "Spouse / Partner".
export const PARTNERSHIP_KINDS = {
  marriage: "Married (spouse)",
  civil_partnership: "Civil partnership",
  partner: "Partner (not married)",
} as const;

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export const PARTNERSHIP_END_REASONS = { divorce: "Divorce", separation: "Separation", death: "Death" } as const;

export type PersonSummary = {
  id: string;
  full_names: string;
  surname: string;
  known_as: string | null;
  birth_year: number | null;
};

// "Known as" plus surname, e.g. "Tom Hartley". Falls back to the first of the
// full names.
export function baseName(p: PersonSummary) {
  const first = p.known_as?.trim() || p.full_names.trim().split(/\s+/)[0];
  return `${first} ${p.surname.trim()}`;
}

// Display names for a list of people. When two people would show the same
// name, the year of birth is added to tell them apart, e.g. "Tom Hartley (1975)".
export function displayNames(people: PersonSummary[]) {
  const counts = new Map<string, number>();
  for (const p of people) {
    const key = baseName(p).toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const names = new Map<string, string>();
  for (const p of people) {
    const base = baseName(p);
    const repeated = (counts.get(base.toLowerCase()) ?? 0) > 1;
    names.set(p.id, repeated ? `${base} (${p.birth_year ?? "year not known"})` : base);
  }
  return names;
}

// Case-insensitive search across names.
export function matchesSearch(p: PersonSummary & { maiden_name?: string | null }, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [p.full_names, p.surname, p.known_as, p.maiden_name]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(q));
}

// Brothers and sisters, worked out from parents recorded on both sides.
// Birth and adoptive parents count as "real" parents for this; step and
// foster parents don't.
//   Sibling      - the same birth/adoptive parents on both sides
//   Half-sibling - at least one birth/adoptive parent shared, but not all
//   Step-sibling - connected only through a step or foster parent
export function siblingKinds(
  myParents: { parent_id: string; kind: string }[],
  theirLinks: { parent_id: string; child_id: string; kind: string }[],
): { id: string; label: "Sibling" | "Half-sibling" | "Step-sibling" }[] {
  const real = (k: string) => k === "birth" || k === "adopted";
  const mine = new Set(myParents.map((l) => l.parent_id));
  const myReal = new Set(myParents.filter((l) => real(l.kind)).map((l) => l.parent_id));
  const byChild = new Map<string, { parent_id: string; kind: string }[]>();
  for (const l of theirLinks) byChild.set(l.child_id, [...(byChild.get(l.child_id) ?? []), l]);

  const out: { id: string; label: "Sibling" | "Half-sibling" | "Step-sibling" }[] = [];
  for (const [id, links] of byChild) {
    if (!links.some((l) => mine.has(l.parent_id))) continue;
    const theirReal = new Set(links.filter((l) => real(l.kind)).map((l) => l.parent_id));
    const sharedReal = [...theirReal].filter((p) => myReal.has(p));
    if (sharedReal.length === 0) {
      out.push({ id, label: "Step-sibling" });
    } else {
      const same = theirReal.size === myReal.size && [...theirReal].every((p) => myReal.has(p));
      out.push({ id, label: same ? "Sibling" : "Half-sibling" });
    }
  }
  return out;
}

// Which generation each person belongs to, worked out from family links, as
// in The Family Square's register: 1 = the founders. Someone without parents
// in the Tree takes their spouse's or partner's generation, and otherwise
// counts as the first generation if they have children. Someone with no
// links at all gets null ("not linked yet").
export function generations(
  ids: string[],
  links: { parent_id: string; child_id: string }[],
  partnerships: { person_a: string; person_b: string }[],
): Map<string, number | null> {
  const known = new Set(ids);
  const parentsOf = new Map<string, string[]>();
  const hasChildren = new Set<string>();
  for (const l of links) {
    if (!known.has(l.parent_id) || !known.has(l.child_id)) continue;
    parentsOf.set(l.child_id, [...(parentsOf.get(l.child_id) ?? []), l.parent_id]);
    hasChildren.add(l.parent_id);
  }
  const partnersOf = new Map<string, string[]>();
  for (const p of partnerships) {
    if (!known.has(p.person_a) || !known.has(p.person_b)) continue;
    partnersOf.set(p.person_a, [...(partnersOf.get(p.person_a) ?? []), p.person_b]);
    partnersOf.set(p.person_b, [...(partnersOf.get(p.person_b) ?? []), p.person_a]);
  }

  const byBlood = new Map<string, number | null>();
  const blood = (id: string, seen: Set<string>): number | null => {
    if (byBlood.has(id)) return byBlood.get(id)!;
    if (seen.has(id)) return null;
    seen.add(id);
    const parents = parentsOf.get(id) ?? [];
    let g: number | null = null;
    if (parents.length) {
      const ups = parents.map((p) => blood(p, seen) ?? marriedIn(p) ?? 1);
      g = Math.max(...ups) + 1;
    }
    byBlood.set(id, g);
    return g;
  };
  const marriedIn = (id: string): number | null => {
    for (const partner of partnersOf.get(id) ?? []) {
      const g = blood(partner, new Set());
      if (g !== null) return g;
    }
    return null;
  };

  const out = new Map<string, number | null>();
  for (const id of ids) {
    const g = blood(id, new Set()) ?? marriedIn(id) ?? (hasChildren.has(id) || partnersOf.has(id) ? 1 : null);
    out.set(id, g);
  }
  return out;
}

const ORDINALS = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth"];
export function generationName(g: number | null) {
  if (g === null) return "Not linked to the family yet";
  return `${ORDINALS[g - 1] ?? `${g}th`} generation`;
}

// One line about a person's marriage or partnership, e.g. "Married to Lies".
// Current ones first; otherwise the most recent that ended.
export function partnershipLine(
  personId: string,
  partnerships: { person_a: string; person_b: string; kind: string; end_date: string | null; end_reason: string | null; start_date: string | null }[],
  nameOf: (id: string) => string,
): string | null {
  const mine = partnerships.filter((p) => p.person_a === personId || p.person_b === personId);
  if (!mine.length) return null;
  const current = mine.filter((p) => !p.end_date);
  const pick = current[0] ?? [...mine].sort((a, b) => (b.end_date ?? "").localeCompare(a.end_date ?? ""))[0];
  const other = nameOf(pick.person_a === personId ? pick.person_b : pick.person_a);
  if (!pick.end_date) {
    return pick.kind === "marriage" ? `Married to ${other}` : pick.kind === "civil_partnership" ? `Civil partner of ${other}` : `Partner of ${other}`;
  }
  const year = pick.end_date.slice(0, 4);
  if (pick.end_reason === "divorce") return `Divorced from ${other} (${year})`;
  if (pick.end_reason === "separation") return `Separated from ${other} (${year})`;
  if (pick.end_reason === "death") return `Widowed: was married to ${other}, who died in ${year}`;
  return `Was with ${other} until ${year}`;
}

// "Born 1949, aged 77" or "Born 1946, deceased".
export function lifeLine(p: { birth_year: number | null; deceased: boolean }, now = new Date()) {
  if (!p.birth_year) return p.deceased ? "Deceased" : "Year of birth not known";
  if (p.deceased) return `Born ${p.birth_year}, deceased`;
  const age = now.getFullYear() - p.birth_year;
  return `Born ${p.birth_year}, aged about ${age}`;
}

// ---------------------------------------------------------------------------
// Form checks. Each returns { ok: true, value } or { ok: false, error } with a
// message in plain English.
// ---------------------------------------------------------------------------

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function text(form: FormData, name: string) {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

function optional(form: FormData, name: string) {
  return text(form, name) || null;
}

function oneOf<T extends string>(value: string, options: Record<T, string>): value is T {
  return Object.prototype.hasOwnProperty.call(options, value);
}

function isDate(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
}

export function parsePersonForm(form: FormData): Result<{
  full_names: string;
  surname: string;
  maiden_name: string | null;
  known_as: string | null;
  member_type: MemberType;
  birth_year: number | null;
  date_of_birth: string | null;
  deceased: boolean;
  three_circle_role: ThreeCircleRole | null;
}> {
  const full_names = text(form, "full_names");
  const surname = text(form, "surname");
  if (!full_names) return { ok: false, error: "Please fill in the full names." };
  if (!surname) return { ok: false, error: "Please fill in the surname." };

  const memberType = text(form, "member_type");
  if (!oneOf(memberType, MEMBER_TYPES)) return { ok: false, error: "Please choose the type of member." };

  const birth = parseBirthDate(form);
  if (!birth.ok) return birth;

  const role = text(form, "three_circle_role");
  if (role && !oneOf(role, THREE_CIRCLE_ROLES)) return { ok: false, error: "Please choose a three circle role from the list." };

  return {
    ok: true,
    value: {
      full_names,
      surname,
      maiden_name: optional(form, "maiden_name"),
      known_as: optional(form, "known_as"),
      member_type: memberType,
      birth_year: birth.value.year,
      date_of_birth: birth.value.date,
      deceased: form.get("deceased") === "on",
      three_circle_role: role ? (role as ThreeCircleRole) : null,
    },
  };
}

// The date of birth is entered once, as day, month and year. The year on its
// own is enough when that is all that is known.
export function parseBirthDate(form: FormData): Result<{ year: number | null; date: string | null }> {
  const yearText = text(form, "birth_year");
  const dayText = text(form, "birth_day");
  const monthText = text(form, "birth_month");
  if (!yearText) {
    if (dayText || monthText) return { ok: false, error: "Please add the year of birth too." };
    return { ok: true, value: { year: null, date: null } };
  }
  if (!/^\d{4}$/.test(yearText)) return { ok: false, error: "The year of birth should be four digits, e.g. 1975." };
  const year = Number(yearText);
  if (year < 1850 || year > new Date().getFullYear()) return { ok: false, error: "The year of birth doesn't look right." };
  if (!dayText && !monthText) return { ok: true, value: { year, date: null } };
  if (!dayText || !monthText) {
    return { ok: false, error: "Please give both the day and the month of birth, or leave both empty if only the year is known." };
  }
  const day = Number(dayText);
  const month = Number(monthText);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (!Number.isInteger(day) || !Number.isInteger(month) || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return { ok: false, error: "That date of birth doesn't exist. Please check the day and month." };
  }
  if (d.getTime() > Date.now()) return { ok: false, error: "The date of birth can't be in the future." };
  return { ok: true, value: { year, date: d.toISOString().slice(0, 10) } };
}

export function parseDetailsForm(form: FormData): Result<{
  city_of_birth: string | null;
  country_of_birth: string | null;
  sex: keyof typeof SEX_OPTIONS;
  email: string | null;
  date_of_death: string | null;
  relationship_to_wealth: keyof typeof RELATIONSHIP_TO_WEALTH | null;
  psychometric_consent_date: string | null;
}> {
  for (const f of ["date_of_death", "psychometric_consent_date"]) {
    const v = text(form, f);
    if (v && !isDate(v)) return { ok: false, error: "Please enter dates as day, month and year." };
  }
  const dod = optional(form, "date_of_death");

  const email = optional(form, "email");
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "That email address doesn't look right." };

  const sex = text(form, "sex") || "unspecified";
  if (!oneOf(sex, SEX_OPTIONS)) return { ok: false, error: "Please choose from the list." };

  const wealth = text(form, "relationship_to_wealth");
  if (wealth && !oneOf(wealth, RELATIONSHIP_TO_WEALTH)) return { ok: false, error: "Please choose from the list." };

  return {
    ok: true,
    value: {
      city_of_birth: optional(form, "city_of_birth"),
      country_of_birth: optional(form, "country_of_birth"),
      sex,
      email,
      date_of_death: dod,
      relationship_to_wealth: wealth ? (wealth as keyof typeof RELATIONSHIP_TO_WEALTH) : null,
      psychometric_consent_date: optional(form, "psychometric_consent_date"),
    },
  };
}

export function parsePhone(form: FormData): Result<{ label: string; number: string }> {
  const number = text(form, "number");
  if (!/^\+?[0-9 ()-]{6,20}$/.test(number)) {
    return { ok: false, error: "Please enter the phone number with digits only, e.g. +44 7700 900123." };
  }
  return { ok: true, value: { label: text(form, "label") || "Mobile", number } };
}

export function parseAddress(form: FormData): Result<{
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postal_code: string | null;
  country: string;
}> {
  const line1 = text(form, "line1");
  const city = text(form, "city");
  const country = text(form, "country");
  if (!line1 || !city || !country) {
    return { ok: false, error: "Please fill in at least the first line, the town or city, and the country." };
  }
  return {
    ok: true,
    value: {
      line1,
      line2: optional(form, "line2"),
      city,
      region: optional(form, "region"),
      postal_code: optional(form, "postal_code"),
      country,
    },
  };
}

// The same key the database uses to spot a repeated address.
export function addressMatchKey(a: { line1: string; line2?: string | null; city: string; postal_code?: string | null; country: string }) {
  return (a.line1 + (a.line2 ?? "") + a.city + (a.postal_code ?? "") + a.country).replace(/[^a-zA-Z0-9]+/g, "").toLowerCase();
}

export function formatAddress(a: {
  line1: string;
  line2?: string | null;
  city: string;
  region?: string | null;
  postal_code?: string | null;
  country: string;
}) {
  return [a.line1, a.line2, a.city, a.region, a.postal_code, a.country].filter(Boolean).join(", ");
}

// Turns a database error into something the owner can act on.
export function friendlyError(message: string | undefined) {
  const m = message ?? "";
  if (/own ancestor/.test(m)) return "That link would make someone their own ancestor.";
  // The database's own sense checks on family links explain themselves.
  if (/^Family link: /.test(m)) return m.replace(/^Family link: /, "");
  if (/person_details_check/.test(m)) return "The date of death can't be before the date of birth.";
  if (/two birth parents/.test(m)) return "A person can have at most two birth parents.";
  if (/Only a Manager/.test(m)) return m;
  if (/duplicate key/.test(m)) return "That is already recorded.";
  if (/row-level security|permission denied/.test(m)) return "You don't have permission to do that.";
  if (/check constraint/.test(m)) return "Some of the details don't look right. Please check and try again.";
  return "Something went wrong. Please try again, and tell the Turnstone team if it keeps happening.";
}
