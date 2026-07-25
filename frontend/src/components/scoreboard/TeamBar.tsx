import { motion } from "framer-motion";
import Avatar from "../ui/Avatar";
import type { GroupStanding, TopMember } from "../../lib/types";

interface Props {
  standings: GroupStanding[];
  connected: boolean;
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
export default function TeamBar({ standings, connected }: Props) {
  return (
    <header className="rule-b relative z-30 flex items-stretch gap-8 bg-ink-900 px-5 py-2.5">
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
                <span className="tnum font-mono text-[10px] tabular-nums text-paper-faint">
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
              <div className="flex items-end justify-between gap-2">
                <span className="tnum font-display text-[28px] font-bold leading-none">
                  {team.score}
                </span>
                {/* Below xl a team slot is narrower than score + three
                    portraits, and they start overlapping the next team. */}
                <div className="hidden items-center gap-1 pb-[3px] xl:flex">
                  {team.top_members.map((member) => (
                    <Contributor key={member.username} member={member} color={team.color} />
                  ))}
                </div>
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
      </div>
    </header>
  );
}

/**
 * One of the three who carried the team.
 *
 * The name only appears on hover: six teams share the header, so three labelled
 * portraits each would leave no room for the score they are there to explain.
 */
function Contributor({ member, color }: { member: TopMember; color: string }) {
  return (
    <span className="group relative flex">
      <Avatar nickname={member.nickname} avatarUrl={member.avatar_url} color={color} size={22} />
      <span className="pointer-events-none absolute left-1/2 top-full z-40 mt-1.5 hidden -translate-x-1/2 whitespace-nowrap border border-ink-600 bg-ink-800 px-2 py-1 group-hover:block">
        <span className="text-[12px] font-bold">{member.nickname}</span>
        <span className="tnum ml-1.5 font-mono text-[11px] text-paper-faint">{member.score}</span>
      </span>
    </span>
  );
}
