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
const AXIS_HEIGHT = 20;
/** Avatar + one label line, plus air. Lanes must not let markers touch. */
const LANE_HEIGHT = 54;
/** Room for the leader's tag above the top lane. */
const CROWN_HEIGHT = 12;
/** Name plus percentile, with breathing room on both sides. */
const MARKER_WIDTH = 84;
const MARKER_GAP = 8;
/** Used until the track has been measured, and as a floor afterwards. */
const FALLBACK_GAP_PCT = 8;
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
  const needed = ((MARKER_WIDTH + MARKER_GAP) / trackWidth) * 100;
  return Math.min(MAX_GAP_PCT, needed);
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

function submissionUrl(id: string | null): string | null {
  return id ? `https://leetcode.com/submissions/detail/${id}/` : null;
}

/**
 * A problem's solvers plotted on a 0–100 runtime-percentile track.
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
    return <p className="py-4 text-[13px] text-paper-faint">還沒有人解出這題</p>;
  }

  // No session cookie upstream means no percentiles at all. Fall back to a
  // plain roll of solvers rather than parking the whole class on zero.
  if (ranked.length === 0) {
    return <SolverRow solvers={unranked} colors={colors} label="已解出" />;
  }

  const placed = packLanes(ranked, gapPctFor(trackWidth));
  const laneCount = placed.reduce((max, p) => Math.max(max, p.lane), 0) + 1;
  const leader = ranked[0];
  const height = AXIS_HEIGHT + laneCount * LANE_HEIGHT + CROWN_HEIGHT;

  return (
    <div className={dimmed ? "opacity-60" : undefined}>
      <div className="relative px-10" style={{ height }}>
        <div ref={trackRef} className="absolute inset-x-10 bottom-0 top-0">
          {placed.map(({ solver, lane }) => {
            const pct = solver.beat_pct as number;
            const color = teamColor(solver.group_id, colors);
            const href = submissionUrl(solver.submission_id);
            const isLeader = solver.username === leader.username;
            const marker = (
              <>
                <Avatar
                  nickname={solver.nickname}
                  avatarUrl={solver.avatar_url}
                  color={color}
                  size={30}
                />
                <span className="mt-1 flex max-w-full items-baseline gap-1 whitespace-nowrap">
                  <span className="truncate text-[12px] font-bold leading-none">
                    {solver.nickname}
                  </span>
                  <span className="tnum font-mono text-[10px] leading-none text-paper-faint">
                    {pct.toFixed(1)}
                  </span>
                </span>
              </>
            );
            return (
              <motion.div
                key={solver.username}
                layout
                transition={SETTLE}
                className="absolute"
                style={{ left: `${pct}%`, bottom: AXIS_HEIGHT + lane * LANE_HEIGHT }}
              >
                <div className="relative flex w-[84px] -translate-x-1/2 flex-col items-center">
                  {isLeader && (
                    <span className="mb-1 bg-paper px-1 font-mono text-[8px] font-bold tracking-label text-ink-950">
                      LEAD
                    </span>
                  )}
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`看 ${solver.nickname} 的提交（beats ${pct.toFixed(1)}%）`}
                      className="flex flex-col items-center"
                    >
                      {marker}
                    </a>
                  ) : (
                    <div className="flex flex-col items-center">{marker}</div>
                  )}
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
        <div className="absolute inset-x-10 bottom-0" style={{ height: AXIS_HEIGHT }}>
          <div className="relative h-px w-full bg-paper-faint">
            {TICKS.map((tick) => (
              <span
                key={tick}
                className="absolute top-0 h-[5px] w-px bg-paper-faint"
                style={{ left: `${tick}%` }}
              />
            ))}
          </div>
          <div className="relative mt-[7px] h-3">
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

      {unranked.length > 0 && (
        <SolverRow solvers={unranked} colors={colors} label="無 runtime 資料" bordered />
      )}
    </div>
  );
}

function SolverRow({
  solvers,
  colors,
  label,
  bordered,
}: {
  solvers: SolverPayload[];
  colors: TeamColors;
  label: string;
  bordered?: boolean;
}) {
  return (
    <div
      className={
        "flex flex-wrap items-start gap-x-4 gap-y-3 " + (bordered ? "rule-t mt-3 pt-3" : "py-2")
      }
    >
      <span className="mt-2 font-mono text-[9px] tracking-label text-paper-faint">{label}</span>
      {solvers.map((solver) => {
        const color = teamColor(solver.group_id, colors);
        const href = submissionUrl(solver.submission_id);
        const body = (
          <div className="flex w-[72px] flex-col items-center">
            <Avatar
              nickname={solver.nickname}
              avatarUrl={solver.avatar_url}
              color={color}
              size={26}
            />
            <span className="mt-1 max-w-full truncate text-[12px] font-bold leading-none">
              {solver.nickname}
            </span>
          </div>
        );
        return href ? (
          <a
            key={solver.username}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title={`看 ${solver.nickname} 的提交`}
          >
            {body}
          </a>
        ) : (
          <div key={solver.username}>{body}</div>
        );
      })}
    </div>
  );
}
