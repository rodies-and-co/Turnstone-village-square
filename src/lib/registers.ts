import { APPOINTMENT_ROLES, type AppointmentRole } from "@/lib/entity-checklist";

// The statutory registers an entity has. Pure, so it can be tested on its own.
const SHARE_TYPES = ["company", "llc"];
const TRUST_TYPES = ["trust", "foundation"];

// Which registers an entity has: members and beneficial owners, then one per
// kind of officer it has had (in the usual order), plus settlors and
// beneficiaries for trusts and foundations.
export function registerList(entityType: string, roles: string[]): [string, string][] {
  const list: [string, string][] = [];
  if (SHARE_TYPES.includes(entityType)) list.push(["members", "Register of Members"]);
  if (TRUST_TYPES.includes(entityType)) {
    list.push(["settlors", entityType === "foundation" ? "Register of Founders" : "Register of Settlors"]);
    list.push(["beneficiaries", "Register of Beneficiaries"]);
  }
  list.push(["beneficial_owners", "Register of Beneficial Owners"]);
  for (const r of Object.keys(APPOINTMENT_ROLES) as AppointmentRole[]) {
    if (roles.includes(r)) list.push([r, `Register of ${PLURAL[r]}`]);
  }
  return list;
}

const PLURAL: Record<AppointmentRole, string> = {
  director: "Directors",
  alternate_director: "Alternate Directors",
  secretary: "Secretaries",
  nominated_officer: "Nominated Officers",
  registered_agent: "Registered Agents",
  management_company: "Management Companies",
  public_officer: "Public Officers",
  auditor: "Auditors",
  accounting_officer: "Accounting Officers",
  trustee: "Trustees",
  protector: "Protectors",
  enforcer: "Enforcers",
  council_member: "Council Members",
  designated_member: "Designated Members",
  member: "Members (LLP / LLC)",
  manager: "Managers",
  general_partner: "General Partners",
  limited_partner: "Limited Partners",
};

