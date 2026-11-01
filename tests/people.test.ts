import { describe, expect, it } from "vitest";
import {
  addressMatchKey,
  displayNames,
  friendlyError,
  matchesSearch,
  parseAddress,
  parseDetailsForm,
  parsePersonForm,
  parsePhone,
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

describe("personal details form", () => {
  it("checks dates and email", () => {
    expect(parseDetailsForm(form({ date_of_birth: "1970-03-09", date_of_death: "1960-01-01" }))).toMatchObject({ ok: false });
    expect(parseDetailsForm(form({ date_of_birth: "09/03/1970" }))).toMatchObject({ ok: false });
    expect(parseDetailsForm(form({ email: "not an email" }))).toMatchObject({ ok: false });
    const ok = parseDetailsForm(form({ date_of_birth: "1970-03-09", email: "a@b.co", sex: "male" }));
    expect(ok).toMatchObject({ ok: true, value: { date_of_birth: "1970-03-09", sex: "male", relationship_to_wealth: null } });
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
