import { motion } from "framer-motion";
import DifficultyMark from "../ui/DifficultyMark";
import PercentileTrack from "./PercentileTrack";
import type { TeamColors } from "../../lib/color";
import type { ProblemPayload } from "../../lib/types";

interface Props {
  problems: ProblemPayload[];
  colors: TeamColors;
}

const SETTLE = { type: "tween", ease: [0.2, 0, 0, 1], duration: 0.42 } as const;

/**
 * Open problems first, then the ones already covered.
 *
 * A closed problem keeps its card and its results — closing is how the teacher
 * moves on, not how anyone's work disappears.
 */
export default function ProblemStack({ problems, colors }: Props) {
  const ordered = [...problems].sort((a, b) => {
    if (a.is_open !== b.is_open) return a.is_open ? -1 : 1;
    return a.order - b.order;
  });

  return (
    <section className="flex min-h-0 flex-col bg-ink-950">
      <div className="rule-b flex items-baseline justify-between px-5 py-2">
        <h2 className="font-mono text-[10px] tracking-label text-paper-dim">題目</h2>
        <span className="tnum font-mono text-[10px] text-paper-faint">
          {ordered.filter((p) => p.is_open).length} / {ordered.length} 開放
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {ordered.length === 0 ? (
          <p className="px-5 py-16 text-center text-[14px] text-paper-faint">
            等待老師開放第一題。
          </p>
        ) : (
          ordered.map((problem) => (
            <motion.article
              key={problem.title_slug}
              layout
              transition={SETTLE}
              className="rule-b px-5 py-4"
              style={{
                borderLeft: `2px solid ${problem.is_open ? "#F2EFE9" : "transparent"}`,
              }}
            >
              <div className="flex items-baseline gap-3">
                <span className="tnum font-mono text-[11px] text-paper-faint">
                  #{problem.frontend_id ?? "—"}
                </span>
                <h3
                  className={
                    "truncate font-display text-[24px] font-bold leading-none " +
                    (problem.is_open ? "text-paper" : "text-paper-dim")
                  }
                >
                  {problem.title ?? problem.title_slug}
                </h3>
                <DifficultyMark difficulty={problem.difficulty} />
                {!problem.is_open && (
                  <span className="font-mono text-[9px] tracking-label text-paper-faint">
                    已關閉
                  </span>
                )}
                <span className="tnum ml-auto shrink-0 font-display text-[17px] font-bold leading-none">
                  {problem.points}
                  <span className="ml-1 font-mono text-[9px] font-normal text-paper-faint">PT</span>
                </span>
              </div>

              <PercentileTrack
                solvers={problem.solvers}
                colors={colors}
                dimmed={!problem.is_open}
              />
            </motion.article>
          ))
        )}
      </div>
    </section>
  );
}
