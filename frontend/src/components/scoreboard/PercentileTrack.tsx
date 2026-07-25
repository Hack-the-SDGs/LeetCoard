import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import Avatar from "../ui/Avatar";
import { teamColor, teamWash, type TeamColors } from "../../lib/color";
import type { SolverPayload } from "../../lib/types";

interface Props {
  solvers: SolverPayload[];
  colors: TeamColors;
  dimmed: boolean;
}

/** Axis line, ticks and their labels. Markers stand on top of this. */
const AXIS_HEIGHT = 18;
/** Portrait plus one label line, with enough air that lanes never touch. */
const LANE_HEIGHT = 52;
/** Room for the leader's tag above the top lane. */
const CROWN_HEIGHT = 12;
/**
 * How many solvers get a portrait.
 *
 * Everyone else is counted, not named. Plotting a whole class turns the track
 * into a wall of 9px labels nobody can read from the back of the room, and it
 * ranks the slowest solver in public — which is exactly the pressure this board
 * is supposed to avoid.
 */
const TRACK_LIMIT = 20;
const MARKER_WIDTH = 88;
const MARKER_GAP = 8;
const FALLBACK_GAP_PCT = 6;
/** Beyond this a narrow screen would spawn a lane per solver. */
const MAX_GAP_PCT = 25;
const SETTLE = { type: "tween", ease: [0.2, 0, 0, 1], duration: 0.5 } as const;
const TICKS = [0, 25, 50, 75, 100];

interface Placed {
  solver: SolverPayload;
  lane: number;
}

/**
 * Collision distance in percentile terms.
 *
 * Markers are a fixed pixel width but the track stretches with the viewport, so
 * a percentage threshold that clears on a 1920 projector has labels touching on
 * a 1440 laptop. Deriving it from the measured width keeps both honest.
 */
function gapPctFor(trackWidth: number): number {
  if (trackWidth <= 0) return FALLBACK_GAP_PCT;
  return Math.min(MAX_GAP_PCT, ((MARKER_WIDTH + MARKER_GAP) / trackWidth) * 100);
}

function useTrackWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/**
 * Stack markers into lanes so a cluster of similar runtimes stays readable.
 *
 * Walking left to right and dropping each marker into the lowest lane that
 * still has room keeps the common case — everyone spread out — on a single
 * line, and only grows the track when people bunch up.
 */
function packLanes(solvers: SolverPayload[], minGapPct: number): Placed[] {
  const laneEnds: number[] = [];
  const ascending = [...solvers].sort((a, b) => (a.beat_pct ?? 0) - (b.beat_pct ?? 0));
  return ascending.map((solver) => {
    const pct = solver.beat_pct ?? 0;
    let lane = 0;
    while (lane < laneEnds.length && pct - laneEnds[lane] < minGapPct) lane += 1;
    laneEnds[lane] = pct;
    return { solver, lane };
  });
}

/**
 * A problem's fastest solvers plotted on a 0–100 runtime-percentile track.
 *
 * "Beats 94%" is the one number LeetCode gives that nobody reads when it is
 * printed as small text. On a track it becomes a position: solving puts you on
 * the board, optimising slides you right, and the room can see who is fastest
 * without comparing digits. It is also what makes unlimited resubmits mean
 * something — the marker moves every time you shave the runtime.
 *
 * Markers that had to stack carry a stem down to the axis, so height never
 * reads as meaning: only horizontal position does.
 */
