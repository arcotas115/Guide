/**
 * The late penalty — SHOWN, never applied. Settled 2 August 2026.
 *
 * SPEC.md carried this open from 1A: does SpeedGrader auto-reduce a saved mark,
 * or show the deduction as a suggestion the professor accepts?
 *
 * DECIDED: show it and stop. The screen states the arithmetic — "2 days late ·
 * 10% suggested" — and the professor types whatever number they mean.
 *
 * The reasoning:
 *   * Silently altering a professor's mark is exactly the kind of thing that
 *     costs their trust, and their trust IS the product. A number they did not
 *     type appearing against a student's name is the worst version of that.
 *   * It matches the principle already governing team-set locking in SPEC §3.6
 *     — "the app only flags. Professor decides."
 *   * A professor waiving the penalty for a student whose laptop died just
 *     types the number. There is no override UI to design, no audit question
 *     about who overrode what, and no second code path.
 *
 * NOTHING IN THIS FILE COMPUTES WITH A GRADE. Every value here is text.
 */

export type PenaltySuggestion = {
  /** Whole days late, rounded UP — see below. */
  daysLate: number;
  /** The suggested deduction, capped at 100. */
  suggestedPct: number;
  /** How late it actually was, in the largest sensible unit. */
  elapsedLabel: string;
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * ANY PART OF A DAY COUNTS AS A DAY.
 *
 * One hour late on a 5%/day assignment suggests 5%, not 0.2%. That is what "a
 * day late" conventionally means, and rounding down would make the entire first
 * day free — which is the opposite of what a deadline is for.
 *
 * The elapsed time is shown ALONGSIDE the suggestion precisely because this
 * rounding is harsh at the edges: "1 hour late · 5% suggested" lets a professor
 * see the harshness and decide it is too much. Hiding the hour and showing only
 * "1 day late" would make the same number look inarguable.
 */
export function penaltyFor(
  submittedAt: Date,
  dueAt: Date,
  pctPerDay: number,
): PenaltySuggestion | null {
  const overdueBy = submittedAt.getTime() - dueAt.getTime();
  if (overdueBy <= 0) return null;
  if (pctPerDay <= 0) return null;

  const daysLate = Math.ceil(overdueBy / DAY);

  return {
    daysLate,
    // A deduction over 100% is not a deduction, it is a fine.
    suggestedPct: Math.min(100, Math.round(daysLate * pctPerDay * 100) / 100),
    elapsedLabel: elapsed(overdueBy),
  };
}

/** "40 minutes", "1 hour", "3 days" — the largest unit that is still honest. */
function elapsed(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return plural(minutes, 'minute');

  const hours = Math.round(ms / HOUR);
  if (hours < 24) return plural(Math.max(1, hours), 'hour');

  // Floor here, not ceil: this describes what HAPPENED, while daysLate
  // describes what is CHARGED. "1 hour late · 5% suggested" is the pair that
  // makes the rounding visible, and it only works if the two disagree.
  const days = Math.max(1, Math.floor(ms / DAY));
  return plural(days, 'day');
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** The whole line, ready to render: "1 hour late · 5% suggested". */
export function penaltyLabel(p: PenaltySuggestion): string {
  return `${p.elapsedLabel} late · ${p.suggestedPct}% suggested`;
}
