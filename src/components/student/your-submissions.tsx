import type { StudentSubmission } from '@/lib/submissions/queries';
import { Card, Eyebrow } from '@/components/kit/surfaces';
import { formatDateTime } from '@/lib/format';

/**
 * YOUR SUBMISSIONS — every attempt, with its time and its items.
 *
 * NOTHING IS EVER DELETED ON RESUBMIT. Old attempts stay; they are simply not
 * the one that gets marked. Showing them all is what makes that promise
 * visible rather than merely true.
 *
 * Late-ness is per attempt and derived, so attempt 1 at 11pm reads as on time
 * and attempt 2 at 2am reads as late — both true, both shown. The app does not
 * decide which one "counts": it flags each honestly and the professor sees all
 * of them, the same philosophy SPEC §3.6 applies to locking team sets.
 */
export function YourSubmissions({
  submission,
  timeZone,
  allowMultiple,
  professorName,
}: {
  submission: StudentSubmission;
  timeZone: string;
  allowMultiple: boolean;
  professorName: string | null;
}) {
  if (submission.attempts.length === 0) return null;

  return (
    <section className="mt-7">
      <div className="flex items-baseline gap-2.5">
        <Eyebrow>Your submissions</Eyebrow>
        <span className="text-ink-faint font-mono text-[11px] tabular-nums">
          {submission.attempts.length}
        </span>
      </div>

      <Card className="mt-2.5">
        <ul className="divide-card-border divide-y">
          {submission.attempts.map((a) => {
            const isGraded = a.attempt === submission.latestAttempt;
            return (
              <li key={a.attempt} className="px-4 py-3.5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-ink text-[14.5px] font-semibold tracking-[-0.02em]">
                    Attempt {a.attempt}
                  </p>
                  {isGraded && submission.attempts.length > 1 ? (
                    // Quiet, not celebratory. It is a fact about which one the
                    // professor will open, not a reward.
                    <span className="bg-moss-bg text-moss-deep shrink-0 rounded-md px-2 py-0.5 text-[11.5px] font-medium">
                      This one is marked
                    </span>
                  ) : null}
                </div>

                <p
                  className={`mt-1 text-[13px] ${a.isLate ? 'text-rust' : 'text-ink-soft'}`}
                >
                  {a.isLate ? 'Late · ' : ''}
                  {formatDateTime(a.submittedAt, timeZone)}
                </p>

                <ul className="mt-2 space-y-1.5">
                  {a.items.map((item) => (
                    <li key={item.id} className="text-[13.5px]">
                      {item.kind === 'file' && item.downloadUrl ? (
                        <a
                          href={item.downloadUrl}
                          className="text-ink-muted hover:text-ink underline underline-offset-4"
                        >
                          {item.fileName ?? 'File'}
                        </a>
                      ) : item.kind === 'file' ? (
                        <span className="text-ink-soft">
                          {item.fileName ?? 'File'}
                        </span>
                      ) : item.kind === 'link' ? (
                        <a
                          href={item.url ?? '#'}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="text-ink-muted hover:text-ink break-all underline underline-offset-4"
                        >
                          {item.url}
                        </a>
                      ) : (
                        <p className="text-ink-soft whitespace-pre-wrap">
                          {item.textBody}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      </Card>

      {/* The rule, in plain words, so nobody has to infer it from the button. */}
      <p className="text-ink-soft mt-2.5 px-1 text-[12.5px] leading-relaxed">
        {allowMultiple
          ? `${professorName ?? 'Your professor'} allows more than one submission. The newest one is marked.`
          : 'This assignment takes one submission only.'}
      </p>
    </section>
  );
}
