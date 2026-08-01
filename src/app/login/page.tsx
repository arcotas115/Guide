import type { Metadata } from 'next';
import { LoginForm } from './login-form';
import { blockedMessage, isAccountStatus } from '@/lib/account-status';

export const metadata: Metadata = {
  title: 'Sign in · Campus',
};

export default async function LoginPage({
  searchParams,
}: {
  // Next 16: searchParams is async.
  searchParams: Promise<{ next?: string | string[]; reason?: string | string[] }>;
}) {
  const { next, reason } = await searchParams;
  const nextPath = Array.isArray(next) ? next[0] : next;

  // Set by /auth/blocked after it ends the session of an account that may no
  // longer hold one — so the person arrives already signed out, with an
  // explanation, rather than at a bare form that just stopped working.
  const rawReason = Array.isArray(reason) ? reason[0] : reason;
  const blocked = isAccountStatus(rawReason) ? blockedMessage(rawReason) : null;

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-ink text-2xl font-semibold tracking-tight">
            Campus
          </h1>
          <p className="text-subtle mt-1 text-sm">
            Sign in with the account your college gave you.
          </p>
        </div>

        {blocked ? (
          <p
            role="status"
            className="bg-rust-bg text-rust-deep mb-6 rounded-lg px-4 py-3 text-[13.5px] leading-relaxed"
          >
            {blocked}
          </p>
        ) : null}

        <LoginForm next={nextPath} />

        <p className="text-faint mt-8 text-xs leading-relaxed">
          Accounts are created by your institution. If you cannot sign in, ask
          your department office or campus admin.
        </p>
      </div>
    </main>
  );
}
