// Suggested risks, worked out from what is already recorded. A person decides:
// each is accepted into the register or dismissed with a reason. Pure (no
// database), so it can be tested on its own.

export type Suggestion = {
  key: string;
  title: string;
  why: string;
  category: string;
  subcategory: string;
  entityId?: string;
  personId?: string;
  // A starting rating, before and after controls, for the person to change.
  rating: { inherent_likelihood: number; inherent_impact: number; residual_likelihood: number; residual_impact: number };
};

type Entity = { id: string; name: string; entity_type: string; status: string };
type Appointment = { entity_id: string; role: string; ceased_on: string | null };

// The roles that make up each kind of entity's board.
const BOARD: Record<string, string[]> = {
  company: ["director"],
  trust: ["trustee"],
  foundation: ["council_member"],
  llc: ["manager", "designated_member"],
  partnership: ["general_partner"],
};
const BOARD_WORD: Record<string, string> = {
  company: "director",
  trust: "trustee",
  foundation: "council member",
  llc: "manager",
  partnership: "general partner",
};

export function riskSuggestions(input: {
  entities: Entity[];
  appointments: Appointment[];
  // Entity id → how many filings are overdue.
  overdueFilings: Map<string, number>;
  // Adopted whole-family statements, by kind (purpose, values, …).
  adoptedStatements: string[];
  governanceBodies: string[]; // kinds
  expiredPassports: { id: string; personId: string; name: string; country: string }[];
  // Already in the register (from a suggestion) or dismissed.
  answered: Set<string>;
}): Suggestion[] {
  const out: Suggestion[] = [];
  const live = input.entities.filter((e) => e.status !== "dissolved");

  for (const e of live) {
    const n = input.overdueFilings.get(e.id) ?? 0;
    if (n > 0)
      out.push({
        key: `filings-overdue:${e.id}`,
        title: `Filings overdue at ${e.name}`,
        why: `${n} ${n === 1 ? "filing is" : "filings are"} overdue on the Compliance & filings tab. Late filings can bring penalties, or the entity being struck off.`,
        category: "legal",
        subcategory: "Regulatory filings",
        entityId: e.id,
        rating: { inherent_likelihood: 4, inherent_impact: 3, residual_likelihood: 3, residual_impact: 3 },
      });
    const roles = BOARD[e.entity_type];
    if (roles) {
      const board = input.appointments.filter((a) => a.entity_id === e.id && !a.ceased_on && roles.includes(a.role));
      if (board.length === 1)
        out.push({
          key: `one-board:${e.id}`,
          title: `${e.name} relies on one ${BOARD_WORD[e.entity_type]}`,
          why: `Only one ${BOARD_WORD[e.entity_type]} is recorded. If they can't act (illness, death, resignation), decisions may stop until someone else is appointed.`,
          category: "succession",
          subcategory: "Key person",
          entityId: e.id,
          rating: { inherent_likelihood: 3, inherent_impact: 4, residual_likelihood: 3, residual_impact: 4 },
        });
    }
  }

  if (!input.adoptedStatements.some((k) => k === "purpose" || k === "values"))
    out.push({
      key: "no-purpose-values",
      title: "The family has no adopted purpose or values",
      why: "No statement of the family's purpose or values has been adopted (Branches → Purpose & values). Shared purpose holds a family together through succession.",
      category: "philanthropy",
      subcategory: "Purpose and values",
      rating: { inherent_likelihood: 3, inherent_impact: 3, residual_likelihood: 3, residual_impact: 3 },
    });

  if (!input.governanceBodies.some((k) => k === "family_council" || k === "family_assembly"))
    out.push({
      key: "no-family-council",
      title: "No Family Council or Family Assembly",
      why: "No Family Council or Family Assembly is recorded (Branches → Governance). Without one, there is no agreed place for family decisions.",
      category: "governance",
      subcategory: "Decision-making",
      rating: { inherent_likelihood: 3, inherent_impact: 3, residual_likelihood: 3, residual_impact: 3 },
    });

  for (const p of input.expiredPassports)
    out.push({
      key: `passport-expired:${p.id}`,
      title: `${p.name}'s ${p.country} passport has expired`,
      why: "Without a current passport they may not be able to travel, open accounts or prove who they are when needed.",
      category: "protection",
      subcategory: "Physical and travel security",
      personId: p.personId,
      rating: { inherent_likelihood: 3, inherent_impact: 2, residual_likelihood: 2, residual_impact: 2 },
    });

  return out.filter((s) => !input.answered.has(s.key));
}
