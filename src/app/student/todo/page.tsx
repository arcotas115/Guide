import type { Metadata } from 'next';
import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { getTodo } from '@/lib/todo/queries';
import { bucketBy, deadlineLabel } from '@/lib/todo/buckets';
import { Card, Chevron, Eyebrow } from '@/components/kit/surfaces';

export const metadata: Metadata = { title: 'To-Do · Campus' };

export default async function TodoPage() {
  const profile = await requireRole('student');
  const items = await getTodo(profile);

  const now = new Date();
  const buckets = bucketBy(items, (i) => i.dueAt, now, profile.timeZone);

  return (
    <div className="mx-auto w-full max-w-md px-5 py-8">
      <h1 className="screen-title text-ink">To-Do</h1>
      <p className="text-ink-soft mt-2 text-[14px]">
        {items.length === 0
          ? 'Across all your courses.'
          : `${items.length} ${items.length === 1 ? 'thing' : 'things'} to hand in.`}
      </p>

      {buckets.length === 0 ? (
        /*
         * The rest state, and DESIGN.md §6 is explicit that it must not tease
         * the next upcoming item. A rest state that shows you what is coming is
         * not a rest state — it just moves the anxiety forward by a week.
         */
        <div className="border-card-border bg-card mt-8 rounded-xl border px-6 py-16 text-center">
          <p className="text-ink text-[16px] font-semibold tracking-[-0.02em]">
            All caught up.
          </p>
          <p className="text-ink-soft mt-2 text-[14px]">Nothing pending.</p>
        </div>
      ) : (
        <div className="mt-8 space-y-7">
          {buckets.map((bucket) => (
            <section key={bucket.key}>
              <div className="flex items-baseline gap-2.5 px-1">
                {/*
                  RUST IS FOR OVERDUE ONLY. The bucket headings carry the
                  urgency, which is exactly what lets every row below stay calm.
                */}
                <Eyebrow
                  className={
                    bucket.key === 'overdue' ? 'text-rust' : 'text-ink-faint'
                  }
                >
                  {bucket.title}
                </Eyebrow>
                <span className="text-ink-faint font-mono text-[11px] tabular-nums">
                  {bucket.items.length}
                </span>
              </div>

              <Card className="mt-2">
                <ul className="divide-card-border divide-y">
                  {bucket.items.map((item) => (
                    <li
                      key={item.assignmentId}
                      className="course-scope"
                      style={
                        {
                          '--course-color': item.courseColor,
                        } as React.CSSProperties
                      }
                    >
                      <Link
                        href={`/student/courses/${item.offeringId}/assignments/${item.assignmentId}`}
                        className="active:bg-canvas flex items-stretch transition-colors"
                      >
                        {/* The course's identity colour, carried through to
                            To-Do exactly as DESIGN.md §4 requires. */}
                        <div
                          className="w-1 shrink-0"
                          style={{ background: 'var(--course-color)' }}
                          aria-hidden
                        />
                        <div className="flex flex-1 items-center gap-3 py-3.5 pr-3 pl-3.5">
                          <div className="min-w-0 flex-1">
                            <p className="course-code">{item.courseCode}</p>
                            <p className="text-ink mt-1 text-[15px] leading-snug font-semibold tracking-[-0.02em]">
                              {item.title}
                            </p>
                            <p
                              className={`mt-1 text-[13px] ${
                                bucket.key === 'overdue'
                                  ? 'text-rust'
                                  : 'text-ink-soft'
                              }`}
                            >
                              {deadlineLabel(item.dueAt, now, profile.timeZone)}
                            </p>
                          </div>
                          <Chevron />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
