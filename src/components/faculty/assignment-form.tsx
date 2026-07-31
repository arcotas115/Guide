'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useForm, useWatch, Controller, type Control } from 'react-hook-form';
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import {
  assignmentFormSchema,
  toBoolean,
  type AssignmentFormValues,
  type AssignmentIntent,
} from '@/lib/assignments/schema';
import type { AssignmentActionState } from '@/lib/assignments/action-state';
import { Button } from '@/components/kit/button';
import { Field, FormPanel, TextInput, TextArea } from '@/components/kit/form';
import { ToggleRow, PillToggle } from '@/components/kit/toggle-row';
import { Card } from '@/components/kit/surfaces';

/**
 * Create and edit are the SAME form and the same schema — a second copy for
 * editing is how the two drift until a rule holds on create but not on save.
 * The only differences are which action is called and what the copy says.
 */
export type AssignmentSubmit = (
  intent: AssignmentIntent,
  values: AssignmentFormValues,
) => Promise<AssignmentActionState>;

const PENALTY_PRESETS = [
  { value: '0', label: 'No penalty' },
  { value: '5', label: '5%/day' },
  { value: '10', label: '10%/day' },
  { value: '20', label: '20%/day' },
] as const;

export function AssignmentForm({
  offeringId,
  defaultValues,
  onSubmit,
  mode,
  status = 'draft',
}: {
  offeringId: string;
  defaultValues: AssignmentFormValues;
  onSubmit: AssignmentSubmit;
  mode: 'create' | 'edit';
  /** The assignment's current lifecycle. Drives the copy, nothing else. */
  status?: 'draft' | 'open' | 'closed';
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
  // whole component. useWatch subscribes to just these fields.
  // These read the form's INPUT shape, where a toggle may legitimately be a
  // boolean, "on", or 1 — so they go through the same coercion the schema uses
  // rather than a bare truthiness test, under which the string "false" is true.
  const allowLate = toBoolean(useWatch({ control, name: 'allowLate' }), true);
  const penalty = useWatch({ control, name: 'latePenaltyPctPerDay' });
  const acceptFile = toBoolean(useWatch({ control, name: 'acceptFile' }), true);
  const acceptLink = toBoolean(useWatch({ control, name: 'acceptLink' }), true);
  const acceptText = toBoolean(useWatch({ control, name: 'acceptText' }), true);

  const nothingToSubmit = !acceptFile && !acceptLink && !acceptText;

  // A published assignment is already visible; telling its author that students
  // will see it "the moment you publish" is create-copy leaking into the edit
  // path. Each state gets its own sentence, and each one is true.
  const subtitle =
    mode === 'create'
      ? 'Students see this the moment you publish it.'
      : status === 'draft'
        ? 'Still a draft. Students cannot see it yet.'
        : status === 'open'
          ? 'Live now. Changes reach students immediately.'
          : 'Closed. Students can still read it, but not submit.';

  const primaryLabel =
    mode === 'create' || status === 'draft'
      ? 'Publish to students'
      : 'Save changes';

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
    <form className="pb-28">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <h1 className="screen-title text-ink">
            {mode === 'create' ? 'New assignment' : 'Edit assignment'}
          </h1>
          <p className="text-subtle mt-2 text-[14px]">{subtitle}</p>
        </div>
        <Link
          href={`/faculty/courses/${offeringId}/assignments`}
          className="text-subtle hover:text-ink pt-2 text-[14px] transition-colors"
        >
          Cancel
        </Link>
      </div>

      {serverError ? (
        <p
          role="alert"
          className="bg-rust-bg text-rust-deep mt-6 rounded-lg px-4 py-3 text-[14px]"
        >
          {serverError}
        </p>
      ) : null}

      <div className="mt-8 grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_26rem]">
        {/* ---------------- Left: what the work actually is ---------------- */}
        <Card className="space-y-6 p-6">
          <Field label="Title" error={errors.title?.message} htmlFor="title">
            <TextInput
              id="title"
              placeholder="Lab 6 — Deadlock detection"
              {...register('title')}
            />
          </Field>

          <Field
            label="What students have to do"
            hint="Plain language. This is the whole brief for most of them."
            error={errors.instructions?.message}
            htmlFor="instructions"
          >
            <TextArea
              id="instructions"
              rows={11}
              placeholder="Implement a wait-for graph and detect cycles. Submit your source plus a one-page comparison of average waiting time."
              {...register('instructions')}
            />
          </Field>

          <div>
            <p className="text-ink text-[13.5px] font-medium">
              Files students can download
            </p>
            {/* Wired as a field, honest about being inert. An upload control
                that silently drops the file would be far worse. */}
            <div className="border-card-border bg-canvas text-subtle mt-2 rounded-lg border border-dashed px-4 py-7 text-center text-[13.5px] leading-relaxed">
              Attaching starter files arrives with submissions, in the next
              step.
              <br />
              Everything else on this page saves normally.
            </div>
          </div>
        </Card>

        {/* ---------------- Right: the rules ---------------- */}
        <div className="space-y-6">
          <FormPanel title="Marks and dates">
            <div className="grid grid-cols-2 gap-4">
              <Field
                label="Marks"
                error={errors.marks?.message}
                htmlFor="marks"
              >
                <TextInput
                  id="marks"
                  inputMode="decimal"
                  className="font-mono"
                  {...register('marks')}
                />
              </Field>

              <DateField
                control={control}
                name="opensAt"
                label="Opens"
                error={errors.opensAt?.message}
              />

              <DateField
                control={control}
                name="dueAt"
                label="Due"
                error={errors.dueAt?.message}
              />

              <DateField
                control={control}
                name="lateUntil"
                label="Late until"
                error={errors.lateUntil?.message}
                disabled={!allowLate}
              />
            </div>
            <p className="text-subtle text-[12.5px] leading-relaxed">
              Leave <span className="text-ink-muted">Opens</span> blank to make
              it available immediately.
              {allowLate
                ? ' A blank late-until means late work is accepted until you close it.'
                : ' Turn on “Accept late submissions” to set a late-until date.'}
            </p>
          </FormPanel>

          <FormPanel title="Rules">
            <Controller
              control={control}
              name="allowLate"
              render={({ field }) => (
                <ToggleRow
                  id="allowLate"
                  label="Accept late submissions"
                  hint="Students see “accepted till” on the assignment."
                  checked={toBoolean(field.value, false)}
                  onChange={(v) => {
                    field.onChange(v);
                    // Clearing the date on the way off keeps the form from
                    // holding a combination the database forbids.
                    if (!v) setValue('lateUntil', '');
                  }}
                />
              )}
            />

            <Controller
              control={control}
              name="hideNamesWhileGrading"
              render={({ field }) => (
                <ToggleRow
                  id="hideNamesWhileGrading"
                  label="Hide names while grading"
                  hint="You see roll numbers only until you save a mark."
                  checked={toBoolean(field.value, false)}
                  onChange={field.onChange}
                />
              )}
            />

            <div className={allowLate ? '' : 'opacity-45'}>
              <p className="text-ink text-[14.5px] leading-snug font-medium">
                Automatic penalty for late work
              </p>
              <p className="text-subtle mt-1 text-[12.5px] leading-relaxed">
                Stored with the assignment. Whether it is applied to a mark or
                only shown to you is decided when grading is built.
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {PENALTY_PRESETS.map((p) => (
                  <PillToggle
                    key={p.value}
                    label={p.label}
                    pressed={String(penalty) === p.value}
                    disabled={!allowLate}
                    size="compact"
                    onChange={() => setValue('latePenaltyPctPerDay', p.value)}
                  />
                ))}
              </div>

              <div className="mt-3 flex items-center gap-2">
                <TextInput
                  aria-label="Custom penalty percent per day"
                  inputMode="decimal"
                  disabled={!allowLate}
                  className="h-9 w-20 font-mono"
                  {...register('latePenaltyPctPerDay')}
                />
                <span className="text-subtle text-[12.5px]">% per day</span>
              </div>
              {errors.latePenaltyPctPerDay?.message ? (
                <p className="text-rust mt-1.5 text-[12.5px]">
                  {errors.latePenaltyPctPerDay.message}
                </p>
              ) : null}
            </div>

            <div>
              <p className="text-ink text-[14.5px] leading-snug font-medium">
                What they can submit
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Controller
                  control={control}
                  name="acceptFile"
                  render={({ field }) => (
                    <PillToggle
                      label="Files"
                      pressed={toBoolean(field.value, false)}
                      onChange={field.onChange}
                    />
                  )}
                />
                <Controller
                  control={control}
                  name="acceptLink"
                  render={({ field }) => (
                    <PillToggle
                      label="A link"
                      pressed={toBoolean(field.value, false)}
                      onChange={field.onChange}
                    />
                  )}
                />
                <Controller
                  control={control}
                  name="acceptText"
                  render={({ field }) => (
                    <PillToggle
                      label="Typed text"
                      pressed={toBoolean(field.value, false)}
                      onChange={field.onChange}
                    />
                  )}
                />
              </div>
              {errors.acceptFile?.message ? (
                <p className="text-rust mt-1.5 text-[12.5px]">
                  {errors.acceptFile.message}
                </p>
              ) : null}
            </div>
          </FormPanel>
        </div>
      </div>

      <div className="border-card-border bg-canvas/95 fixed inset-x-0 bottom-0 z-10 border-t backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-start justify-end gap-3 px-8 py-4">
          <Button
            type="button"
            variant="secondary"
            size="lg"
            disabled={pending}
            onClick={() => {
              void submitWith('draft')();
            }}
          >
            Save draft
          </Button>
          <Button
            type="button"
            size="lg"
            disabled={pending}
            // The disabled state says what is missing rather than greying out
            // and leaving the professor to guess (DESIGN.md §6).
            disabledReason={
              nothingToSubmit
                ? 'Pick at least one way for students to submit.'
                : null
            }
            onClick={() => {
              void submitWith('publish')();
            }}
          >
            {pending ? 'Saving…' : primaryLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}

/**
 * A datetime-local input bound explicitly to form state.
 *
 * CONTROLLED ON PURPOSE. `register` leaves the input uncontrolled, so whatever
 * the browser decides to put in a `datetime-local` is what the professor sees —
 * and an empty optional date must render EMPTY, because the helper text
 * promises exactly that ("Leave Opens blank to make it available immediately").
 * Binding `value` to the form state makes "the field is blank" and "the stored
 * value is null" the same thing by construction rather than by hope.
 */
function DateField({
  control,
  name,
  label,
  error,
  disabled = false,
}: {
  control: Control<AssignmentFormValues>;
  name: 'opensAt' | 'dueAt' | 'lateUntil';
  label: string;
  error?: string;
  disabled?: boolean;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Field label={label} error={error} htmlFor={name}>
          <TextInput
            id={name}
            type="datetime-local"
            disabled={disabled}
            name={field.name}
            ref={field.ref}
            onBlur={field.onBlur}
            // `?? ''` is the whole point: undefined would hand the input back
            // to the browser and make React stop controlling it.
            value={typeof field.value === 'string' ? field.value : ''}
            onChange={(e) => field.onChange(e.target.value)}
          />
        </Field>
      )}
    />
  );
}
