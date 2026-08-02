import type { Metadata } from 'next';
import { ComingSoon } from '@/components/student/coming-soon';

export const metadata: Metadata = { title: 'Notifications · Campus' };

export default function NotificationsPage() {
  return (
    <ComingSoon
      title="Notifications"
      body="Everything your professors post, from every course, newest first — in one place instead of five."
    />
  );
}
