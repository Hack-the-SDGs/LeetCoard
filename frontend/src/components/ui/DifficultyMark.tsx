import type { Difficulty } from "../../lib/types";

const LABEL: Record<Difficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

/**
 * Difficulty by weight, not by hue: plain, outlined, filled.
 *
 * Fixed width on purpose. "Easy" and "Medium" are different lengths, and left
 * to size themselves they shove everything after them to a different x on every
 * row. Colour is not an option either — it would compete with the six team
 * colours and collapse for anyone with red-green colour blindness.
 *
 * The public board does not show difficulty at all; this is for the console,
 * where problems sit in a column and alignment is what makes them scannable.
 */
export default function DifficultyMark({ difficulty }: { difficulty: Difficulty }) {
  const base =
    "inline-flex w-[58px] shrink-0 justify-center py-px font-mono text-[10px] font-bold uppercase tracking-[0.12em]";
  if (difficulty === "hard") {
    return <span className={`${base} bg-paper text-ink-950`}>{LABEL.hard}</span>;
  }
  if (difficulty === "medium") {
    return <span className={`${base} border border-paper text-paper`}>{LABEL.medium}</span>;
  }
  return <span className={`${base} border border-transparent text-paper-dim`}>{LABEL.easy}</span>;
}
