// Placeholders for Ask the Elder (CLAUDE.md: personal details are replaced
// with placeholders before anything is sent to the AI, and restored on
// return). Pure (no database), so it can be tested on its own.
//
// - Each person (or entity, firm, branch) has one placeholder, by its id, so
//   two people with the same name are never merged.
// - Their full name and every part of it (given names, surname, maiden name,
//   "known as") are replaced. A part shared by two people becomes "[Name]",
//   which is never filled back in, so nobody is mistaken for someone else.
// - Full names match in any case; a single word (e.g. "Will", "Rose") only
//   when written with a capital, so "my will" stays "my will".
// - Spaces, hyphens and line breaks between names, plurals ("the Vissers")
//   and accents (Zoë / Zoe) are all allowed for.

export type Kind = "Person" | "Entity" | "Firm" | "Branch" | "Family";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Lower-case, accents removed, spacing made single: for comparing names.
export const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .normalize("NFC")
    .replace(/[\s-]+/g, " ")
    .trim();
const AMBIGUOUS = "[Name]";

type Entry = { label: string; single: boolean };

export class Masker {
  private entries = new Map<string, Entry>(); // folded text (single words: case kept) → placeholder
  private toReal = new Map<string, string>(); // placeholder → real text
  private byKey = new Map<string, string>(); // id → placeholder
  private counts = new Map<Kind, number>();
  replaced = 0;

  // One placeholder per thing (by its id), with every way its name may be written.
  add(kind: Kind, key: string, real: string, variants: string[] = []) {
    const clean = real.replace(/\s+/g, " ").trim();
    if (clean.length < 2) return null;
    let label = this.byKey.get(`${kind}:${key}`);
    if (!label) {
      const n = (this.counts.get(kind) ?? 0) + 1;
      this.counts.set(kind, n);
      label = kind === "Family" ? "[Family]" : `[${kind} ${n}]`;
      this.byKey.set(`${kind}:${key}`, label);
      this.toReal.set(label, clean);
    }
    for (const v of [clean, ...variants]) this.variant(v, label);
    return label;
  }

  private variant(v: string, label: string) {
    const t = fold(v);
    if (t.length < 2) return;
    const single = !t.includes(" ");
    // Single words keep their capital letter (so "will" isn't "Will").
    const k = single ? t[0].toUpperCase() + t.slice(1).toLowerCase() : t.toLowerCase();
    if (single && !/^\p{Lu}/u.test(fold(v))) return;
    const before = this.entries.get(k);
    if (!before) this.entries.set(k, { label, single });
    else if (before.label !== label && before.label !== "[Family]") this.entries.set(k, { label: AMBIGUOUS, single });
  }

  label(kind: Kind, key: string) {
    return this.byKey.get(`${kind}:${key}`) ?? null;
  }

  // Replace every known name in the text (longest first, whole words only).
  mask(text: string) {
    const keys = [...this.entries.keys()].sort((a, b) => b.length - a.length);
    if (keys.length === 0) return text;
    // Matched against an accent-free copy, mapped back to the original text.
    const dec = text.normalize("NFD");
    let plain = "";
    const at: number[] = [];
    for (let i = 0; i < dec.length; i++) {
      if (/\p{M}/u.test(dec[i])) continue;
      at.push(i);
      plain += dec[i];
    }
    at.push(dec.length);
    const parts = keys.map((k) => k.split(" ").map(escape).join("[\\s-]+"));
    const re = new RegExp(`(?<![\\p{L}\\p{N}])(${parts.join("|")})(?:'?s)?(?![\\p{L}\\p{N}])`, "giu");
    let out = "";
    let last = 0;
    for (const m of plain.matchAll(re)) {
      const found = m[1];
      const f = fold(found);
      const single = !f.includes(" ");
      const k = single ? f[0].toUpperCase() + f.slice(1).toLowerCase() : f.toLowerCase();
      const e = this.entries.get(k);
      // A single word only counts when written with a capital letter.
      if (!e || (single && !/^\p{Lu}/u.test(found))) continue;
      const start = at[m.index!];
      const end = at[m.index! + m[0].length];
      out += dec.slice(last, start) + e.label;
      last = end;
      this.replaced += 1;
    }
    return (out + dec.slice(last)).normalize("NFC");
  }

  // Put the real names back into the answer ("[Name]" stays as "a name").
  unmask(text: string) {
    return text
      .replace(/\[(?:Person|Entity|Firm|Branch) \d+\]|\[Family\]/g, (m) => this.toReal.get(m) ?? m)
      .replace(/\[Name\]/g, "(a name)");
  }

  // Numbers and details that could identify someone are never sent: long
  // numbers (account, ID, tax, phone), sort codes, dates written as numbers,
  // UK postcodes, National Insurance numbers, ID-like codes and emails.
  static scrubNumbers(text: string) {
    return text
      .replace(/[^@\s,;<>]+@[^@\s,;<>]+\.[A-Za-z]{2,}(?:\.[A-Za-z]{2,})*/g, "[email removed]")
      .replace(/\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/gi, "[number removed]")
      .replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/gi, "[postcode removed]")
      .replace(/\b\d{2}-\d{2}-\d{2}\b/g, "[number removed]")
      .replace(/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g, "[date removed]")
      .replace(/\b(?=[A-Z\d]*\d)(?=[A-Z\d]*[A-Z])[A-Z\d]{6,}\b/gi, "[number removed]")
      .replace(/\+?\d(?:[\d\s./-]{4,}\d)/g, (m) => (m.replace(/\D/g, "").length >= 6 ? "[number removed]" : m));
  }
}
