import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import ProblemPodium from "./ProblemPodium";
import { teamColor, type TeamColors } from "../../lib/color";
import { problemUrl } from "../../lib/leetcode";
import type { ProblemPayload } from "../../lib/types";

interface Props {
  problems: ProblemPayload[];
  colors: TeamColors;
}

const SETTLE = { type: "tween", ease: [0.2, 0, 0, 1], duration: 0.42 } as const;
const REVEAL = { type: "tween", ease: [0.2, 0, 0, 1], duration: 0.34 } as const;

/**
 * Open problems in full, closed ones folded to a line.
 *
 * A session accumulates closed problems, and a board that gave each of them a
 * full podium would push the live one off the screen within the hour. The
 * folded corner keeps the one thing worth carrying across the fold: whose team
 * is on top of it.
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
      <div className="rule-b flex items-baseline justify-between px-5 py-1.5">
        <h2 className="font-mono text-[10px] tracking-label text-paper-dim">題目</h2>
        <span className="tnum font-mono text-[10px] text-paper-faint">
          {openCount} / {ordered.length} 開放
        </span>
      </div>

      {/* layoutScroll: framer measures in viewport coordinates, so without this
          a scroll here reads as "every card moved" and it animates them back —
          which also drags on unrelated layout components elsewhere. */}
      <motion.div layoutScroll className="min-h-0 flex-1 overflow-y-auto">
        {ordered.length === 0 ? (
          <p className="px-5 py-16 text-center text-[14px] text-paper-faint">
            等待老師開放第一題。
          </p>
        ) : (
          ordered.map((problem) => (
            <ProblemCard
              key={problem.title_slug}
              problem={problem}
              colors={colors}
              expanded={expanded.has(problem.title_slug)}
              onToggle={() => toggle(problem.title_slug)}
            />
          ))
        )}
      </motion.div>
    </section>
  );
}

function ProblemCard({
  problem,
  colors,
  expanded,
  onToggle,
}: {
  problem: ProblemPayload;
  colors: TeamColors;
  expanded: boolean;
  onToggle: () => void;
}) {
  const leader = problem.solvers.find((s) => s.beat_pct != null) ?? problem.solvers[0];
  const leaderColor = leader ? teamColor(leader.group_id, colors) : null;
  const showPodium = problem.is_open || expanded;

  const heading = <Heading problem={problem} compact={!problem.is_open} />;

  return (
    <motion.article
      // "position" only: animating size as well makes framer scale the card,
      // which stretches the text inside it while a panel opens.
      layout="position"
      transition={SETTLE}
      className={"rule-b relative " + (problem.is_open ? "px-5 py-3.5" : "px-5 py-2")}
      style={{ borderLeft: `2px solid ${problem.is_open ? "#F2EFE9" : "transparent"}` }}
    >
      {leaderColor && <LeaderFold color={leaderColor} />}

      {/* A closed card toggles from anywhere on the row, but the title is a link
          to the problem, so the toggle sits underneath rather than wrapping it —
          an <a> inside a <button> is neither valid nor keyboard-reachable. */}
      {!problem.is_open && (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={`展開 ${problem.title ?? problem.title_slug}`}
          className="absolute inset-0 z-0"
        />
      )}
      {heading}

      <AnimatePresence initial={false}>
        {showPodium && (
          <motion.div
            key="podium"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={REVEAL}
            className="overflow-hidden"
          >
            <div className="pt-3">
              <ProblemPodium
                solvers={problem.solvers}
                colors={colors}
                dimmed={!problem.is_open}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}

/** Folded corner in the leading team's colour — the one signal that survives
 *  the card being collapsed. */
function LeaderFold({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="absolute right-0 top-0 h-0 w-0"
      style={{
        borderLeft: "16px solid transparent",
        borderTop: `16px solid ${color}`,
      }}
    />
  );
}

function Heading({ problem, compact }: { problem: ProblemPayload; compact?: boolean }) {
  return (
    // Transparent to the pointer so a click anywhere but the title reaches the
    // expand button behind it; the title itself takes its clicks back.
    <div className="pointer-events-none relative z-10 flex w-full items-baseline gap-3 pr-6">
      {/* Fixed width so #1 and #1768 put their titles on the same x. */}
      <span className="tnum w-[44px] shrink-0 text-right font-mono text-[12px] text-paper-faint">
        #{problem.frontend_id ?? "—"}
      </span>
      {/* leading-tight, not leading-none: `truncate` clips a line box that
          tight, and descenders on g/y/p lose their tails. */}
      <h3
        className={
          "min-w-0 shrink truncate font-display font-bold leading-tight " +
          (compact ? "text-[17px] text-paper-dim" : "text-[22px] text-paper")
        }
      >
        <a
          href={problemUrl(problem.title_slug)}
          target="_blank"
          rel="noopener noreferrer"
          title={`在 LeetCode 開啟 ${problem.title ?? problem.title_slug}`}
          className="pointer-events-auto decoration-1 underline-offset-4 hover:underline"
        >
          {problem.title ?? problem.title_slug}
        </a>
      </h3>
      <span className="shrink-0 whitespace-nowrap text-[12px] leading-tight text-paper-faint">
        共 <span className="tnum font-bold text-paper-dim">{problem.solvers.length}</span> 人已解出
      </span>
      <span className="tnum ml-auto shrink-0 font-display text-[16px] font-bold leading-tight">
        {problem.points}
        <span className="ml-1 font-mono text-[9px] font-normal text-paper-faint">PT</span>
      </span>
    </div>
  );
}
