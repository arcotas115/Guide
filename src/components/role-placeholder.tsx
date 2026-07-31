import type { CurrentProfile } from '@/lib/auth';
import { SignOutButton } from '@/components/sign-out-button';

/**
 * Milestone 0 scaffolding. Its only job is to prove, visibly, that the right
 * account reached the right surface — so it prints the facts that would differ
 * if the routing or the tenancy were wrong: role, institution, and the
 * institution's own attendance threshold (config-as-data, never a literal 75).
 *
 * Every one of these screens gets replaced by the real thing in Milestone 1.
 */
export function RolePlaceholder({
  profile,
  surface,
  upcoming,
}: {
  profile: CurrentProfile;
  surface: string;
  upcoming: readonly string[];
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-faint font-mono text-[11px] tracking-widest uppercase">
            {surface}
          </p>
          <h1 className="text-ink mt-1 text-2xl font-semibold tracking-tight">
            {profile.fullName}
          </h1>
          <p className="text-subtle mt-1 text-sm">{profile.institutionName}</p>
        </div>
        <SignOutButton />
      </header>

      <dl className="border-card-border divide-card-border bg-card divide-y rounded-xl border text-sm">
        <Row label="Role" value={profile.role} mono />
        {profile.rollNumber ? (
          <Row label="Roll number" value={profile.rollNumber} mono />
        ) : null}
        <Row label="Signed in as" value={profile.email} />
        <Row
          label="Attendance threshold"
          value={`${profile.minAttendancePct}%`}
          mono
        />
        <Row label="Institution ID" value={profile.institutionId} mono />
      </dl>

      <section>
        <h2 className="text-ink-muted text-xs font-medium tracking-wide uppercase">
          Coming in Milestone 1
        </h2>
        <ul className="text-subtle mt-3 space-y-1.5 text-sm">
          {upcoming.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="text-faint" aria-hidden>
                —
              </span>
              {item}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-3">
      <dt className="text-subtle">{label}</dt>
      <dd
        className={`text-ink text-right ${mono ? 'font-mono text-[13px]' : ''}`}
      >
        {value}
      </dd>
    </div>
  );
}
