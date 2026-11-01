// The Branches: working out which questions to ask. Pure functions, no
// database access, so they can be tested on their own.
//
// Agreed with the owner (1 Nov 2026):
//   - A Manager confirms who the wealth creators are.
//   - Each child of a wealth creator may head a branch: the app asks.
//   - The head's spouse / partner and descendants (and their spouses /
//     partners) are suggested for that branch: the app asks for each.
//   - A person is in one branch. If someone could join two branches (e.g.
//     cousins married), the app asks which one.
//   - Nothing happens without a Manager's "Yes".

export type BPerson = {
  id: string;
  member_type: string;
  branch_id: string | null;
  known_as: string | null;
  full_names: string;
  surname: string;
  birth_year: number | null;
};
export type BLink = { parent_id: string; child_id: string; kind: string };
export type BPartnership = { person_a: string; person_b: string; end_date: string | null };
export type BBranch = { id: string; name: string; head_person_id: string | null };
export type BAnswer = { person_id: string; question: string; branch_id: string | null };

// Birth and adoptive links carry a branch down; step and foster links don't.
const carriesBranch = (kind: string) => kind === "birth" || kind === "adopted";

export function branchNameFor(p: Pick<BPerson, "known_as" | "full_names" | "surname">) {
  const first = p.known_as?.trim() || p.full_names.trim().split(/\s+/)[0];
  return `${first} ${p.surname.trim()} Branch`;
}

export type JoinSuggestion = { personId: string; options: { branchId: string; relation: string }[] };

export function branchQuestions(input: {
  people: BPerson[];
  links: BLink[];
  partnerships: BPartnership[];
  branches: BBranch[];
  wealthCreators: string[];
  answers: BAnswer[];
}) {
  const { people, links, partnerships, branches, wealthCreators, answers } = input;
  const byId = new Map(people.map((p) => [p.id, p]));
  const creators = new Set(wealthCreators.filter((id) => byId.has(id)));
  const heads = new Set(branches.map((b) => b.head_person_id).filter((x): x is string => Boolean(x)));
  const saidNo = (personId: string, question: string, branchId: string | null = null) =>
    answers.some((a) => a.person_id === personId && a.question === question && (a.branch_id ?? null) === branchId);
  const isFamily = (id: string) => {
    const p = byId.get(id);
    return Boolean(p && p.member_type !== "non_family");
  };

  const childrenOf = (id: string) => links.filter((l) => l.parent_id === id && carriesBranch(l.kind)).map((l) => l.child_id);
  const currentPartners = (id: string) =>
    partnerships
      .filter((p) => !p.end_date && (p.person_a === id || p.person_b === id))
      .map((p) => (p.person_a === id ? p.person_b : p.person_a));

  // 1. Children of wealth creators who might start a branch.
  const childrenOfCreators = new Set<string>();
  for (const c of creators) for (const child of childrenOf(c)) childrenOfCreators.add(child);
  const startQuestions = [...childrenOfCreators]
    .filter((id) => isFamily(id) && !creators.has(id) && !heads.has(id) && !saidNo(id, "starts_branch"))
    .sort((a, b) => (byId.get(a)?.birth_year ?? 9999) - (byId.get(b)?.birth_year ?? 9999));

  // 2. Who might join each branch: the head's partner, descendants and their partners.
  const relationTo = new Map<string, Map<string, string>>(); // branchId -> personId -> relation
  for (const b of branches) {
    const rel = new Map<string, string>();
    const head = b.head_person_id;
    if (!head || !byId.has(head)) {
      relationTo.set(b.id, rel);
      continue;
    }
    rel.set(head, "Head of the branch");
    for (const p of currentPartners(head)) if (!rel.has(p)) rel.set(p, "Spouse / partner of the head");
    const words = ["Child", "Grandchild", "Great-grandchild"];
    let layer = [head];
    for (let depth = 0; layer.length && depth < 10; depth++) {
      const next: string[] = [];
      for (const parent of layer) {
        for (const child of childrenOf(parent)) {
          if (rel.has(child)) continue;
          rel.set(child, words[depth] ?? `Descendant (${depth + 1} generations down)`);
          next.push(child);
          for (const partner of currentPartners(child)) {
            if (!rel.has(partner)) rel.set(partner, `Spouse / partner of ${firstName(byId.get(child))}`);
          }
        }
      }
      layer = next;
    }
    relationTo.set(b.id, rel);
  }

  const options = new Map<string, { branchId: string; relation: string }[]>();
  for (const b of branches) {
    for (const [personId, relation] of relationTo.get(b.id) ?? []) {
      const p = byId.get(personId);
      if (!p || personId === b.head_person_id) continue;
      if (!isFamily(personId) || creators.has(personId) || heads.has(personId)) continue;
      if (p.branch_id) continue; // already in a branch: one branch per person
      if (saidNo(personId, "joins_branch", b.id)) continue;
      options.set(personId, [...(options.get(personId) ?? []), { branchId: b.id, relation }]);
    }
  }
  const joinSuggestions: JoinSuggestion[] = [...options.entries()]
    .map(([personId, opts]) => ({ personId, options: opts }))
    .sort((a, b) => (byId.get(a.personId)?.birth_year ?? 9999) - (byId.get(b.personId)?.birth_year ?? 9999));

  // 3. Branches to check: once wealth creators are confirmed, a branch whose
  //    head isn't a child of one (or has no head) is pointed out.
  const branchesToCheck = creators.size
    ? branches.filter((b) => !b.head_person_id || !childrenOfCreators.has(b.head_person_id)).map((b) => b.id)
    : [];

  const relationInBranch = (branchId: string, personId: string) => relationTo.get(branchId)?.get(personId) ?? null;

  return { startQuestions, joinSuggestions, branchesToCheck, relationInBranch };
}

function firstName(p: BPerson | undefined) {
  if (!p) return "a family member";
  return p.known_as?.trim() || p.full_names.trim().split(/\s+/)[0];
}

// Is this person a wealth creator whose new child should prompt the question?
export function isChildOfWealthCreator(childId: string, links: BLink[], wealthCreators: string[]) {
  return links.some((l) => l.child_id === childId && carriesBranch(l.kind) && wealthCreators.includes(l.parent_id));
}
