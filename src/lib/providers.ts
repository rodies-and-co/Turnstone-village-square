// The kinds of service provider (outside organisations that serve the family's entities).
export const PROVIDER_KINDS: [string, string][] = [
  ["registered_agent", "Registered agent"],
  ["trust_company", "Trust company"],
  ["corporate_services", "Corporate services provider"],
  ["management_company", "Management company"],
  ["law_firm", "Law firm"],
  ["accounting_firm", "Accounting or audit firm"],
  ["bank", "Bank"],
  ["company", "Company"],
  ["other", "Other"],
];

// Corporate roles an Entity Standard can require from the start, and how to
// ask for them when a new entity is added.
export type RequiredAppointee = {
  flag: "registered_agent_required" | "management_company_required" | "licensed_trustee_required";
  role: "registered_agent" | "management_company" | "trustee";
  label: string;
  kind: string;
  licensed: boolean;
  allowEntity: boolean;
  hint: string;
};
export const REQUIRED_APPOINTEES: RequiredAppointee[] = [
  {
    flag: "registered_agent_required",
    role: "registered_agent",
    label: "Registered agent",
    kind: "registered_agent",
    licensed: true,
    allowEntity: false,
    hint: "Usually a licensed firm outside the family.",
  },
  {
    flag: "management_company_required",
    role: "management_company",
    label: "Management company",
    kind: "management_company",
    licensed: true,
    allowEntity: false,
    hint: "A licensed management company.",
  },
  {
    flag: "licensed_trustee_required",
    role: "trustee",
    label: "Licensed trustee",
    kind: "trust_company",
    licensed: true,
    allowEntity: true,
    hint: "A licensed trust company, or the family's own private trust company.",
  },
];
