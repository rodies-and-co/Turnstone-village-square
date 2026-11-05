// Circles of advisors: the ten domains of family wealth (UHNW Institute), as
// used in The Family Square, and how a relationship is working. Pure helpers.

export const DOMAINS = {
  financial: ["Financial management", "Budgeting, reporting, tax and the family's financial administration."],
  investment: ["Investment advisory", "Investment strategy, policy and the managers who carry it out."],
  estate_legal: ["Estate and legal", "Wills, trusts, structures and the legal side of passing on wealth."],
  philanthropy: ["Philanthropy and impact", "The family's giving, its foundation and the impact it seeks."],
  risk: ["Risk management", "Insurance, security, reputation and protection against loss."],
  governance: ["Governance and decision-making", "How the family and its entities decide, and who decides what."],
  leadership: ["Leadership and transition", "Succession in the business and the family, and preparing successors."],
  learning: ["Family learning and development", "Education and development of every generation."],
  dynamics: ["Family dynamics", "Relationships, communication and conflict within the family."],
  health: ["Health and well-being", "Physical and mental health, and the family's well-being."],
} as const satisfies Record<string, readonly [string, string]>;
export type Domain = keyof typeof DOMAINS;
export const DOMAIN_KEYS = Object.keys(DOMAINS) as Domain[];

export const RELATIONSHIPS = { strong: "Working well", working: "Working", weak: "Working weakly" } as const;
export type Relationship = keyof typeof RELATIONSHIPS;

// "Philanthropy and impact, family learning and development and health and well-being".
export function listWords(words: string[]) {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

export function isDomain(v: string): v is Domain {
  return Object.hasOwn(DOMAINS, v);
}
