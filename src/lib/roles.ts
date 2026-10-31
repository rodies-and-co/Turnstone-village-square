// Roles, in plain words. The databases enforce what each role may do; this
// file only decides what the app shows and where it sends people.

export type SystemRole = "super_user" | "system_admin";
export type FamilyRole = "manager" | "administrator" | "viewer";

export const SYSTEM_ROLE_LABELS: Record<SystemRole, string> = {
  super_user: "Super User",
  system_admin: "System Admin",
};

export const FAMILY_ROLE_LABELS: Record<FamilyRole, string> = {
  manager: "Manager",
  administrator: "Administrator",
  viewer: "Viewer",
};

// Two-factor is compulsory for everyone except Viewers. A Viewer who has set
// it up must use it.
export function needsTwoFactor(input: {
  systemRole: SystemRole | null;
  familyRoles: FamilyRole[];
  hasFactor: boolean;
}) {
  if (input.systemRole) return true;
  if (input.familyRoles.some((r) => r === "manager" || r === "administrator")) return true;
  return input.hasFactor;
}

// The label to show for someone's role in a family. Super Users see every
// family; System Admins see the list but not family records.
export function roleInFamily(systemRole: SystemRole | null, familyRole: FamilyRole | null) {
  if (systemRole === "super_user") return SYSTEM_ROLE_LABELS.super_user;
  if (familyRole) return FAMILY_ROLE_LABELS[familyRole];
  if (systemRole === "system_admin") return SYSTEM_ROLE_LABELS.system_admin;
  return null;
}
