export const USER_ROLES = ['admin', 'manager', 'cashier'] as const
export type UserRole = (typeof USER_ROLES)[number]

const RANK: Record<UserRole, number> = { cashier: 1, manager: 2, admin: 3 }

/** Roles are hierarchical: an admin can do anything a manager can, and a manager anything a cashier can. */
export function roleAtLeast(role: UserRole, minimum: UserRole): boolean {
    return RANK[role] >= RANK[minimum]
}
