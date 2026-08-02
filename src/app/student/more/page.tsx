import type { Metadata } from 'next';
import { requireRole } from '@/lib/auth';
import { ComingSoon } from '@/components/student/coming-soon';
import { SignOutButton } from '@/components/sign-out-button';
import { Card } from '@/components/kit/surfaces';

export const metadata: Metadata = { title: 'More · Campus' };

export default async function MorePage() {
  const profile = await requireRole('student');

  return (
    <>
      <ComingSoon
        title="More"
        body="Your attendance across every course, placements, and your profile."
      />
      {/* Sign out lives here permanently, so it moves off the home header when
          this screen is built rather than needing to be found again. */}
      <div className="mx-auto w-full max-w-md px-5 pb-8">
        <Card className="flex items-center justify-between gap-4 px-4 py-3.5">
          <div className="min-w-0">
            <p className="text-ink truncate text-[14.5px] font-medium">
              {profile.fullName}
            </p>
            <p className="text-ink-soft truncate text-[12.5px]">{profile.email}</p>
          </div>
          <SignOutButton />
        </Card>
      </div>
    </>
  );
}
