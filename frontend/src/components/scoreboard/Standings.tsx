import { useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Avatar from "../ui/Avatar";
import { useAutoScroll } from "../../hooks/useAutoScroll";
import { teamColor, type TeamColors } from "../../lib/color";
import type { LeaderboardRow } from "../../lib/types";

interface Props {
  rows: LeaderboardRow[];
  colors: TeamColors;
  maxPoints: number;
}

/** Kept on screen at all times; everyone below this scrolls past on a loop. */
const PINNED = 5;

const SETTLE = { type: "tween", ease: [0.2, 0, 0, 1], duration: 0.36 } as const;

export default function Standings({ rows, colors, maxPoints }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = rows.slice(0, PINNED);
  const rest = rows.slice(PINNED);
  useAutoScroll(scrollRef, rest.length > 0);

  return (
    <section className="rule-r flex min-h-0 flex-col bg-ink-900">
      <div className="rule-b flex items-baseline justify-between px-3 py-2">
        <h2 className="font-mono text-[10px] tracking-label text-paper-dim">個人</h2>
        <span className="tnum font-mono text-[10px] text-paper-faint">{rows.length} 人</span>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-[13px] text-paper-faint">
          名單是空的。到控制台加入學員。
        </p>
      ) : (
        <>
          <div className="rule-b bg-ink-850">
            <AnimatePresence initial={false}>
              {pinned.map((row) => (
                <motion.div key={row.username} layout transition={SETTLE}>
                  <Row row={row} colors={colors} maxPoints={maxPoints} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          {/* Rows below the pinned block cross the boundary by fading rather
              than sliding — the drama belongs to the team bar, not here. */}
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
            <AnimatePresence initial={false}>
              {rest.map((row) => (
                <motion.div key={row.username} layout transition={SETTLE}>
                  <Row row={row} colors={colors} maxPoints={maxPoints} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </>
      )}
    </section>
  );
}

function Row({
  row,
  colors,
  maxPoints,
}: {
  row: LeaderboardRow;
  colors: TeamColors;
  maxPoints: number;
}) {
  const color = teamColor(row.group_id, colors);
  const ratio = maxPoints > 0 ? Math.min(1, row.score / maxPoints) : 0;

  return (
    <div className="grid grid-cols-[24px_auto_minmax(0,1fr)_42px] items-center gap-2.5 px-3 py-[7px]">
      <span className="tnum text-right font-display text-[15px] font-bold text-paper-dim">
        {row.rank}
      </span>
      <Avatar nickname={row.nickname} avatarUrl={row.avatar_url} color={color} size={24} />
      <div className="min-w-0">
        <div className="truncate text-[13px] font-bold leading-tight">{row.nickname}</div>
        <div className="mt-1 h-[3px] w-full bg-ink-700">
          <div
            className="h-full w-full origin-left transition-transform duration-500 ease-instrument"
            style={{ transform: `scaleX(${ratio})`, background: color }}
          />
        </div>
      </div>
      <span className="tnum text-right font-display text-[20px] font-bold leading-none">
        {row.score}
      </span>
    </div>
  );
}
