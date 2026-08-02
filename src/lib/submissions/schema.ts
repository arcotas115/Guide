import { z } from 'zod';
import { MAX_FILE_BYTES, MAX_ITEMS_PER_ATTEMPT } from '@/lib/storage';

/**
 * What a student may hand in. One schema, client and server, idempotent — the
 * same rule the assignment form learned the hard way in 1A-fix: react-hook-form
 * hands `handleSubmit` the schema's OUTPUT, which then travels to the server and
 * is parsed again, so `parse(parse(x))` must equal `parse(x)`.
 */

const fileItem = z.object({
  kind: z.literal('file'),
  /** Chosen by the CLIENT, so the server re-checks it against the caller. */
  storagePath: z.string().min(1, 'That file did not finish uploading.'),
  fileName: z.string().min(1).max(200),
  sizeBytes: z
    .number()
    .int()
    .nonnegative()
    .max(MAX_FILE_BYTES, 'That file is over the size limit.'),
});

const linkItem = z.object({
  kind: z.literal('link'),
  url: z
    .string()
    .trim()
    .min(1, 'Paste a link, or remove the empty one.')
    .refine(
      (v) => {
        try {
          const u = new URL(v);
          // http(s) only. A javascript: or data: URL rendered as a link in a
          // professor's SpeedGrader is the same script-execution problem as an
          // uploaded .html file.
          return u.protocol === 'http:' || u.protocol === 'https:';
        } catch {
          return false;
        }
      },
      { message: 'That does not look like a web address. It should start with https://' },
    ),
});

const textItem = z.object({
  kind: z.literal('text'),
  textBody: z
    .string()
    .trim()
    .min(1, 'Type an answer, or remove the empty box.')
    .max(50_000, 'That answer is too long to submit.'),
});

export const submissionItemSchema = z.discriminatedUnion('kind', [
  fileItem,
  linkItem,
  textItem,
]);

export type SubmissionItem = z.infer<typeof submissionItemSchema>;

export const submitPayloadSchema = z.object({
  assignmentId: z.string().uuid('That assignment could not be found.'),
  items: z
    .array(submissionItemSchema)
    .min(1, 'Add something to submit.')
    .max(
      MAX_ITEMS_PER_ATTEMPT,
      `An attempt can hold at most ${MAX_ITEMS_PER_ATTEMPT} items.`,
    ),
});

export type SubmitPayload = z.infer<typeof submitPayloadSchema>;

/** The shape submit_attempt() expects — snake_case, one object per item. */
export function toDbItems(items: SubmissionItem[]) {
  return items.map((i) => {
    switch (i.kind) {
      case 'file':
        return {
          kind: 'file',
          storage_path: i.storagePath,
          file_name: i.fileName,
          size_bytes: i.sizeBytes,
        };
      case 'link':
        return { kind: 'link', url: i.url };
      case 'text':
        return { kind: 'text', text_body: i.textBody };
    }
  });
}
