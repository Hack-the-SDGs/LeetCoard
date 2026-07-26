import { AnimatePresence, motion } from "framer-motion";
import Avatar from "../ui/Avatar";
import { teamColor, teamWash, type TeamColors } from "../../lib/color";
import type { SolverPayload } from "../../lib/types";

interface Props {
  solvers: SolverPayload[];
  colors: TeamColors;
  dimmed: boolean;
}

const PODIUM_SIZE = 3;
/** Portraits shown after the podium before the count takes over. */
const ROLL_SIZE = 26;
const SETTLE = { type: "tween", ease: [0.2, 0, 0, 1], duration: 0.45 } as const;

/**
 * Three faces, then a roll of portraits, over a distribution bar.
 *
 * Everything reads best-to-worst left to right: first place sits leftmost, the
 * roll continues in rank order, and the axis underneath runs 100 → 0 so the
 * fastest end of the field is on the same side as the winner. An axis climbing
 * the other way put first place above the "0" end, which is what made the old
 * layout feel wrong even when the numbers were right.
 */
export default function ProblemPodium({ solvers, colors, dimmed }: Props) {
  if (solvers.length === 0) {
    return <p className="py-3 text-[13px] text-paper-faint">還沒有人解出這題</p>;
  }

  const ranked = solvers.filter((s) => s.beat_pct != null);
  const hasSpread = ranked.length > 0;

  // Every solver is placed, including those with no percentile. Ranking only
  // the ones that have one erased anybody whose detail lookup was rate-limited
  // — they vanished from the podium, the roll and even the overflow count,
  // while the heading still counted them. The server already orders solvers
  // fastest first with unknown runtimes last.
  const ordered = solvers;
  const podium = ordered.slice(0, PODIUM_SIZE);
  const roll = ordered.slice(PODIUM_SIZE, PODIUM_SIZE + ROLL_SIZE);
  const overflow = ordered.length - PODIUM_SIZE - roll.length;
  const podiumNames = new Set(podium.map((s) => s.username));

  return (
    <div className={"flex flex-col gap-3.5 " + (dimmed ? "opacity-60" : "")}>
      <div className="flex items-end gap-8">
        <ol className="flex shrink-0 items-end gap-6">
          <AnimatePresence initial={false} mode="popLayout">
            {podium.map((solver, index) => (
              <motion.li
                key={solver.username}
                layout="position"
                transition={SETTLE}
                initial={{ opacity: 0, y: 14, scale: 0.85 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -14, scale: 0.85 }}
                className="flex w-[92px] flex-col items-center"
              >
                <PodiumSlot
                  solver={solver}
                  place={index + 1}
                  color={teamColor(solver.group_id, colors)}
                  showPercentile={hasSpread}
                />
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>

        {roll.length > 0 && (
          <div className="flex min-w-0 flex-1 items-center gap-1.5 pb-1.5">
            {roll.map((solver) => (
              <Avatar
                key={solver.username}
                nickname={solver.nickname}
                avatarUrl={solver.avatar_url}
                color={teamColor(solver.group_id, colors)}
                size={22}
                profileFor={solver.username}
              />
            ))}
            {overflow > 0 && (
              <span className="tnum ml-1 shrink-0 font-mono text-[11px] text-paper-faint">
                +{overflow}
              </span>
            )}
          </div>
        )}
      </div>

      {hasSpread && <Spread solvers={ranked} colors={colors} podium={podiumNames} />}
    </div>
  );
}

function PodiumSlot({
  solver,
  place,
  color,
  showPercentile,
}: {
  solver: SolverPayload;
  place: number;
  color: string;
  showPercentile: boolean;
}) {
  // No rank numeral: the order and the size step already say who won.
  const first = place === 1;
  return (
    <>
      <Avatar
        nickname={solver.nickname}
        avatarUrl={solver.avatar_url}
        color={color}
        size={first ? 46 : 34}
        profileFor={solver.username}
      />
      <span
        className={
          "mt-1.5 max-w-full truncate font-bold leading-tight " +
          (first ? "text-[15px] text-paper" : "text-[13px] text-paper-dim")
        }
      >
        {solver.nickname}
      </span>
      {showPercentile && (
        <span
          className={
            "tnum mt-0.5 font-mono leading-tight " +
            (first ? "text-[12px] text-paper" : "text-[10px] text-paper-faint")
          }
        >
          {(solver.beat_pct as number).toFixed(1)}
        </span>
      )}
    </>
  );
}

/**
 * Where the room landed, one tick per solver, fastest on the left.
 *
 * Ticks overlap into density, so a cluster reads as a thick band without any
 * lane-packing. Podium ticks are full height and opaque, tying the three
 * portraits above to their place in the field.
 */
function Spread({
  solvers,
  colors,
  podium,
}: {
  solvers: SolverPayload[];
  colors: TeamColors;
  podium: Set<string>;
}) {
  return (
    <div className="w-full">
      <div className="relative h-[30px] w-full">
        {solvers.map((solver) => {
          const isPodium = podium.has(solver.username);
          const color = teamColor(solver.group_id, colors);
          return (
            <motion.span
              key={solver.username}
              layout="position"
              transition={SETTLE}
              className="absolute bottom-0 -translate-x-1/2 rounded-[1px]"
              style={{
                // Mirrored: 100 sits on the left, beside first place.
                left: `${100 - (solver.beat_pct as number)}%`,
                width: isPodium ? 3 : 2,
                height: isPodium ? 30 : 18,
                background: isPodium ? color : teamWash(color, 0.6),
              }}
            />
          );
        })}
        <span className="absolute inset-x-0 bottom-0 h-px bg-ink-600" />
      </div>
      <div className="mt-1.5 flex items-baseline justify-between">
        <span className="tnum font-mono text-[9px] text-paper-faint">100</span>
        <span className="font-mono text-[9px] tracking-label text-paper-faint">RUNTIME</span>
        <span className="tnum font-mono text-[9px] text-paper-faint">0</span>
      </div>
    </div>
  );
}
