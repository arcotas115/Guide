import type { Metadata } from 'next';
import { ComingSoon } from '@/components/student/coming-soon';

export const metadata: Metadata = { title: 'Calendar · Campus' };

export default function CalendarPage() {
  return (
    <ComingSoon
      title="Calendar"
      body="Your week, with classes as blocks in each course's colour and a line showing where you are in the day."
    />
  );
}
