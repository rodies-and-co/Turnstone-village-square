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

export const PARTNERSHIP_KINDS = {
  marriage: "Marriage",
  civil_partnership: "Civil partnership",
  partner: "Partner",
} as const;

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
  deceased: boolean;
  three_circle_role: ThreeCircleRole | null;
}> {
  const full_names = text(form, "full_names");
  const surname = text(form, "surname");
  if (!full_names) return { ok: false, error: "Please fill in the full names." };
  if (!surname) return { ok: false, error: "Please fill in the surname." };

  const memberType = text(form, "member_type");
  if (!oneOf(memberType, MEMBER_TYPES)) return { ok: false, error: "Please choose the type of member." };

  const yearText = text(form, "birth_year");
  let birth_year: number | null = null;
  if (yearText) {
    if (!/^\d{4}$/.test(yearText)) return { ok: false, error: "The year of birth should be four digits, e.g. 1975." };
    birth_year = Number(yearText);
    if (birth_year < 1850 || birth_year > new Date().getFullYear()) {
      return { ok: false, error: "The year of birth doesn't look right." };
    }
  }

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
      birth_year,
      deceased: form.get("deceased") === "on",
      three_circle_role: role ? (role as ThreeCircleRole) : null,
    },
  };
}

export function parseDetailsForm(form: FormData): Result<{
  date_of_birth: string | null;
  city_of_birth: string | null;
  country_of_birth: string | null;
  sex: keyof typeof SEX_OPTIONS;
  email: string | null;
  date_of_death: string | null;
  relationship_to_wealth: keyof typeof RELATIONSHIP_TO_WEALTH | null;
  psychometric_consent_date: string | null;
}> {
  for (const f of ["date_of_birth", "date_of_death", "psychometric_consent_date"]) {
    const v = text(form, f);
    if (v && !isDate(v)) return { ok: false, error: "Please enter dates as day, month and year." };
  }
  const dob = optional(form, "date_of_birth");
  const dod = optional(form, "date_of_death");
  if (dob && dod && dod < dob) return { ok: false, error: "The date of death can't be before the date of birth." };

  const email = optional(form, "email");
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "That email address doesn't look right." };

  const sex = text(form, "sex") || "unspecified";
  if (!oneOf(sex, SEX_OPTIONS)) return { ok: false, error: "Please choose from the list." };

  const wealth = text(form, "relationship_to_wealth");
  if (wealth && !oneOf(wealth, RELATIONSHIP_TO_WEALTH)) return { ok: false, error: "Please choose from the list." };

  return {
    ok: true,
    value: {
      date_of_birth: dob,
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
  if (/two birth parents/.test(m)) return "A person can have at most two birth parents.";
  if (/Only a Manager/.test(m)) return m;
  if (/duplicate key/.test(m)) return "That is already recorded.";
  if (/row-level security|permission denied/.test(m)) return "You don't have permission to do that.";
  if (/check constraint/.test(m)) return "Some of the details don't look right. Please check and try again.";
  return "Something went wrong. Please try again, and tell the Turnstone team if it keeps happening.";
}
