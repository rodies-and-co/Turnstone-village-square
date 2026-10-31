import { describe, expect, it } from "vitest";
import { needsTwoFactor, roleInFamily } from "@/lib/roles";

describe("two-factor rules", () => {
  it("is compulsory for Super Users, System Admins, Managers and Administrators", () => {
    expect(needsTwoFactor({ systemRole: "super_user", familyRoles: [], hasFactor: false })).toBe(true);
    expect(needsTwoFactor({ systemRole: "system_admin", familyRoles: [], hasFactor: false })).toBe(true);
    expect(needsTwoFactor({ systemRole: null, familyRoles: ["manager"], hasFactor: false })).toBe(true);
    expect(needsTwoFactor({ systemRole: null, familyRoles: ["viewer", "administrator"], hasFactor: false })).toBe(true);
  });

  it("is optional for Viewers until they set it up", () => {
    expect(needsTwoFactor({ systemRole: null, familyRoles: ["viewer"], hasFactor: false })).toBe(false);
    expect(needsTwoFactor({ systemRole: null, familyRoles: ["viewer"], hasFactor: true })).toBe(true);
  });
});

describe("role shown for a family", () => {
  it("shows Super User above any family role", () => {
    expect(roleInFamily("super_user", "viewer")).toBe("Super User");
  });
  it("shows the family role, or System Admin when there is none", () => {
    expect(roleInFamily(null, "manager")).toBe("Manager");
    expect(roleInFamily("system_admin", null)).toBe("System Admin");
    expect(roleInFamily(null, null)).toBeNull();
  });
});
