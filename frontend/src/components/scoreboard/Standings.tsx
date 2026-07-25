import { useEffect, useRef, useState } from "react";
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

/** Kept on screen at all times; everyone below this cycles or scrolls. */
const PINNED = 5;
const MODE_KEY = "leetcoard.standings-mode";
const SETTLE = { type: "tween", ease: [0.2, 0, 0, 1], duration: 0.36 } as const;

type Mode = "cycle" | "scroll";

function readMode(): Mode {
  return localStorage.getItem(MODE_KEY) === "scroll" ? "scroll" : "cycle";
}

export default function Standings({ rows, colors, maxPoints }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>(readMode);
  const pinned = rows.slice(0, PINNED);
  const rest = rows.slice(PINNED);

  useEffect(() => {
    localStorage.setItem(MODE_KEY, mode);
  }, [mode]);

  useAutoScroll(scrollRef, mode === "cycle" && rest.length > 0);

  return (
    <section className="rule-r flex min-h-0 flex-col bg-ink-900">
      <div className="rule-b flex items-center justify-between gap-2 px-3 py-1.5">
        <h2 className="font-mono text-[10px] tracking-label text-paper-dim">
          個人
          <span className="tnum ml-2 text-paper-faint">{rows.length}</span>
        </h2>
        <div className="flex items-center">
          <ModeButton current={mode} value="cycle" onSelect={setMode}>
            輪播
          </ModeButton>
          <ModeButton current={mode} value="scroll" onSelect={setMode}>
            捲動
          </ModeButton>
        </div>
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

function ModeButton({
  current,
  value,
  onSelect,
  children,
}: {
  current: Mode;
  value: Mode;
  onSelect: (m: Mode) => void;
  children: React.ReactNode;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onSelect(value)}
      className={
        "border px-1.5 py-[3px] font-mono text-[9px] tracking-label transition-colors " +
        (active
          ? "border-paper bg-paper text-ink-950"
          : "border-ink-700 text-paper-faint hover:text-paper")
      }
    >
      {children}
    </button>
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
    // 44px tall: twenty of these plus the header and the ticker is exactly a
    // 1080p column, so the twentieth row lands whole rather than half-cut.
    <div className="grid grid-cols-[22px_auto_minmax(0,1fr)_40px] items-center gap-2.5 px-3 py-2">
      <span className="tnum text-right font-display text-[17px] font-bold text-paper-dim">
        {row.rank}
      </span>
      <Avatar
        nickname={row.nickname}
        avatarUrl={row.avatar_url}
        color={color}
        size={28}
        profileFor={row.username}
      />
      <div className="min-w-0">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-[14px] font-bold leading-tight">{row.nickname}</span>
          <span className="truncate font-mono text-[10px] leading-tight text-paper-faint">
            {row.username}
          </span>
        </div>
        <div className="mt-[5px] h-[3px] w-full bg-ink-700">
          <div
            className="h-full w-full origin-left transition-transform duration-500 ease-instrument"
            style={{ transform: `scaleX(${ratio})`, background: color }}
          />
        </div>
      </div>
      <span className="tnum text-right font-display text-[22px] font-bold leading-none">
        {row.score}
      </span>
    </div>
  );
}
