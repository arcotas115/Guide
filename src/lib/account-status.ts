/**
 * Account status — access level, not biography (DELETION_POLICY.md §1).
 *
 * A graduated student is not deleted. Their transcript must survive and their
 * name must still appear next to the work they submitted, which is exactly why
 * profiles carry `status` and never `deleted_at`.
 */
export const ACCOUNT_STATUSES = ['active', 'alumni', 'inactive'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export function isAccountStatus(value: unknown): value is AccountStatus {
  return (
    typeof value === 'string' &&
    (ACCOUNT_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Why a sign-in was refused, in words the person should actually receive.
 *
 * The two messages are deliberately different. Telling an alumnus their account
 * is closed is wrong — they graduated, which is a good thing that happened — and
 * it would be wrong even now, while the read-only surface they are promised does
 * not exist yet. Getting that tone right costs one extra branch.
 */
export const BLOCKED_MESSAGE: Record<Exclude<AccountStatus, 'active'>, string> =
  {
    alumni:
      'Welcome back. Your account has moved to alumni access, which is read-only — we are still building that view, so there is nothing to sign in to just yet. Your records are safe and nothing has been removed.',
    inactive:
      'This account has been closed, so it cannot be signed in to. If that looks like a mistake, your department office can reopen it.',
  };

/**
 * The message to show someone who may not sign in, or null if they may.
 *
 * Returning `string | null` rather than pairing a boolean guard with a lookup
 * keeps the two in step by construction — there is no way to be refused without
 * a sentence to show, and no way to index the table with a status that has one.
 */
export function blockedMessage(status: AccountStatus): string | null {
  return status === 'active' ? null : BLOCKED_MESSAGE[status];
}

/** Whether this status may hold a session at all. */
export function canSignIn(status: AccountStatus): boolean {
  // `alumni` is refused for now. The read-only surface is its own routes and
  // its own navigation, and DELETION_POLICY.md §1 defers it deliberately —
  // so this returns false rather than pretending a surface exists. When that
  // surface ships, this becomes `status !== 'inactive'` and the routing
  // decision moves to HOME_FOR_ROLE. Left obviously ready rather than hidden.
  return status === 'active';
}
