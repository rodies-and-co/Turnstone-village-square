import { describe, expect, it } from "vitest";
import { closestStandard, matchStandard, setupChecklist, type Standard } from "@/lib/entity-checklist";

const none: Standard = {
  min_directors: 0,
  min_resident_directors: 0,
  secretary_required: false,
  registered_office_required: true,
  registered_agent_required: false,
  nominated_officer_required: false,
  management_company_required: false,
  public_officer_required: false,
  auditor_required: false,
  accounting_officer_required: false,
  min_trustees: 0,
  licensed_trustee_required: false,
  min_council_members: 0,
  min_resident_council_members: 0,
  enforcer_required: false,
  min_designated_members: 0,
  identity_verification_required: false,
  share_capital: "none",
};
const company = { entity_type: "company" as const, registration_number: "12345", registered_address_id: "a1", base_currency: "GBP", year_end_month: 3 };
const director = (resident = false, identity_verified = false) => ({ role: "director", resident, identity_verified, licensed: false });
const failing = (items: { label: string; ok: boolean }[]) => items.filter((i) => !i.ok).map((i) => i.label);

describe("setup checklist", () => {
  it("with no standard, checks only the general minimums", () => {
    expect(failing(setupChecklist({ ...company, registration_number: null, registered_address_id: null }, [], null))).toEqual([
      "Registration number",
      "Registered office",
    ]);
  });

  it("Mauritius GBL: two resident directors and a management company", () => {
    const gbl = { ...none, min_directors: 2, min_resident_directors: 2, management_company_required: true, share_capital: "required" as const };
    expect(failing(setupChecklist(company, [director(true), director(false)], gbl))).toEqual(["Resident directors", "Management company"]);
    const ok = setupChecklist(company, [director(true), director(true), { role: "management_company", resident: true, identity_verified: false, licensed: true }], gbl);
    expect(failing(ok)).toEqual([]);
  });

  it("UK company: every director must be identity-verified", () => {
    const uk = { ...none, min_directors: 1, identity_verification_required: true };
    expect(setupChecklist(company, [director(false, true), director(false, false)], uk).find((i) => i.label === "Identity verification")).toMatchObject({
      ok: false,
      detail: "1 officer not verified yet.",
    });
    expect(failing(setupChecklist(company, [director(false, true)], uk))).toEqual([]);
  });

  it("VISTA trust: a licensed trustee is needed; trusts have no registered office or year end check here", () => {
    const vista = { ...none, registered_office_required: false, min_trustees: 1, licensed_trustee_required: true };
    const trust = { ...company, entity_type: "trust" as const, registered_address_id: null, year_end_month: null };
    expect(failing(setupChecklist(trust, [{ role: "trustee", resident: false, identity_verified: false, licensed: false }], vista))).toEqual(["Licensed trustee"]);
  });

  it("asks for the share capital currency when shares are required", () => {
    const pty = { ...none, share_capital: "required" as const };
    expect(failing(setupChecklist({ ...company, base_currency: null }, [], pty))).toEqual(["Share capital currency"]);
  });
});

describe("matching an entity to its Entity Standard", () => {
  const s = (jurisdiction: string, entity_type: string, sub_type: string, status: string, version = 1) => ({ jurisdiction, entity_type, sub_type, status, version });
  const all = [
    s("Mauritius", "company", "Domestic private company", "approved"),
    s("Mauritius", "company", "Global Business Licence company", "approved"),
    s("Mauritius", "company", "Global Business Licence company", "draft", 2),
    s("Isle of Man", "foundation", "Foundation", "draft"),
    s("United Kingdom", "company", "Old standard", "retired"),
  ];

  it("finds the approved standard first, ignoring capitals, and never a retired one", () => {
    expect(matchStandard(all, { jurisdiction: "mauritius", entity_type: "company", sub_type: "global business licence company" })).toMatchObject({
      status: "approved",
      version: 1,
    });
    expect(matchStandard(all, { jurisdiction: "Isle of Man", entity_type: "foundation", sub_type: "Foundation" })).toMatchObject({ status: "draft" });
    expect(matchStandard(all, { jurisdiction: "United Kingdom", entity_type: "company", sub_type: "Old standard" })).toBeNull();
  });

  it("copies a new draft from the same jurisdiction and type when there is one", () => {
    expect(closestStandard(all, { jurisdiction: "Mauritius", entity_type: "company" })).toMatchObject({ status: "approved" });
    expect(closestStandard(all, { jurisdiction: "Jersey", entity_type: "company" })).toBeNull();
  });
});
