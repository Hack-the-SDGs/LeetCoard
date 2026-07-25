import type { ProblemPayload } from "./types";

/**
 * Everything currently on the board is worth this much.
 *
 * Only problems the teacher has opened count, which matches what the public
 * board shows. Opening a new problem therefore stretches the denominator and
 * shortens every progress bar at once — the room gets a fresh race rather than
 * a set of bars pinned to the left because eight problems are still hidden.
 */
export function maxAvailablePoints(problems: ProblemPayload[]): number {
  return problems.reduce((sum, p) => {
    const bestBonus = (p.beat_bonus_tiers ?? []).reduce(
      (best, tier) => Math.max(best, tier.bonus_pts),
      0,
    );
    return sum + p.points + bestBonus;
  }, 0);
}
