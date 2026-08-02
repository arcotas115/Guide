'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  SUBMISSIONS_BUCKET,
  buildSubmissionPath,
  checkCaps,
  formatBytes,
  MAX_FILE_BYTES,
} from '@/lib/storage';
import type { SubmissionItem } from '@/lib/submissions/schema';
import { Button } from '@/components/kit/button';
import { TextArea, TextInput } from '@/components/kit/form';
import { Card, Eyebrow } from '@/components/kit/surfaces';

type Draft =
  | { kind: 'file'; file: File }
  | { kind: 'link'; url: string }
  | { kind: 'text'; textBody: string };

/**
 * Hand work in.
 *
 * THE UPLOAD GOES CLIENT-DIRECT, with the student's own session, so RLS applies
 * and no file passes through the Next.js server. The storage policy is the
 * boundary. The server then re-validates that the recorded path matches the
 * assignment and the caller before writing the row — both, because the client
 * is what chooses the path.
 */
export function SubmitPanel({
  assignmentId,
  institutionId,
  ownerId,
  nextAttempt,
  accept,
  allowMultiple,
  hasSubmitted,
  onSubmit,
}: {
  assignmentId: string;
  institutionId: string;
  ownerId: string;
  /** The server's current count + 1. Only used to build a path — submit_attempt
   *  assigns the real number, and ignores anything the client says. */
  nextAttempt: number;
  accept: { file: boolean; link: boolean; text: boolean };
  allowMultiple: boolean;
  hasSubmitted: boolean;
  onSubmit: (input: unknown) => Promise<{ ok: boolean; error: string | null }>;
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const files = drafts.filter((d): d is { kind: 'file'; file: File } => d.kind === 'file');
  const nothingToSubmit = drafts.length === 0;

  const add = (d: Draft) => {
    setError(null);
    setDrafts((prev) => [...prev, d]);
  };
  const removeAt = (i: number) =>
    setDrafts((prev) => prev.filter((_, idx) => idx !== i));

  async function handleSubmit() {
    setError(null);

    const capError = checkCaps(files.map((f) => ({ name: f.file.name, size: f.file.size })));
    if (capError) {
      setError(capError);
      return;
    }

    const supabase = createClient();
    const items: SubmissionItem[] = [];

    try {
      for (const [i, draft] of drafts.entries()) {
        if (draft.kind === 'file') {
          setProgress(`Uploading ${draft.file.name}…`);
          const path = buildSubmissionPath({
            institutionId,
            assignmentId,
            ownerId,
            attempt: nextAttempt,
            fileName: draft.file.name,
          });
          const { error: upErr } = await supabase.storage
            .from(SUBMISSIONS_BUCKET)
            .upload(path, draft.file, { upsert: true });

          if (upErr) {
            // The storage policy refuses a closed assignment, so this is where
            // a missed deadline surfaces first. Say which file, not just "failed".
            throw new Error(
              `“${draft.file.name}” could not be uploaded. ${upErr.message}`,
            );
          }
          items.push({
            kind: 'file',
            storagePath: path,
            fileName: draft.file.name,
            sizeBytes: draft.file.size,
          });
        } else if (draft.kind === 'link') {
          items.push({ kind: 'link', url: draft.url });
        } else {
          items.push({ kind: 'text', textBody: draft.textBody });
        }
        void i;
      }

      setProgress('Recording your submission…');
      const result = await onSubmit({ assignmentId, items });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDrafts([]);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That could not be submitted.');
    } finally {
      setProgress(null);
    }
  }

  if (hasSubmitted && !allowMultiple) {
    return (
      <Card className="mt-6 px-4 py-4">
        <p className="text-ink-muted text-[13.5px] leading-relaxed">
          This assignment takes one submission only, and yours is in. Your
          professor has it.
        </p>
      </Card>
    );
  }

  return (
    <section className="mt-7">
      <Eyebrow>{hasSubmitted ? 'Submit another attempt' : 'Hand it in'}</Eyebrow>

      <Card className="mt-2.5 space-y-4 px-4 py-4">
        {drafts.length > 0 ? (
          <ul className="divide-card-border divide-y">
            {drafts.map((d, i) => (
              <li key={i} className="flex items-center gap-3 py-2.5 first:pt-0">
                <span className="text-ink min-w-0 flex-1 truncate text-[14px]">
                  {d.kind === 'file'
                    ? `${d.file.name} · ${formatBytes(d.file.size)}`
                    : d.kind === 'link'
                      ? d.url
                      : d.textBody.slice(0, 60) || 'Typed answer'}
                </span>
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  className="text-ink-soft hover:text-rust shrink-0 text-[12.5px] underline underline-offset-4"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {accept.file ? (
            <label className="border-card-border bg-canvas text-ink-muted hover:border-ink-soft cursor-pointer rounded-lg border px-3 py-2 text-[13.5px] transition-colors">
              Attach a file
              <input
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  for (const f of Array.from(e.target.files ?? [])) {
                    if (f.size > MAX_FILE_BYTES) {
                      setError(
                        `“${f.name}” is ${formatBytes(f.size)}. The limit is ${formatBytes(MAX_FILE_BYTES)} per file.`,
                      );
                      continue;
                    }
                    add({ kind: 'file', file: f });
                  }
                  e.target.value = '';
                }}
              />
            </label>
          ) : null}

          {accept.link ? (
            <button
              type="button"
              onClick={() => add({ kind: 'link', url: '' })}
              className="border-card-border bg-canvas text-ink-muted hover:border-ink-soft rounded-lg border px-3 py-2 text-[13.5px] transition-colors"
            >
              Add a link
            </button>
          ) : null}

          {accept.text ? (
            <button
              type="button"
              onClick={() => add({ kind: 'text', textBody: '' })}
              className="border-card-border bg-canvas text-ink-muted hover:border-ink-soft rounded-lg border px-3 py-2 text-[13.5px] transition-colors"
            >
              Type an answer
            </button>
          ) : null}
        </div>

        {drafts.map((d, i) =>
          d.kind === 'link' ? (
            <TextInput
              key={`link-${i}`}
              value={d.url}
              placeholder="https://…"
              onChange={(e) =>
                setDrafts((prev) =>
                  prev.map((x, idx) =>
                    idx === i ? { kind: 'link', url: e.target.value } : x,
                  ),
                )
              }
            />
          ) : d.kind === 'text' ? (
            <TextArea
              key={`text-${i}`}
              rows={6}
              value={d.textBody}
              placeholder="Type your answer…"
              onChange={(e) =>
                setDrafts((prev) =>
                  prev.map((x, idx) =>
                    idx === i ? { kind: 'text', textBody: e.target.value } : x,
                  ),
                )
              }
            />
          ) : null,
        )}

        {error ? (
          <p
            role="alert"
            className="bg-rust-bg text-rust-deep rounded-lg px-3 py-2.5 text-[13px] leading-relaxed"
          >
            {error}
          </p>
        ) : null}

        {progress ? (
          <p className="text-ink-soft text-[13px]">{progress}</p>
        ) : null}

        <Button
          type="button"
          size="lg"
          fullWidth
          disabled={pending || progress !== null}
          // Never a bare grey button — the reason it is unavailable is the
          // instruction for making it available (DESIGN.md §6).
          disabledReason={nothingToSubmit ? 'Add something to submit.' : null}
          onClick={() => void handleSubmit()}
        >
          {progress ? 'Submitting…' : hasSubmitted ? 'Submit another attempt' : 'Submit'}
        </Button>
      </Card>
    </section>
  );
}
