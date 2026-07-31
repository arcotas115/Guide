import type { Metadata } from 'next';
import { LoginForm } from './login-form';

export const metadata: Metadata = {
  title: 'Sign in · Campus',
};

export default async function LoginPage({
  searchParams,
}: {
  // Next 16: searchParams is async.
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  const nextPath = Array.isArray(next) ? next[0] : next;

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

        <LoginForm next={nextPath} />

        <p className="text-faint mt-8 text-xs leading-relaxed">
          Accounts are created by your institution. If you cannot sign in, ask
          your department office or campus admin.
        </p>
      </div>
    </main>
  );
}
