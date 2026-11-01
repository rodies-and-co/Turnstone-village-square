// Two people for every removal: pages ask for a removal here, and a Manager
// who didn't ask approves it on the family Overview. The family database
// enforces this (request_removal / decide_removal); nothing is removed directly.

import type { FamilyContext } from "@/lib/family-context";
import { friendlyError } from "@/lib/people";

export function removalError(message: string | undefined) {
  const m = message ?? "";
  if (/^Removal: /.test(m)) return m.replace(/^Removal: /, "");
  if (/^(Shares|Ownership): /.test(m)) return m.replace(/^(Shares|Ownership): /, "");
  if (/foreign key/.test(m) && /share_transactions|settlements|beneficiar/.test(m))
    return "It appears in a share register, or as a settlor, founder or beneficiary, which are kept as records, so it can't be removed.";
  return friendlyError(m);
}

// Returns an error message, or null when the request was recorded. `within`
// makes sure the record belongs where the page says it does (e.g. to this
// entity), so a page can't be used to ask for something elsewhere.
export async function askToRemove(ctx: FamilyContext, table: string, id: string, within?: Record<string, string>): Promise<string | null> {
  if (!ctx.db || !ctx.canEdit) return "Only a Manager or Administrator can ask for something to be removed.";
  if (within) {
    let q = ctx.db.from(table).select("id").eq("id", id);
    for (const [column, value] of Object.entries(within)) q = q.eq(column, value);
    const { data } = await q.limit(1);
    if (!data?.length) return "That couldn't be found here. It may already have gone.";
  }
  const { error } = await ctx.db.rpc("request_removal", { p_table: table, p_id: id });
  return error ? removalError(error.message) : null;
}
