// The Organisation: ownership. Works out the register of members (with the
// current share certificates) from the approved share transactions, and the
// beneficial owners of an entity from its shareholders, settlors,
// beneficiaries and officers, looking through the family's own entities.
// Pure functions, no database access, so they can be tested on their own.

export type HolderKind = "person" | "organisation" | "entity";
export type Holder = { kind: HolderKind; id: string };

export const holderKey = (h: Holder) => `${h.kind}:${h.id}`;
export const sameHolder = (a: Holder | null, b: Holder | null) => Boolean(a && b && a.kind === b.kind && a.id === b.id);

// The holder named by a row with person / organisation / entity columns.
export function holderFrom(row: Record<string, unknown>, prefix: "to_" | "from_" | "" = ""): Holder | null {
  const entityColumn = prefix ? `${prefix}entity_id` : "holder_entity_id";
  if (row[`${prefix}person_id`]) return { kind: "person", id: String(row[`${prefix}person_id`]) };
  if (row[`${prefix}organisation_id`]) return { kind: "organisation", id: String(row[`${prefix}organisation_id`]) };
  if (row[entityColumn]) return { kind: "entity", id: String(row[entityColumn]) };
  return null;
}

// The form sends one choice, e.g. "person:<id>", "organisation:<id>" or
// "entity:<id>". Returns the database columns for it.
export function holderColumns(choice: string, prefix: "to_" | "from_" | "") {
  const [kind, id] = choice.split(":");
  if (!id || !["person", "organisation", "entity"].includes(kind)) return null;
  const entityColumn = prefix ? `${prefix}entity_id` : "holder_entity_id";
  return {
    [`${prefix}person_id`]: kind === "person" ? id : null,
    [`${prefix}organisation_id`]: kind === "organisation" ? id : null,
    [entityColumn]: kind === "entity" ? id : null,
  };
}

export const TRANSACTION_KINDS = {
  authorise: "Shares authorised",
  issue: "Shares issued",
  transfer: "Shares transferred",
} as const;
export type TransactionKind = keyof typeof TRANSACTION_KINDS;

export type ShareClass = { id: string; name: string; currency: string; par_value: number | string | null; limited: boolean; voting: boolean };

export type ShareTransaction = {
  id: string;
  class_id: string;
  kind: TransactionKind;
  transaction_date: string;
  shares: number | string;
  status: "draft" | "approved";
  approved_at: string | null;
  certificate_number: string | null;
  balance_certificate_number: string | null;
  to: Holder | null;
  from: Holder | null;
};

export type Holding = { holder: Holder; shares: number; certificates: { number: string; shares: number }[] };
export type ClassRegister = {
  shareClass: ShareClass;
  authorised: number;
  issued: number;
  holdings: Holding[];
};

// The register of members for each class, from the approved transactions in
// date order. A transfer cancels all of the transferor's certificates in the
// class: the transferee gets a new certificate, and the transferor gets a
// balance certificate for what they keep.
export function registerOfMembers(classes: ShareClass[], transactions: ShareTransaction[]): ClassRegister[] {
  const approved = transactions
    .filter((t) => t.status === "approved")
    .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date) || (a.approved_at ?? "").localeCompare(b.approved_at ?? ""));
  return classes.map((shareClass) => {
    let authorised = 0;
    let issued = 0;
    const holdings = new Map<string, Holding>();
    const holding = (h: Holder) => {
      const key = holderKey(h);
      if (!holdings.has(key)) holdings.set(key, { holder: h, shares: 0, certificates: [] });
      return holdings.get(key)!;
    };
    for (const t of approved.filter((x) => x.class_id === shareClass.id)) {
      const n = Number(t.shares);
      if (t.kind === "authorise") authorised += n;
      if (t.kind === "issue" && t.to) {
        issued += n;
        const h = holding(t.to);
        h.shares += n;
        if (t.certificate_number) h.certificates.push({ number: t.certificate_number, shares: n });
      }
      if (t.kind === "transfer" && t.to && t.from) {
        const from = holding(t.from);
        from.shares -= n;
        from.certificates = from.shares > 0 && t.balance_certificate_number ? [{ number: t.balance_certificate_number, shares: from.shares }] : [];
        const to = holding(t.to);
        to.shares += n;
        if (t.certificate_number) to.certificates.push({ number: t.certificate_number, shares: n });
      }
    }
    return {
      shareClass,
      authorised,
      issued,
      holdings: [...holdings.values()].filter((h) => h.shares > 0).sort((a, b) => b.shares - a.shares),
    };
  });
}

