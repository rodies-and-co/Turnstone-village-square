import { describe, expect, it } from "vitest";
import {
  addressMatchKey,
  displayNames,
  friendlyError,
  matchesSearch,
  parseAddress,
  parseBirthDate,
  parseDetailsForm,
  parsePersonForm,
  parsePhone,
  siblingKinds,
} from "@/lib/people";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

describe("display names", () => {
  it("uses Known as and surname, and adds the birth year only when names repeat", () => {
    const names = displayNames([
      { id: "1", full_names: "Thomas George", surname: "Hartley", known_as: "Tom", birth_year: 1975 },
      { id: "2", full_names: "Thomas Arthur", surname: "Hartley", known_as: "Tom", birth_year: 2003 },
      { id: "3", full_names: "Sarah Jane", surname: "Hartley", known_as: null, birth_year: 1978 },
      { id: "4", full_names: "Tom", surname: "hartley", known_as: null, birth_year: null },
    ]);
    expect(names.get("1")).toBe("Tom Hartley (1975)");
    expect(names.get("2")).toBe("Tom Hartley (2003)");
    expect(names.get("3")).toBe("Sarah Hartley");
    expect(names.get("4")).toBe("Tom hartley (year not known)");
  });

  it("searches full names, surname, Known as and maiden name", () => {
    const p = { id: "1", full_names: "Marieke Elisabeth", surname: "van Dijk", known_as: "Marieke", birth_year: 1976, maiden_name: "Visser" };
    expect(matchesSearch(p, "visser")).toBe(true);
    expect(matchesSearch(p, "ELIS")).toBe(true);
    expect(matchesSearch(p, "jansen")).toBe(false);
    expect(matchesSearch(p, "  ")).toBe(true);
  });
});

describe("person form", () => {
  it("accepts a complete person", () => {
    const r = parsePersonForm(
      form({ full_names: " Sarah Jane ", surname: "Hartley", member_type: "family", birth_year: "1978", three_circle_role: "family_owner" }),
    );
    expect(r).toEqual({
      ok: true,
      value: {
        full_names: "Sarah Jane",
        surname: "Hartley",
        maiden_name: null,
        known_as: null,
        member_type: "family",
        birth_year: 1978,
        date_of_birth: null,
        deceased: false,
        three_circle_role: "family_owner",
      },
    });
  });

  it("explains what is missing or wrong", () => {
    expect(parsePersonForm(form({ surname: "X", member_type: "family" }))).toMatchObject({ ok: false, error: /full names/ });
    expect(parsePersonForm(form({ full_names: "X", surname: "Y", member_type: "cousin" }))).toMatchObject({ ok: false });
    expect(parsePersonForm(form({ full_names: "X", surname: "Y", member_type: "family", birth_year: "75" }))).toMatchObject({
      ok: false,
      error: /four digits/,
    });
    expect(parsePersonForm(form({ full_names: "X", surname: "Y", member_type: "family", birth_year: "2999" }))).toMatchObject({ ok: false });
    expect(
      parsePersonForm(form({ full_names: "X", surname: "Y", member_type: "family", three_circle_role: "king" })),
    ).toMatchObject({ ok: false });
  });
});

describe("date of birth (entered once)", () => {
  it("accepts the year alone, or a full date", () => {
    expect(parseBirthDate(form({ birth_year: "1978" }))).toEqual({ ok: true, value: { year: 1978, date: null } });
    expect(parseBirthDate(form({ birth_year: "1978", birth_month: "3", birth_day: "9" }))).toEqual({
      ok: true,
      value: { year: 1978, date: "1978-03-09" },
    });
    expect(parseBirthDate(form({}))).toEqual({ ok: true, value: { year: null, date: null } });
  });

  it("refuses half a date, a date that doesn't exist, or a future date", () => {
    expect(parseBirthDate(form({ birth_year: "1978", birth_month: "3" }))).toMatchObject({ ok: false, error: /both the day and the month/ });
    expect(parseBirthDate(form({ birth_day: "9", birth_month: "3" }))).toMatchObject({ ok: false, error: /year/ });
    expect(parseBirthDate(form({ birth_year: "1979", birth_month: "2", birth_day: "29" }))).toMatchObject({ ok: false, error: /doesn't exist/ });
    expect(parseBirthDate(form({ birth_year: "1980", birth_month: "2", birth_day: "29" }))).toMatchObject({ ok: true });
    const next = new Date().getFullYear();
    expect(parseBirthDate(form({ birth_year: String(next), birth_month: "12", birth_day: "31" }))).toMatchObject({ ok: false });
  });
});

describe("personal details form", () => {
  it("checks dates and email", () => {
    expect(parseDetailsForm(form({ date_of_death: "09/03/1970" }))).toMatchObject({ ok: false });
    expect(parseDetailsForm(form({ email: "not an email" }))).toMatchObject({ ok: false });
    const ok = parseDetailsForm(form({ date_of_death: "2020-03-09", email: "a@b.co", sex: "male" }));
    expect(ok).toMatchObject({ ok: true, value: { date_of_death: "2020-03-09", sex: "male", relationship_to_wealth: null } });
    // The date of birth is not part of this form; it is entered once, with the year.
    expect(ok.ok && "date_of_birth" in ok.value).toBe(false);
  });
});

describe("phones and addresses", () => {
  it("checks phone numbers", () => {
    expect(parsePhone(form({ number: "+44 7700 900123" }))).toEqual({ ok: true, value: { label: "Mobile", number: "+44 7700 900123" } });
    expect(parsePhone(form({ number: "call me" }))).toMatchObject({ ok: false });
  });

  it("needs a first line, town and country", () => {
    expect(parseAddress(form({ line1: "1 Test Lane", city: "Leeds" }))).toMatchObject({ ok: false });
    expect(parseAddress(form({ line1: "1 Test Lane", city: "Leeds", country: "UK" }))).toMatchObject({ ok: true });
  });

  it("treats the same address typed differently as the same", () => {
    expect(addressMatchKey({ line1: "1 Test Lane", city: "Leeds", postal_code: "LS1 1AA", country: "United Kingdom" })).toBe(
      addressMatchKey({ line1: "1, test lane", city: "LEEDS", postal_code: "ls11aa", country: "united kingdom" }),
    );
  });
});

describe("error messages", () => {
  it("turns database errors into plain English", () => {
    expect(friendlyError("This link would make a person their own ancestor")).toMatch(/own ancestor/);
    expect(friendlyError("new row violates row-level security policy")).toMatch(/permission/);
    expect(friendlyError("something odd")).toMatch(/Something went wrong/);
  });
});

describe("brothers and sisters", () => {
  const birth = (parent_id: string) => ({ parent_id, kind: "birth" });
  const link = (parent_id: string, child_id: string, kind = "birth") => ({ parent_id, child_id, kind });

  it("tells siblings, half-siblings and step-siblings apart", () => {
    const me = [birth("mum"), birth("dad"), { parent_id: "stepmum", kind: "step" }];
    const result = siblingKinds(me, [
      link("mum", "full"), link("dad", "full"),
      link("dad", "half"), link("other-mum", "half"),
      link("stepmum", "step"), link("stepmum-ex", "step"),
      link("mum", "half-step-dad"), link("dad", "half-step-dad", "step"),
    ]);
    const label = Object.fromEntries(result.map((r) => [r.id, r.label]));
    expect(label).toEqual({ full: "Sibling", half: "Half-sibling", step: "Step-sibling", "half-step-dad": "Half-sibling" });
  });
});
