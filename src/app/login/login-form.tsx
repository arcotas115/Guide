'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { login, type LoginState } from './actions';

const initialState: LoginState = { error: null };

function SubmitButton() {
  // useFormStatus reads the pending state of the enclosing <form>, so the
  // button knows it is submitting without any state being threaded down.
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="h-11 w-full" disabled={pending}>
      {pending ? 'Signing in…' : 'Sign in'}
    </Button>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState(login, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          placeholder="you@college.edu"
          className="h-11"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-11"
        />
      </div>

      {state.error ? (
        // Rust is urgency. A failed sign-in qualifies; nothing else on this
        // screen does.
        <p
          role="alert"
          className="bg-rust-tint text-rust-deep rounded-md px-3 py-2 text-sm"
        >
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