// Each holder's share of all the issued shares of an entity (all classes),
// and of the votes (the classes that carry votes, one vote per share).
export function ownershipShares(registers: ClassRegister[]): { holder: Holder; shares: number; percent: number; votingPercent: number }[] {
  const sum = (rs: ClassRegister[]) => rs.reduce((n, r) => n + r.holdings.reduce((m, h) => m + h.shares, 0), 0);
  const total = sum(registers);
  const voting = registers.filter((r) => r.shareClass.voting);
  const totalVotes = sum(voting);
  const by = new Map<string, { holder: Holder; shares: number; votes: number }>();
  for (const r of registers)
    for (const h of r.holdings) {
      const key = holderKey(h.holder);
      const x = by.get(key) ?? { holder: h.holder, shares: 0, votes: 0 };
      x.shares += h.shares;
      if (r.shareClass.voting) x.votes += h.shares;
      by.set(key, x);
    }
  return [...by.values()]
    .map((x) => ({ holder: x.holder, shares: x.shares, percent: total ? (x.shares / total) * 100 : 0, votingPercent: totalVotes ? (x.votes / totalVotes) * 100 : 0 }))
    .sort((a, b) => b.shares - a.shares);
}

// ---------------------------------------------------------------------------
// Beneficial owners

export type BoRule = { bo_rule: "more_than" | "at_least" | "everyone"; bo_threshold_percent: number | string | null };

// What the family records about each of its entities, for looking through.
export type EntityOwnership = {
  id: string;
  name: string;
  entity_type: string;
  // Companies and LLCs: each holder's percentage of the issued shares or of
  // the votes, whichever is higher.
  shareholders: { holder: Holder; percent: number }[];
  // Trusts, foundations and partnerships: everyone who counts as an owner by
  // their role (settlor, founder, trustee, protector, beneficiary, partner…).
  parties: { holder: Holder; role: string }[];
  // Directors and managers: reported when nobody meets the threshold.
  managers: { holder: Holder; role: string }[];
};

export type BeneficialOwner = {
  holder: Holder;
  percent: number | null; // null: an owner by role (trusts and foundations)
  reasons: string[];
  fallback?: boolean; // a senior managing official, reported because nobody else qualifies
  outside?: boolean; // an outside organisation: its own owners aren't recorded here
  unresolved?: boolean; // one of the family's entities whose own owners aren't recorded (or visible)
};

const SHARE_TYPES = ["company", "llc"];
export const DEFAULT_THRESHOLD = 25;
const pct = (n: number) => `${Math.round(n * 100) / 100}%`;

export function meetsRule(percent: number, rule: BoRule) {
  if (rule.bo_rule === "everyone") return percent > 0;
  const t = rule.bo_threshold_percent === null ? DEFAULT_THRESHOLD : Number(rule.bo_threshold_percent);
  return rule.bo_rule === "more_than" ? percent > t + 1e-9 : percent >= t - 1e-9;
}

export function ruleText(rule: BoRule) {
  if (rule.bo_rule === "everyone") return "everyone with an interest";
  const t = rule.bo_threshold_percent === null ? DEFAULT_THRESHOLD : Number(rule.bo_threshold_percent);
  return `${rule.bo_rule === "more_than" ? "more than" : "at least"} ${t}%${rule.bo_threshold_percent === null ? " (no threshold in the standard, so 25% is used)" : ""}`;
}

