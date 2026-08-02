import { Eyebrow } from '@/components/kit/surfaces';

/**
 * A tab that exists but is not built.
 *
 * Calm and specific rather than a shrug. Saying what the screen WILL do is the
 * difference between "not ready" and "broken" — and it is why all five tabs
 * ship at once instead of appearing one at a time under the student.
 */
export function ComingSoon({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto w-full max-w-md px-5 py-8">
      <h1 className="screen-title text-ink">{title}</h1>
      <div className="border-card-border bg-card mt-6 rounded-xl border px-5 py-10 text-center">
        <Eyebrow className="text-ink-faint">Coming soon</Eyebrow>
        <p className="text-ink-soft mx-auto mt-3 max-w-[17rem] text-[14px] leading-relaxed">
          {body}
        </p>
      </div>
    </div>
  );
}
