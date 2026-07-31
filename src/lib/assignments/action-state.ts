/**
 * What a write action hands back to the form.
 *
 * This lives here, and not in the actions file, because a `'use server'` module
 * may only export async functions — every export becomes a callable RPC
 * endpoint, so a plain object or constant is a build error. Keeping the shape
 * in a neutral module also means the client form imports a type from a normal
 * file rather than reaching into the server boundary.
 */
export type AssignmentActionState = {
  error: string | null;
  /** Keyed by form field, so the message lands next to the input that caused it. */
  fieldErrors: Record<string, string>;
};

export const emptyActionState: AssignmentActionState = {
  error: null,
  fieldErrors: {},
};
