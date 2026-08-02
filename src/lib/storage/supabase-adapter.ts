import 'server-only';
import { createClient } from '@/lib/supabase/server';
import {
  SUBMISSIONS_BUCKET,
  buildSubmissionPath,
  canRenderInline,
  type StorageAdapter,
} from '@/lib/storage';

/**
 * The Supabase implementation of the storage adapter — currently the only one.
 *
 * Everything Supabase-specific about storage lives here. Swapping to
 * institution-provided storage means writing a sibling of this file and
 * changing one factory call, rather than finding every component that reached
 * for `supabase.storage`.
 */
export async function getStorageAdapter(): Promise<StorageAdapter> {
  const supabase = await createClient();

  return {
    buildPath: buildSubmissionPath,

    async signedDownloadUrl(path, fileName) {
      // `download` sets Content-Disposition: attachment. Anything not on the
      // inline-safe list is forced to download rather than rendered, so a
      // student's evil.html cannot execute in a professor's session when they
      // click "view" in SpeedGrader. See the note in ./index.ts.
      const contentType = guessContentType(fileName);
      const { data, error } = await supabase.storage
        .from(SUBMISSIONS_BUCKET)
        .createSignedUrl(path, 60 * 10, {
          download: canRenderInline(contentType) ? undefined : fileName,
        });

      if (error || !data) return null;
      return data.signedUrl;
    },

    async remove(paths) {
      if (paths.length === 0) return;
      await supabase.storage.from(SUBMISSIONS_BUCKET).remove(paths);
    },
  };
}

/**
 * Content type from the extension.
 *
 * The browser's reported MIME type is not used, because it is chosen by the
 * uploader — and this decides whether something may render inline. An extension
 * is at least the thing the professor sees before they click.
 */
function guessContentType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    txt: 'text/plain',
  };
  return map[ext] ?? 'application/octet-stream';
}
