/**
 * The storage adapter.
 *
 * WHY AN INTERFACE RATHER THAN CALLING SUPABASE DIRECTLY.
 * Institution-provided storage is a real scale-stage lever: it moves the
 * largest cost onto storage a college already pays for, and "your files stay in
 * your own Drive" is a sentence that sells to a registrar. That option dies the
 * moment `supabase.storage` is called from twenty components — so it is called
 * from one place, behind this.
 *
 * Everything the app knows about storage is in this file and the adapter it
 * returns. FUTUREPROOFING item 5.
 */

/** The path convention. It IS the access-control rule — see 0010_storage.sql. */
export const SUBMISSIONS_BUCKET = 'submissions';

export type StorageItem = {
  /** Full object path, always {institution}/{assignment}/{owner}/{attempt}/{file}. */
  path: string;
  fileName: string;
  sizeBytes: number;
  contentType: string;
};

export type StorageAdapter = {
  /**
   * Where a file for this attempt must live. The ONE place the path is built,
   * so the convention cannot drift between the uploader and the validator.
   */
  buildPath(input: {
    institutionId: string;
    assignmentId: string;
    ownerId: string;
    attempt: number;
    fileName: string;
  }): string;

  /** A time-limited URL for reading one object. */
  signedDownloadUrl(path: string, fileName: string): Promise<string | null>;

  /**
   * Remove an object. Not used by the submit flow — nothing is deleted on
   * resubmit — but the orphan cleanup job described below will need it.
   */
  remove(paths: string[]): Promise<void>;
};

/* ---------------------------------------------------------------------------
 * Caps
 *
 * Enforced in three places, deliberately, because each catches what the others
 * cannot:
 *   the browser  — fast feedback, trivially bypassed
 *   the bucket   — the ONLY thing that sees actual bytes (file_size_limit)
 *   submit_attempt() — item count and the claimed total
 * ------------------------------------------------------------------------- */

/**
 * 50 MB per file. Handwritten work photographed on a phone runs 5–10 MB a page
 * and is the ordinary case in India, so a smaller cap would fail the normal
 * upload rather than the abusive one. Mirrors the bucket's file_size_limit —
 * the bucket is the authority; this exists to say so before the upload starts.
 */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** A 50 MB cap with unlimited files is not a cap. */
export const MAX_ATTEMPT_BYTES = 150 * 1024 * 1024;
export const MAX_ITEMS_PER_ATTEMPT = 20;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/**
 * Reject over-size naming BOTH the limit and the actual size — "too large" on
 * its own tells someone nothing about what to do next.
 */
export function checkCaps(files: { name: string; size: number }[]): string | null {
  if (files.length > MAX_ITEMS_PER_ATTEMPT) {
    return `An attempt can hold at most ${MAX_ITEMS_PER_ATTEMPT} items; this one has ${files.length}.`;
  }
  for (const f of files) {
    if (f.size > MAX_FILE_BYTES) {
      return `“${f.name}” is ${formatBytes(f.size)}. The limit is ${formatBytes(MAX_FILE_BYTES)} per file.`;
    }
  }
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_ATTEMPT_BYTES) {
    return `That attempt totals ${formatBytes(total)}. The limit is ${formatBytes(MAX_ATTEMPT_BYTES)} in one go.`;
  }
  return null;
}

/* ---------------------------------------------------------------------------
 * Inline rendering
 * ------------------------------------------------------------------------- */

/**
 * NEVER RENDER AN UNTRUSTED UPLOAD INLINE.
 *
 * SpeedGrader shows submissions inline in 1C. A student uploading `evil.html`
 * and a professor clicking "view" is script execution in the professor's
 * session, against the professor's cookies. Only these types may render; every
 * other type is forced to download by asking the signed URL for an attachment
 * disposition.
 *
 * Configured here, now, rather than remembered in 1C.
 */
const INLINE_SAFE = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'text/plain',
]);

export function canRenderInline(contentType: string): boolean {
  return INLINE_SAFE.has(contentType.split(';')[0]!.trim().toLowerCase());
}

/* ---------------------------------------------------------------------------
 * Path
 * ------------------------------------------------------------------------- */

/** Strip anything that could change the meaning of a path segment. */
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[/\\]/g, '-') // a slash would invent a folder level
    .replace(/\.\./g, '-') // and traversal is not a filename
    .replace(/[^\w.\- ]/g, '')
    .trim()
    .slice(0, 120);
  return cleaned || 'file';
}

export function buildSubmissionPath(input: {
  institutionId: string;
  assignmentId: string;
  ownerId: string;
  attempt: number;
  fileName: string;
}): string {
  return [
    input.institutionId,
    input.assignmentId,
    input.ownerId,
    String(input.attempt),
    safeFileName(input.fileName),
  ].join('/');
}

/**
 * Does this path say what the caller claims it says?
 *
 * The CLIENT chooses the path it uploads to, so the storage policy is the
 * boundary — but the server must re-check before recording a row, or a student
 * could upload to their own legitimate folder and then record it against
 * someone else's submission. Both, because they guard different things.
 */
export function pathMatches(
  path: string,
  expect: { institutionId: string; assignmentId: string; ownerId: string },
): boolean {
  const parts = path.split('/');
  // {institution}/{assignment}/{owner}/{attempt}/{filename} — five segments,
  // and the attempt is not checked here because the SERVER assigns it.
  if (parts.length !== 5) return false;
  return (
    parts[0] === expect.institutionId &&
    parts[1] === expect.assignmentId &&
    parts[2] === expect.ownerId &&
    /^\d+$/.test(parts[3] ?? '') &&
    (parts[4]?.length ?? 0) > 0
  );
}

/* ---------------------------------------------------------------------------
 * ORPHANED FILES — a known, accepted cost
 *
 * An upload that succeeds while the recording call fails leaves an object with
 * no row pointing at it. At pilot scale that is a handful of files, so it is
 * accepted rather than solved with a two-phase commit that would be more
 * failure-prone than the thing it prevents.
 *
 * The cleanup is a job for later, and it is easy because the path carries
 * everything needed: list objects under {institution}/, left-join
 * submission_files on storage_path, delete anything older than a day with no
 * row. Written down here so it is a scheduled task rather than a surprise on a
 * storage bill.
 * ------------------------------------------------------------------------- */
