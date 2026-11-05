import { describe, expect, it } from "vitest";
import { Masker } from "@/lib/placeholders";

function family() {
  const m = new Masker();
  m.add("Family", "f", "Visser");
  m.add("Person", "p1", "Pieter Johannes Visser", ["Pieter", "Johannes", "Visser", "Piet", "Piet Visser"]);
  m.add("Person", "p2", "Anna Maria Botha", ["Anna", "Maria", "Botha", "Van Wyk"]);
  m.add("Person", "p3", "Will Hartley", ["Will", "Hartley"]);
  m.add("Person", "p4", "Zoë Visser", ["Zoë", "Visser"]);
  m.add("Person", "p5", "Jo Hartley", ["Jo", "Hartley"]);
  m.add("Entity", "e1", "Visser Holdings Limited");
  return m;
}

describe("placeholders", () => {
  it("replaces full names and every part of them, and puts them back", () => {
    const m = family();
    expect(m.mask("Is Pieter Johannes Visser a director of Visser Holdings Limited?")).toBe("Is [Person 1] a director of [Entity 1]?");
    expect(m.mask("Ask Piet. Is Anna a beneficiary? Mrs Botha? Née Van Wyk.")).toBe("Ask [Person 1]. Is [Person 2] a beneficiary? Mrs [Person 2]? Née [Person 2].");
    expect(m.unmask("[Person 1] and [Person 2] own [Entity 1].")).toBe("Pieter Johannes Visser and Anna Maria Botha own Visser Holdings Limited.");
  });
  it("allows for plurals, possessives, line breaks, hyphens and accents", () => {
    const m = family();
    expect(m.mask("The Vissers own it; Pieter's house; Anna-Maria\nBotha; Zoe and Zoë.")).toBe("The [Family] own it; [Person 1] house; [Person 2]; [Person 4] and [Person 4].");
  });
  it("keeps two people apart, and never guesses a shared name", () => {
    const m = family();
    // "Hartley" belongs to two people (Will and Jo), so it can't be filled back in.
    expect(m.mask("Mr Hartley")).toBe("Mr [Name]");
    expect(m.unmask("Mr [Name]")).toBe("Mr (a name)");
    expect(m.mask("Ask Jo")).toBe("Ask [Person 5]");
  });
  it("only treats a single word as a name when it has a capital letter", () => {
    const m = family();
    expect(m.mask("What happens to my will? Will knows.")).toBe("What happens to my will? [Person 3] knows.");
  });
  it("gives one placeholder per person, by id", () => {
    const m = new Masker();
    expect(m.add("Person", "a", "Tom Hartley")).toBe("[Person 1]");
    expect(m.add("Person", "b", "Tom Hartley")).toBe("[Person 2]");
    expect(m.add("Person", "a", "Tom Hartley")).toBe("[Person 1]");
    expect(m.add("Person", "c", "J")).toBeNull();
  });
  it("never sends numbers or details that could identify someone", () => {
    expect(
      Masker.scrubNumbers(
        "Passport NL1234567 or 1234567, ab1234567, account 12345678 sort 12-34-56, NI AB 12 34 56 C, born 12/03/1961 at SW1A 1AA, phone +44 20 7946 0000, mail a@b.co.uk, in 1998 with 25%.",
      ),
    ).toBe(
      "Passport [number removed] or [number removed], [number removed], account [number removed] sort [number removed], NI [number removed], born [date removed] at [postcode removed], phone [number removed], mail [email removed], in 1998 with 25%.",
    );
  });
});
