import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { CurrentProfile } from '@/lib/auth';
import { getStorageAdapter } from '@/lib/storage/supabase-adapter';

export type AttemptItem = {
  id: string;
  kind: 'file' | 'link' | 'text';
  fileName: string | null;
  url: string | null;
  textBody: string | null;
  storagePath: string | null;
  /** Minted per request and short-lived; never stored. */
  downloadUrl: string | null;
};

export type Attempt = {
  attempt: number;
  submittedAt: Date;
  /**
   * DERIVED against the assignment's CURRENT due_at, never stored. Extending a
   * deadline makes past work read as on time with no write at all — which is
   * what the prototype's announcement copy promises.
   */
  isLate: boolean;
  items: AttemptItem[];
};

export type StudentSubmission = {
  id: string;
  latestAttempt: number;
  attempts: Attempt[];
};

type Row = {
  id: string;
  latest_attempt: number;
  submission_attempts: Array<{ attempt: number; submitted_at: string }> | null;
  submission_files: Array<{
    id: string;
    attempt: number;
    kind: 'file' | 'link' | 'text';
    file_name: string | null;
    url: string | null;
    text_body: string | null;
    storage_path: string | null;
  }> | null;
};

/**
 * The caller's own submission for one assignment, with every attempt.
 *
 * RLS does the scoping: submissions, submission_attempts and submission_files
 * all return only the caller's own rows (or their team's), so there is no
 * student_id filter below and no way for one to be forgotten.
 */
export async function getSubmissionForStudent(
  profile: CurrentProfile,
  assignmentId: string,
  dueAt: Date,
): Promise<StudentSubmission | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('submissions')
    .select(
      `id, latest_attempt,
       submission_attempts ( attempt, submitted_at ),
       submission_files ( id, attempt, kind, file_name, url, text_body, storage_path )`,
    )
    .eq('institution_id', profile.institutionId)
    .eq('assignment_id', assignmentId)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as unknown as Row;

  const storage = await getStorageAdapter();
  const files = row.submission_files ?? [];

  const attempts: Attempt[] = await Promise.all(
    (row.submission_attempts ?? [])
      .slice()
      .sort((a, b) => b.attempt - a.attempt)
      .map(async (a) => {
        const submittedAt = new Date(a.submitted_at);
        return {
          attempt: a.attempt,
          submittedAt,
          isLate: submittedAt > dueAt,
          items: await Promise.all(
            files
              .filter((f) => f.attempt === a.attempt)
              .map(async (f) => ({
                id: f.id,
                kind: f.kind,
                fileName: f.file_name,
                url: f.url,
                textBody: f.text_body,
                storagePath: f.storage_path,
                downloadUrl:
                  f.kind === 'file' && f.storage_path
                    ? await storage.signedDownloadUrl(
                        f.storage_path,
                        f.file_name ?? 'file',
                      )
                    : null,
              })),
          ),
        };
      }),
  );

  return { id: row.id, latestAttempt: row.latest_attempt, attempts };
}
