// Confirmation messages shown after a button is pressed. The address bar only
// carries the short code (e.g. ?saved=passport_added), not the text.

export const SAVED_MESSAGES = {
  saved: "Changes saved.",
  person_added: "Person added to the Tree.",
  person_removed: "The person has been removed from the Tree.",
  details_saved: "Personal details saved.",
  passport_added: "Passport added.",
  phone_added: "Phone number added.",
  address_added: "Address added.",
  address_shared: "Address added. It was already in the family's list, so the same address is now shared.",
  link_added: "Family link added. It shows on both people's records.",
  links_added: "Family links added. They show on everyone's records.",
  tax_added: "Tax number added.",
  removed: "Removed.",
  link_added_branch_question: "Saved. A question is waiting on the Branches page: does this child of a wealth creator start a branch?",
  wealth_creator_added: "Wealth creator confirmed. Their children's branch questions are on this page.",
  wealth_creator_removed: "No longer marked as a wealth creator.",
  branch_created: "Branch created and named after its head.",
  answer_saved: "Answer saved. That question won't be asked again.",
  question_reopened: "The question will be asked again.",
  member_added: "Added to the branch.",
  member_removed: "Taken out of the branch.",
  branch_renamed: "Branch renamed.",
  branch_removed: "Branch removed. Its members are still in the Tree, without a branch.",
  body_added: "Governance body added.",
  body_saved: "Governance body saved.",
  body_removed: "Governance body removed.",
  seat_added: "Member added.",
  seat_ended: "Membership ended. It stays in the history of the body.",
  seat_removed: "Membership removed.",
  advisor_added: "Advisor added to the circle.",
  advisor_saved: "Advisor's details saved.",
  advisor_role_removed: "Taken out of the circle.",
  advisor_removed: "Advisor removed.",
  statement_added: "Statement added as a draft. Another Manager adopts it.",
  statement_saved: "Wording saved. It is a draft until a Manager who didn't prepare it adopts it.",
  statement_adopted: "Statement adopted.",
  statement_withdrawn: "Adoption withdrawn. The statement is a draft again.",
  statement_removed: "Statement removed.",
} as const;

export type SavedCode = keyof typeof SAVED_MESSAGES;

export function savedMessage(code: string | undefined) {
  if (!code) return null;
  return code in SAVED_MESSAGES ? SAVED_MESSAGES[code as SavedCode] : SAVED_MESSAGES.saved;
}

// Error messages come back in the address bar as text (they can include
// details such as years of birth). Keep them short and plain.
export function errorMessage(text: string | undefined) {
  if (!text) return null;
  const clean = text.replace(/[\u0000-\u001f<>]/g, "").trim();
  return clean.length > 300 ? `${clean.slice(0, 300)}…` : clean;
}
