import { APPOINTMENT_ROLES, type AppointmentRole } from "@/lib/entity-checklist";
import { holderKey, type Holder, type ShareClass, type ShareTransaction } from "@/lib/ownership";

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


// Every share certificate an entity has issued, from the approved
// transactions in date order: who it was issued to, for how many shares, and
// when it was cancelled (a transfer out cancels all of the transferor's
// certificates in that class; a balance certificate is issued for what they
// keep). Sorted by class, then certificate number.

export type Certificate = {
  classId: string;
  number: string;
  holder: Holder;
  shares: number;
  issuedOn: string;
  cancelledOn: string | null;
};

const certOrder = (a: string, b: string) => {
  const [x, y] = [Number(a), Number(b)];
  return Number.isFinite(x) && Number.isFinite(y) ? x - y : a.localeCompare(b, "en-GB", { numeric: true });
};

export function certificateHistory(classes: ShareClass[], transactions: ShareTransaction[]): Certificate[] {
  const approved = transactions
    .filter((t) => t.status === "approved" && t.kind !== "authorise")
    .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date) || (a.approved_at ?? "").localeCompare(b.approved_at ?? ""));
  const all: Certificate[] = [];
  for (const t of approved) {
    const n = Number(t.shares);
    if (t.kind === "transfer" && t.from) {
      const key = holderKey(t.from);
      const open = all.filter((c) => c.classId === t.class_id && !c.cancelledOn && holderKey(c.holder) === key);
      const held = open.reduce((s, c) => s + c.shares, 0);
      open.forEach((c) => (c.cancelledOn = t.transaction_date));
      if (t.balance_certificate_number && held - n > 0)
        all.push({ classId: t.class_id, number: t.balance_certificate_number, holder: t.from, shares: held - n, issuedOn: t.transaction_date, cancelledOn: null });
    }
    if (t.to && t.certificate_number) all.push({ classId: t.class_id, number: t.certificate_number, holder: t.to, shares: n, issuedOn: t.transaction_date, cancelledOn: null });
  }
  const classOrder = new Map(classes.map((c, i) => [c.id, i]));
  return all.sort((a, b) => (classOrder.get(a.classId) ?? 0) - (classOrder.get(b.classId) ?? 0) || certOrder(a.number, b.number));
}
