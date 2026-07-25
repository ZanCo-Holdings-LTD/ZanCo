import type { MemberRole } from "@/db/schema";

/**
 * Role-based access control.
 *
 * Four roles, ordered. Permissions are declared as the minimum role that holds
 * them, so a new permission is one line and cannot accidentally be granted to
 * viewers.
 */

const ROLE_RANK: Record<MemberRole, number> = {
  viewer: 0,
  manager: 1,
  admin: 2,
  owner: 3,
};

export const PERMISSIONS = {
  "records.view": "viewer",
  "records.create": "manager",
  "records.edit": "manager",
  "records.delete": "admin",
  "records.import": "manager",
  "records.export": "viewer",
  "holders.manage": "manager",
  "entities.view": "viewer",
  "entities.manage": "admin",
  "alerts.view": "viewer",
  "alerts.acknowledge": "viewer",
  "alerts.configure": "admin",
  "renewals.view": "viewer",
  "renewals.manage": "manager",
  "evidence.generate": "manager",
  "members.view": "viewer",
  "members.manage": "admin",
  "billing.manage": "owner",
  "settings.manage": "admin",
  "apikeys.manage": "owner",
  "organisation.delete": "owner",
} as const satisfies Record<string, MemberRole>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: MemberRole, permission: Permission): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[PERMISSIONS[permission]];
}

export class ForbiddenError extends Error {
  constructor(permission: Permission) {
    super(`Your role does not permit ${permission.replace(".", " ")}.`);
    this.name = "ForbiddenError";
  }
}

/** Throwing guard for server actions — the enforcement point, not the UI. */
export function assertCan(role: MemberRole, permission: Permission): void {
  if (!can(role, permission)) throw new ForbiddenError(permission);
}

export const ROLE_LABELS: Record<MemberRole, { en: string; ar: string; description: string }> = {
  owner: {
    en: "Owner",
    ar: "مالك",
    description: "Full access including billing and deleting the organisation.",
  },
  admin: {
    en: "Admin",
    ar: "مدير",
    description: "Manage entities, members, alert settings and delete records.",
  },
  manager: {
    en: "Manager",
    ar: "مشرف",
    description: "Add and edit records, run renewals, generate evidence packs.",
  },
  viewer: {
    en: "Viewer",
    ar: "مشاهد",
    description: "Read the register and acknowledge alerts. Cannot change data.",
  },
};

export const ASSIGNABLE_ROLES: MemberRole[] = ["admin", "manager", "viewer"];
