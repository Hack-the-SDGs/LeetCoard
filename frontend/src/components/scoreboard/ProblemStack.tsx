import { useState } from "react";
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
 * Open problems in full, closed ones folded to a line.
 *
 * A session accumulates closed problems, and a board that gave each of them a
 * full percentile track would push the live one off the screen within the hour.
 * Folding keeps the result — who solved it, who was fastest — one click from
 * the surface without spending the height.
 */
export default function ProblemStack({ problems, colors }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (slug: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });

  const ordered = [...problems].sort((a, b) => {
    if (a.is_open !== b.is_open) return a.is_open ? -1 : 1;
    return a.order - b.order;
  });
  const openCount = ordered.filter((p) => p.is_open).length;

  return (
    <section className="flex min-h-0 flex-col bg-ink-950">
      <div className="rule-b flex items-baseline justify-between px-4 py-1.5">
        <h2 className="font-mono text-[10px] tracking-label text-paper-dim">題目</h2>
        <span className="tnum font-mono text-[10px] text-paper-faint">
          {openCount} / {ordered.length} 開放
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {ordered.length === 0 ? (
          <p className="px-5 py-16 text-center text-[14px] text-paper-faint">
            等待老師開放第一題。
          </p>
        ) : (
          ordered.map((problem) =>
            problem.is_open ? (
              <motion.article
                key={problem.title_slug}
                layout
                transition={SETTLE}
                className="rule-b px-4 py-2.5"
                style={{ borderLeft: "2px solid #F2EFE9" }}
              >
                <Heading problem={problem} />
                <PercentileTrack solvers={problem.solvers} colors={colors} dimmed={false} />
              </motion.article>
            ) : (
              <motion.article
                key={problem.title_slug}
                layout
                transition={SETTLE}
                className="rule-b px-4 py-2"
                style={{ borderLeft: "2px solid transparent" }}
              >
                <button
                  type="button"
                  onClick={() => toggle(problem.title_slug)}
                  aria-expanded={expanded.has(problem.title_slug)}
                  className="flex w-full items-baseline gap-3 text-left"
                >
                  <Heading problem={problem} compact summary={<Summary problem={problem} />} />
                </button>
                {expanded.has(problem.title_slug) && (
                  <PercentileTrack solvers={problem.solvers} colors={colors} dimmed />
                )}
              </motion.article>
            ),
          )
        )}
      </div>
    </section>
  );
}

function Heading({
  problem,
  compact,
  summary,
}: {
  problem: ProblemPayload;
  compact?: boolean;
  summary?: React.ReactNode;
}) {
  return (
    <div className="flex w-full items-baseline gap-2.5">
      {/* Fixed width so #1 and #1768 put their titles on the same x. */}
      <span className="tnum w-[44px] shrink-0 text-right font-mono text-[12px] text-paper-faint">
        #{problem.frontend_id ?? "—"}
      </span>
      <h3
        className={
          "shrink-0 truncate font-display font-bold leading-none " +
          (compact ? "text-[16px] text-paper-dim" : "text-[20px] text-paper")
        }
      >
        {problem.title ?? problem.title_slug}
      </h3>
      <DifficultyMark difficulty={problem.difficulty} />
      {compact && (
        <span className="shrink-0 font-mono text-[9px] tracking-label text-paper-faint">已關閉</span>
      )}
      {summary}
      <span className="tnum ml-auto shrink-0 font-display text-[15px] font-bold leading-none">
        {problem.points}
        <span className="ml-1 font-mono text-[9px] font-normal text-paper-faint">PT</span>
      </span>
    </div>
  );
}

function Summary({ problem }: { problem: ProblemPayload }) {
  const best = problem.solvers.find((s) => s.beat_pct != null);
  return (
    <span className="min-w-0 truncate text-[11px] text-paper-faint">
      <span className="tnum">{problem.solvers.length}</span> 人解出
      {best && (
        <>
          <span className="mx-1.5">·</span>
          最快 <span className="font-bold text-paper-dim">{best.nickname}</span>{" "}
          <span className="tnum font-mono">{(best.beat_pct as number).toFixed(1)}</span>
        </>
      )}
    </span>
  );
}
