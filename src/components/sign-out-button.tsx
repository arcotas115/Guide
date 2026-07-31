import { signOut } from '@/app/auth/actions';

/**
 * Plain form + server action, so it works before any JavaScript has loaded.
 */
export function SignOutButton() {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="text-subtle hover:text-ink text-xs underline underline-offset-4 transition-colors"
      >
        Sign out
      </button>
    </form>
  );
}
