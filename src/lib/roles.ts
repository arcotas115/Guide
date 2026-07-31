/**
 * Roles and where each one lives.
 *
 * SPEC.md keeps `role` as a text column with a CHECK constraint rather than a
 * Postgres enum, precisely so a later role (schools mode) is a migration, not a
 * type rewrite. This file is the single TypeScript mirror of that constraint —
 * if you add a role here, add it to the CHECK in 0001_init_schema.sql too.
 */
export const ROLES = ['student', 'faculty', 'admin', 'placement_officer'] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * Where a signed-in user belongs. This is the whole of "role-based redirect":
 * one lookup table, used by the root page, the login action and every role
 * layout, so the three can never disagree.
 *
 * placement_officer is deferred in v1 (admin covers placements), so it lands on
 * the admin surface for now.
 */
export const HOME_FOR_ROLE: Record<Role, string> = {
  student: '/student',
  faculty: '/faculty',
  admin: '/admin',
  placement_officer: '/admin',
};

/** Every route segment that requires a signed-in user. */
export const PROTECTED_PREFIXES = ['/student', '/faculty', '/admin'] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}
