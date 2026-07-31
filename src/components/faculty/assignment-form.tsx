'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useForm, useWatch, Controller } from 'react-hook-form';
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import {
  assignmentFormSchema,
  type AssignmentFormValues,
  type AssignmentIntent,
} from '@/lib/assignments/schema';
import type { AssignmentActionState } from '@/lib/assignments/action-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';

/**
 * Create and edit are the SAME form and the same schema — a second copy for
 * editing is how the two drift until a rule holds on create but not on save.
 * The only difference is which action gets called, passed in as a prop.
 */
export type AssignmentSubmit = (
  intent: AssignmentIntent,
  values: AssignmentFormValues,
) => Promise<AssignmentActionState>;

const PENALTY_PRESETS = [
  { value: '0', label: 'No penalty' },
  { value: '5', label: '5% / day' },
  { value: '10', label: '10% / day' },
  { value: '20', label: '20% / day' },
] as const;

export function AssignmentForm({
  offeringId,
  defaultValues,
  onSubmit,
  mode,
}: {
  offeringId: string;
  defaultValues: AssignmentFormValues;
  onSubmit: AssignmentSubmit;
  mode: 'create' | 'edit';
}) {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    formState: { errors },
  } = useForm<AssignmentFormValues>({
    // The SAME schema the server uses. Client validation here is a courtesy
    // that saves a round trip; the server's parse is the one that matters.
    resolver: standardSchemaResolver(assignmentFormSchema),
    defaultValues,
  });

  // useWatch, not watch(): watch() returns a fresh function each render, which
  // the React Compiler cannot memoize safely, so it bails out of optimising the
  // whole component. useWatch subscribes to just these two fields.
  const allowLate = useWatch({ control, name: 'allowLate' });
  const penalty = useWatch({ control, name: 'latePenaltyPctPerDay' });

  const submitWith = (intent: AssignmentIntent) =>
    handleSubmit((values) => {
      setServerError(null);
      startTransition(async () => {
        const result = await onSubmit(intent, values);
        // A successful action redirects and never returns, so anything here is
        // a rejection. Route each message back to its field where possible.
        if (result?.fieldErrors) {
          for (const [field, message] of Object.entries(result.fieldErrors)) {
            setError(field as keyof AssignmentFormValues, { message });
          }
        }
        if (result?.error) setServerError(result.error);
      });
    });

  return (
    <form className="pb-16">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-ink text-2xl font-semibold tracking-tight">
            {mode === 'create' ? 'New assignment' : 'Edit assignment'}
          </h1>
          <p className="text-subtle mt-1 text-sm">
            Students see this the moment you publish it.
          </p>
        </div>
        <Link
          href={`/faculty/courses/${offeringId}/assignments`}
          className="text-subtle hover:text-ink pt-2 text-sm transition-colors"
        >
          Cancel
        </Link>
      </div>

      {serverError ? (
        <p
          role="alert"
          className="bg-rust-tint text-rust-deep mt-6 rounded-lg px-4 py-3 text-sm"
        >
          {serverError}
        </p>
      ) : null}

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* ---------------- Left: what the work actually is ---------------- */}
        <div className="space-y-6">
          <Field label="Title" error={errors.title?.message} htmlFor="title">
            <Input
              id="title"
              placeholder="Lab 6 — Deadlock detection"
              className="h-11"
              {...register('title')}
            />
          </Field>

          <Field
            label="What students have to do"
            hint="Plain language. This is the whole brief for most of them."
            error={errors.instructions?.message}
            htmlFor="instructions"
          >
            <Textarea
              id="instructions"
              rows={10}
              placeholder="Implement a wait-for graph and detect cycles. Submit your source plus a one-page comparison."
              {...register('instructions')}
            />
          </Field>

          {/* Wired as a field, honest about being inert. Saying "coming with
              submissions" is better than a working-looking control that
              silently drops a file. */}
          <div>
            <p className="text-ink text-sm font-medium">
              Files students can download
            </p>
            <div className="border-hairline text-subtle mt-2 rounded-lg border border-dashed px-4 py-6 text-center text-sm">
              Attaching starter files arrives with submissions, in the next
              step. Everything else here saves normally.
            </div>
          </div>
        </div>

        {/* ---------------- Right: the rules ---------------- */}
        <div className="space-y-8">
          <Panel title="Marks and dates">
            <Field label="Marks" error={errors.marks?.message} htmlFor="marks">
              <Input
                id="marks"
                inputMode="decimal"
                className="h-10 font-mono"
                {...register('marks')}
              />
            </Field>

            <Field
              label="Opens"
              hint="Leave blank to make it available immediately."
              error={errors.opensAt?.message}
              htmlFor="opensAt"
            >
              <Input
                id="opensAt"
                type="datetime-local"
                className="h-10"
                {...register('opensAt')}
              />
            </Field>

            <Field label="Due" error={errors.dueAt?.message} htmlFor="dueAt">
              <Input
                id="dueAt"
                type="datetime-local"
                className="h-10"
                {...register('dueAt')}
              />
            </Field>

            <Field
              label="Late until"
              hint={
                allowLate
                  ? 'Blank means late work is accepted until you close it.'
                  : 'Turn on “Accept late submissions” to set this.'
              }
              error={errors.lateUntil?.message}
              htmlFor="lateUntil"
            >
              <Input
                id="lateUntil"
                type="datetime-local"
                className="h-10"
                disabled={!allowLate}
                {...register('lateUntil')}
              />
            </Field>
          </Panel>

          <Panel title="Rules">
            <Controller
              control={control}
              name="allowLate"
              render={({ field }) => (
                <ToggleRow
                  id="allowLate"
                  label="Accept late submissions"
                  checked={field.value ?? false}
                  onChange={(v) => {
                    field.onChange(v);
                    // Clearing the date on the way off keeps the form from
                    // holding a combination the database forbids.
                    if (!v) setValue('lateUntil', '');
                  }}
                />
              )}
            />

            <div className={allowLate ? '' : 'pointer-events-none opacity-45'}>
              <p className="text-ink text-sm font-medium">
                Automatic penalty for late work
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {PENALTY_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setValue('latePenaltyPctPerDay', p.value)}
                    className={
                      String(penalty) === p.value
                        ? 'bg-ink text-canvas rounded-full px-3 py-1.5 text-xs font-medium'
                        : 'text-ink-muted border-hairline hover:border-subtle rounded-full border px-3 py-1.5 text-xs transition-colors'
                    }
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Input
                  aria-label="Custom penalty percent per day"
                  inputMode="decimal"
                  className="h-9 w-20 font-mono"
                  {...register('latePenaltyPctPerDay')}
                />
                <span className="text-subtle text-xs">% per day</span>
              </div>
              {errors.latePenaltyPctPerDay?.message ? (
                <p className="text-rust mt-1.5 text-xs">
                  {errors.latePenaltyPctPerDay.message}
                </p>
              ) : null}
              <p className="text-faint mt-2 text-xs leading-relaxed">
                Stored with the assignment. Whether it is applied to a mark or
                only shown to you is decided when grading is built.
              </p>
            </div>

            <Controller
              control={control}
              name="hideNamesWhileGrading"
              render={({ field }) => (
                <ToggleRow
                  id="hideNamesWhileGrading"
                  label="Hide names while grading"
                  hint="You see roll numbers until a mark is saved."
                  checked={field.value ?? false}
                  onChange={field.onChange}
                />
              )}
            />

            <div>
              <p className="text-ink text-sm font-medium">
                What they can submit
              </p>
              <div className="mt-2 space-y-2">
                <CheckRow control={control} name="acceptFile" label="Files" />
                <CheckRow control={control} name="acceptLink" label="A link" />
                <CheckRow control={control} name="acceptText" label="Typed text" />
              </div>
              {errors.acceptFile?.message ? (
                <p className="text-rust mt-1.5 text-xs">
                  {errors.acceptFile.message}
                </p>
              ) : null}
            </div>
          </Panel>
        </div>
      </div>

      <div className="border-hairline bg-canvas/90 fixed inset-x-0 bottom-0 border-t backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-end gap-3 px-8 py-4">
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => {
              void submitWith('draft')();
            }}
          >
            Save draft
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() => {
              void submitWith('publish')();
            }}
          >
            {pending ? 'Saving…' : 'Publish to students'}
          </Button>
        </div>
      </div>
    </form>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-hairline bg-surface rounded-xl border p-5">
      <h2 className="text-ink-muted text-xs font-medium tracking-widest uppercase">
        {title}
      </h2>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor} className="text-ink text-sm font-medium">
        {label}
      </Label>
      <div className="mt-1.5">{children}</div>
      {error ? (
        <p className="text-rust mt-1.5 text-xs">{error}</p>
      ) : hint ? (
        <p className="text-faint mt-1.5 text-xs leading-relaxed">{hint}</p>
      ) : null}
    </div>
  );
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <Label htmlFor={id} className="text-ink text-sm font-medium">
          {label}
        </Label>
        {hint ? (
          <p className="text-faint mt-0.5 text-xs leading-relaxed">{hint}</p>
        ) : null}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function CheckRow({
  control,
  name,
  label,
}: {
  control: ReturnType<typeof useForm<AssignmentFormValues>>['control'];
  name: 'acceptFile' | 'acceptLink' | 'acceptText';
  label: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <div className="flex items-center gap-2.5">
          <Checkbox
            id={name}
            checked={field.value ?? false}
            onCheckedChange={(v) => field.onChange(v === true)}
          />
          <Label htmlFor={name} className="text-ink-muted text-sm font-normal">
            {label}
          </Label>
        </div>
      )}
    />
  );
}
