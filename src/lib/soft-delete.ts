/**
 * The soft-delete query helper.
 *
 * A `deleted_at` that queries forget to filter is WORSE than no `deleted_at`,
 * because it looks safe (DELETION_POLICY.md §6). RLS already hides deleted rows
 * from students — that is the security boundary and it does not depend on this
 * file. But staff can see hidden rows by design, so without a default filter a
 * professor's assignment list quietly grows the ones they deleted last week.
 *
 * So: reads go through `live()`, and seeing deleted rows is something a call
 * site asks for explicitly rather than something it gets by forgetting.
 */

/**
 * The shape of a Supabase/PostgREST filter builder. Structural rather than
 * imported, so this file has no dependency on the client and can be used with
 * any query builder that speaks `.is()`.
 */
type Filterable<Q> = { is(column: string, value: null): Q };

export type DeletedOption = {
  /**
   * Include soft-deleted rows. Only meaningful for staff — RLS refuses them to
   * everyone else regardless, so passing this on a student's query changes
   * nothing. Intended for a "recently deleted" view.
   */
  includeDeleted?: boolean;
};

/**
 * Restrict a query to rows that have not been soft-deleted.
 *
 *   const { data } = await live(
 *     supabase.from('assignments').select('*').eq('offering_id', id),
 *   );
 *
 * The generic keeps the builder's own type, so `.order()`, `.single()` and the
 * rest still chain afterwards.
 */
export function live<Q extends Filterable<Q>>(
  query: Q,
  options: DeletedOption = {},
): Q {
  return options.includeDeleted ? query : query.is('deleted_at', null);
}

/**
 * NOTE ON EMBEDDED RESOURCES. `live()` covers direct reads. It cannot cover an
 * EMBEDDED one — `courses(...)` inside a select on `enrolments` comes back
 * whether or not the course is deleted, and PostgREST cannot filter it without
 * a `!inner` hint that also changes the join's cardinality. Those are filtered
 * in TypeScript instead, in toOfferingSummary(), which is deterministic and
 * testable where a hint would be neither.
 */