// The beneficial owners of one entity under its standard's rule.
//
// - Shareholdings are followed through the family's own companies (the
//   percentages multiply along the chain) and added up per person.
// - A family trust or foundation that holds shares, directly or through a
//   chain, makes all of its parties owners of the entity, when its holding
//   meets the rule.
// - An outside organisation that meets the rule is listed, marked as outside,
//   because its owners aren't recorded here.
// - For a trust or foundation itself, everyone with a role counts.
// - When nobody qualifies, the directors and managers are reported instead
//   (the "senior managing official" rule).
export function beneficialOwners(entityId: string, entities: EntityOwnership[], rule: BoRule): BeneficialOwner[] {
  const byId = new Map(entities.map((e) => [e.id, e]));
  const top = byId.get(entityId);
  if (!top) return [];
  // Nothing recorded yet: nothing to work out (not even the fallback).
  if (SHARE_TYPES.includes(top.entity_type) ? top.shareholders.length === 0 : top.parties.length === 0) return [];
  const owners = new Map<string, BeneficialOwner>();
  const add = (holder: Holder, percent: number | null, reason: string, extra: Partial<BeneficialOwner> = {}) => {
    const key = holderKey(holder);
    const o = owners.get(key) ?? { holder, percent: null, reasons: [], ...extra };
    if (percent !== null) o.percent = (o.percent ?? 0) + percent;
    if (!o.reasons.includes(reason)) o.reasons.push(reason);
    owners.set(key, o);
  };

  // Shareholdings through chains of companies: [holder, effective percent, path].
  const direct: { holder: Holder; percent: number; via: string[] }[] = [];
  const walk = (e: EntityOwnership, factor: number, via: string[], seen: Set<string>) => {
    for (const s of e.shareholders) {
      const p = (s.percent * factor) / 100;
      const owned = s.holder.kind === "entity" ? byId.get(s.holder.id) : undefined;
      if (owned && seen.has(owned.id)) continue; // a circular holding: already counted along this chain
      if (owned && SHARE_TYPES.includes(owned.entity_type) && owned.shareholders.length > 0 && !seen.has(owned.id)) {
        walk(owned, p, [...via, owned.name], new Set([...seen, owned.id]));
      } else {
        direct.push({ holder: s.holder, percent: p, via });
      }
    }
  };

  const partiesOf = (e: EntityOwnership, how: string) => {
    for (const p of e.parties) add(p.holder, null, `${p.role} of ${e.name}${how}`);
  };

  if (SHARE_TYPES.includes(top.entity_type)) {
    walk(top, 100, [], new Set([top.id]));
    // Add up per holder first, so two small holdings of one person can qualify together.
    const totals = new Map<string, { holder: Holder; percent: number; paths: string[] }>();
    for (const d of direct) {
      const key = holderKey(d.holder);
      const t = totals.get(key) ?? { holder: d.holder, percent: 0, paths: [] };
      t.percent += d.percent;
      t.paths.push(d.via.length ? `${pct(d.percent)} through ${d.via.join(" → ")}` : `${pct(d.percent)} directly`);
      totals.set(key, t);
    }
    for (const t of totals.values()) {
      if (!meetsRule(t.percent, rule)) continue;
      const reason = `Holds ${pct(t.percent)} of the shares or votes (${t.paths.join("; ")})`;
      if (t.holder.kind === "person") add(t.holder, t.percent, reason);
      else if (t.holder.kind === "organisation") add(t.holder, t.percent, reason, { outside: true });
      else {
        const owned = byId.get(t.holder.id);
        if (owned && !SHARE_TYPES.includes(owned.entity_type) && owned.parties.length > 0) partiesOf(owned, `, which holds ${pct(t.percent)}`);
        else add(t.holder, t.percent, reason, { unresolved: true });
      }
    }
  } else {
    partiesOf(top, "");
  }

  // Family entities met in a trust's parties aren't owners in their own right.
  const keep = (o: BeneficialOwner) => o.holder.kind !== "entity" || Boolean(o.unresolved);
  const result = [...owners.values()].filter(keep);
  if (result.some((o) => !o.outside && !o.unresolved)) return sortOwners(result);
  // No individual qualifies (or only holders that can't be looked through):
  // the senior managing officials are reported as well.
  for (const m of top.managers) add(m.holder, null, `${m.role}: reported because no individual meets the rule`, { fallback: true });
  return sortOwners([...owners.values()].filter(keep));
}

function sortOwners(list: BeneficialOwner[]) {
  return list.sort(
    (a, b) => Number(Boolean(a.fallback)) - Number(Boolean(b.fallback)) || (b.percent ?? -1) - (a.percent ?? -1) || a.holder.id.localeCompare(b.holder.id),
  );
}

// Roles that make someone an owner of a trust, foundation or partnership.
export const PARTY_ROLES: Record<string, string> = {
  trustee: "Trustee",
  protector: "Protector",
  enforcer: "Enforcer",
  council_member: "Council member",
  general_partner: "General partner",
  limited_partner: "Limited partner",
  designated_member: "Designated member",
  member: "Member",
};
export const MANAGER_ROLES: Record<string, string> = {
  director: "Director",
  manager: "Manager",
  council_member: "Council member",
  trustee: "Trustee",
  general_partner: "General partner",
};

export const INTERESTS = {
  discretionary: "Discretionary",
  fixed: "Fixed interest",
  default: "Default beneficiary",
  contingent: "Contingent",
  other: "Other",
} as const;

// "1,000" style numbers.
export const formatShares = (n: number | string) => Number(n).toLocaleString("en-GB");
export function formatMoney(n: number | string | null, currency: string | null) {
  if (n === null || n === undefined || n === "") return null;
  return `${currency ?? ""} ${Number(n).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 6 })}`.trim();
}