export default function PercentileTrack({ solvers, colors, dimmed }: Props) {
  const { ref: trackRef, width: trackWidth } = useTrackWidth();
  const ranked = solvers.filter((s) => s.beat_pct != null);
  const unranked = solvers.filter((s) => s.beat_pct == null);

  if (solvers.length === 0) {
    return <p className="py-2 text-[13px] text-paper-faint">還沒有人解出這題</p>;
  }

  // No session cookie upstream means no percentiles at all. Fall back to a
  // plain roll of solvers rather than parking the whole class on zero.
  if (ranked.length === 0) {
    return (
      <SolverRow solvers={unranked.slice(0, TRACK_LIMIT)} colors={colors} label="已解出">
        <Remainder count={unranked.length - TRACK_LIMIT} />
      </SolverRow>
    );
  }

  const shown = ranked.slice(0, TRACK_LIMIT);
  const uncounted = ranked.length - shown.length + unranked.length;
  const leader = shown[0];

  const packed = packLanes(shown, gapPctFor(trackWidth));
  const topLane = packed.reduce((max, p) => Math.max(max, p.lane), 0);

  // The leader wears a tag above its portrait, which needs the space a lane
  // above would occupy. Lifting the leader to the top lane guarantees that
  // clearance and reads the way it should anyway: fastest stands highest.
  const leaderLane = packed.find((p) => p.solver.username === leader.username)?.lane ?? 0;
  const needsLift = leaderLane < topLane;
  const placed = needsLift
    ? packed.map((p) => (p.solver.username === leader.username ? { ...p, lane: topLane + 1 } : p))
    : packed;
  const laneCount = (needsLift ? topLane + 1 : topLane) + 1;
  const height = AXIS_HEIGHT + laneCount * LANE_HEIGHT + CROWN_HEIGHT;

  return (
    <div className={dimmed ? "opacity-60" : undefined}>
      <div className="relative px-12" style={{ height }}>
        <div ref={trackRef} className="absolute inset-x-12 bottom-0 top-0">
          {placed.map(({ solver, lane }) => {
            const pct = solver.beat_pct as number;
            const color = teamColor(solver.group_id, colors);
            const isLeader = solver.username === leader.username;
            return (
              <motion.div
                key={solver.username}
                layout
                transition={SETTLE}
                className="absolute"
                style={{ left: `${pct}%`, bottom: AXIS_HEIGHT + lane * LANE_HEIGHT }}
              >
                <div
                  className="relative flex -translate-x-1/2 flex-col items-center"
                  style={{ width: MARKER_WIDTH }}
                >
                  {isLeader && (
                    <span className="mb-[3px] whitespace-nowrap bg-paper px-1 font-mono text-[9px] font-bold leading-[11px] tracking-label text-ink-950">
                      LEAD
                    </span>
                  )}
                  <Avatar
                    nickname={solver.nickname}
                    avatarUrl={solver.avatar_url}
                    color={color}
                    size={30}
                    profileFor={solver.username}
                  />
                  <span className="mt-[4px] flex max-w-full items-baseline gap-1 whitespace-nowrap">
                    <span className="truncate text-[13px] font-bold leading-none">
                      {solver.nickname}
                    </span>
                    <span className="tnum font-mono text-[10px] leading-none text-paper-faint">
                      {pct.toFixed(1)}
                    </span>
                  </span>
                  {lane > 0 && (
                    <span
                      aria-hidden="true"
                      className="absolute left-1/2 top-full w-px"
                      style={{ height: lane * LANE_HEIGHT, background: teamWash(color, 0.5) }}
                    />
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Markers stand on the axis, so it sits flush at the bottom. */}
        <div className="absolute inset-x-12 bottom-0" style={{ height: AXIS_HEIGHT }}>
          <div className="relative h-px w-full bg-paper-faint">
            {TICKS.map((tick) => (
              <span
                key={tick}
                className="absolute top-0 h-[4px] w-px bg-paper-faint"
                style={{ left: `${tick}%` }}
              />
            ))}
          </div>
          <div className="relative mt-[6px] h-3">
            {TICKS.map((tick) => (
              <span
                key={tick}
                className="tnum absolute -translate-x-1/2 font-mono text-[10px] leading-none text-paper-faint"
                style={{ left: `${tick}%` }}
              >
                {tick}
              </span>
            ))}
          </div>
        </div>
      </div>

      <Remainder count={uncounted} />
    </div>
  );
}

/** Everyone past the track limit: counted, never named. */
function Remainder({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <p className="rule-t mt-1 pt-2 font-mono text-[10px] tracking-label text-paper-faint">
      其餘 <span className="tnum">{count}</span> 人已解出
    </p>
  );
}

function SolverRow({
  solvers,
  colors,
  label,
  children,
}: {
  solvers: SolverPayload[];
  colors: TeamColors;
  label: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="py-1.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="font-mono text-[9px] tracking-label text-paper-faint">{label}</span>
        {solvers.map((solver) => (
          <span key={solver.username} className="flex items-center gap-1.5">
            <Avatar
              nickname={solver.nickname}
              avatarUrl={solver.avatar_url}
              color={teamColor(solver.group_id, colors)}
              size={24}
              profileFor={solver.username}
            />
            <span className="text-[13px] font-bold leading-none">{solver.nickname}</span>
          </span>
        ))}
      </div>
      {children}
    </div>
  );
}
