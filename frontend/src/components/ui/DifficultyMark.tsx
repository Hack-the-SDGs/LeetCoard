import type { Difficulty } from "../../lib/types";

const BASE = "px-1.5 py-px font-mono text-[10px] font-bold uppercase tracking-label";

/**
 * Difficulty by weight, not by hue.
 *
 * Plain, outlined, filled — the mark gets heavier as the problem gets harder.
 * Colour would have to compete with the six team colours and would collapse
 * for anyone with red-green colour blindness, so it stays out of this.
 */
export default function DifficultyMark({ difficulty }: { difficulty: Difficulty }) {
  if (difficulty === "hard") {
    return <span className={`${BASE} bg-paper text-ink-950`}>Hard</span>;
  }
  if (difficulty === "medium") {
    return <span className={`${BASE} border border-paper text-paper`}>Medium</span>;
  }
  return <span className={`${BASE} text-paper-dim`}>Easy</span>;
}
