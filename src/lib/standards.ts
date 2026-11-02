import type { Standard } from "@/lib/entity-checklist";

// An Entity Standard as stored in the hub.
export type EntityStandard = Standard & {
  id: string;
  jurisdiction: string;
  entity_type: string;
  sub_type: string;
  name: string;
  status: "draft" | "approved" | "retired";
  version: number;
  effective_from: string | null;
  statute: string | null;
  bo_threshold_percent: number | null;
  bo_rule: "more_than" | "at_least" | "everyone";
  bo_change_deadline: string | null;
  registry_notice: string | null;
  agm: string | null;
  record_retention_years: number | null;
  review_months: number;
  officers_notes: string | null;
  registers: string | null;
  filings: string | null;
  event_deadlines: string | null;
  to_confirm: string | null;
  sources: { label: string; url: string }[];
  last_legal_check: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  based_on: string | null;
};

// The columns copied into a new draft from the closest standard.
export const REQUIREMENT_FIELDS = [
  "min_directors",
  "min_resident_directors",
  "secretary_required",
  "registered_office_required",
  "registered_agent_required",
  "nominated_officer_required",
  "management_company_required",
  "public_officer_required",
  "auditor_required",
  "accounting_officer_required",
  "min_trustees",
  "licensed_trustee_required",
  "min_council_members",
  "min_resident_council_members",
  "enforcer_required",
  "min_designated_members",
  "identity_verification_required",
  "share_capital",
  "authorised_capital",
  "director_removal",
  "bo_threshold_percent",
  "bo_rule",
  "bo_change_deadline",
  "registry_notice",
  "agm",
  "record_retention_years",
] as const;

export const STATUS_LABELS = { draft: "Draft – needs review", approved: "Approved", retired: "Retired" } as const;

export function boRuleText(s: Pick<EntityStandard, "bo_rule" | "bo_threshold_percent">) {
  if (s.bo_rule === "everyone") return "Every founder, trustee and beneficiary is a beneficial owner (no threshold).";
  if (s.bo_threshold_percent == null) return "Not set.";
  return `${s.bo_rule === "more_than" ? "More than" : "At least"} ${Number(s.bo_threshold_percent)}%.`;
}

export const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
