import { motion } from "framer-motion";
import type { GroupStanding } from "../../lib/types";

interface Props {
  standings: GroupStanding[];
  connected: boolean;
  openCount: number;
}

const SETTLE = { type: "tween", ease: [0.2, 0, 0, 1], duration: 0.42 } as const;

/**
 * Team standings across the top, ordered by score.
 *
 * This is the one place on the board where things move sideways. A team taking
 * the lead slides past the one it overtook, which is the whole point of having
 * teams at all — it is visible from the back of the room without reading a
 * single number.
 */
export default function TeamBar({ standings, connected, openCount }: Props) {
  return (
    <header className="rule-b flex items-stretch gap-8 bg-ink-900 px-6 py-3">
      <div className="flex shrink-0 flex-col justify-center">
        <span className="font-display text-[22px] font-bold leading-none tracking-label">
          LEETCOARD
        </span>
        <span className="mt-1 font-mono text-[9px] tracking-label text-paper-faint">課堂練習</span>
      </div>

      <div className="flex min-w-0 flex-1 items-stretch">
        {standings.map((team) => {
          const leading = team.rank === 1 && team.score > 0;
          return (
            <motion.div
              key={team.group_id}
              layout
              transition={SETTLE}
              className="flex min-w-0 flex-1 flex-col gap-1.5 px-3"
            >
              <span
                className="h-[2px] w-full"
                style={{ background: team.color, opacity: leading ? 1 : 0.35 }}
              />
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-[10px] tabular-nums text-paper-faint">
                  {String(team.rank).padStart(2, "0")}
                </span>
                <span
                  className={
                    "truncate text-[13px] font-bold " + (leading ? "text-paper" : "text-paper-dim")
                  }
                >
                  {team.name}
                </span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="tnum font-display text-[28px] font-bold leading-none">
                  {team.score}
                </span>
                <span className="tnum font-mono text-[9px] text-paper-faint">
                  {team.member_count} 人
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>

      <div className="flex shrink-0 flex-col items-end justify-center gap-1.5">
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2"
            style={{
              background: connected ? "#F2EFE9" : "transparent",
              boxShadow: `inset 0 0 0 1px ${connected ? "#F2EFE9" : "#5C646A"}`,
            }}
          />
          <span
            className={
              "font-mono text-[10px] tracking-label " +
              (connected ? "text-paper" : "text-paper-faint")
            }
          >
            {connected ? "LIVE" : "離線"}
          </span>
        </div>
        <span className="tnum font-mono text-[10px] text-paper-faint">
          {openCount} 題開放中
        </span>
      </div>
    </header>
  );
}
