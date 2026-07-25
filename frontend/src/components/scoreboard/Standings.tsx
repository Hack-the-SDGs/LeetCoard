import { forwardRef, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useAnimationControls } from "framer-motion";
import Avatar from "../ui/Avatar";
import { useAutoScroll } from "../../hooks/useAutoScroll";
import { teamColor, teamWash, type TeamColors } from "../../lib/color";
import type { LeaderboardRow } from "../../lib/types";

interface Props {
  rows: LeaderboardRow[];
  colors: TeamColors;
  maxPoints: number;
}

/** Kept on screen at all times; everyone below this cycles or scrolls. */
const PINNED = 5;
const MODE_KEY = "leetcoard.standings-mode";
const SETTLE = { type: "tween", ease: [0.2, 0, 0, 1], duration: 0.42 } as const;

/**
 * Springs, not keyframes.
 *
 * A row that overtakes someone is a physical event: an upward impulse, then it
 * settles under its own weight. Stepping through fixed keyframes at a constant
 * rate reads as a mechanical wobble; a spring reads as mass.
 *
 * RECOIL is the one that decides how it feels. Its damping ratio is
 * `damping / (2 * sqrt(stiffness * mass))` ≈ 0.63, which gives one visible
 * overshoot and then quiet — half the bounces of the 0.31 it started at, and
 * the travel is small enough that the row never looks like it is escaping.
 */
const KICK = { type: "spring", stiffness: 900, damping: 26, mass: 0.7 } as const;
const RECOIL = { type: "spring", stiffness: 300, damping: 22, mass: 1 } as const;
const ARRIVE = { type: "spring", stiffness: 520, damping: 26, mass: 1 } as const;

const SWEEP_MS = 820;
const POP_MS = 460;

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
          {/* Crossing between these two lists unmounts and remounts the row,
              which is exactly the moment worth dramatising: breaking into the
              top five, or dropping out of it. */}
          <div className="rule-b bg-ink-850">
            <AnimatePresence initial={false} mode="popLayout">
              {pinned.map((row) => (
                <RowShell key={row.username} row={row} colors={colors} maxPoints={maxPoints} />
              ))}
            </AnimatePresence>
          </div>

          {/* layoutScroll tells framer this element scrolls. Without it every
              scroll step reads as "all rows moved", framer animates them back,
              and the carousel silently cancels itself out. */}
          <motion.div layoutScroll ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
            <AnimatePresence initial={false} mode="popLayout">
              {rest.map((row) => (
                <RowShell key={row.username} row={row} colors={colors} maxPoints={maxPoints} />
              ))}
            </AnimatePresence>
          </motion.div>
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

/** True for `ms` whenever `fire()` is called. */
function useMoment(ms: number): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<number | null>(null);
  const fire = () => {
    setOn(false);
    if (timer.current) window.clearTimeout(timer.current);
    // Drop the class for one frame so re-firing restarts the animation.
    requestAnimationFrame(() => {
      setOn(true);
      timer.current = window.setTimeout(() => setOn(false), ms);
    });
  };
  useEffect(() => () => void (timer.current && window.clearTimeout(timer.current)), []);
  return [on, fire];
}

interface RowShellProps {
  row: LeaderboardRow;
  colors: TeamColors;
  maxPoints: number;
}

/**
 * Framer owns the outer element's position via `layout`, so the impulse plays
 * on an inner motion element. Two animators writing one transform fight, and
 * the row lands in the wrong place.
 *
 * The ref is forwarded because `AnimatePresence mode="popLayout"` measures the
 * child it is about to pop out of flow.
 */
const RowShell = forwardRef<HTMLDivElement, RowShellProps>(function RowShell(
  { row, colors, maxPoints },
  ref,
) {
  const color = teamColor(row.group_id, colors);
  const controls = useAnimationControls();
  const [sweeping, fireSweep] = useMoment(SWEEP_MS);
  const [popping, firePop] = useMoment(POP_MS);
  const prevRank = useRef(row.rank);
  const prevScore = useRef(row.score);
  const arrived = useRef(false);

  useEffect(() => {
    void controls.start({ opacity: 1, x: 0, scale: 1, transition: ARRIVE });
    fireSweep();
    arrived.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const before = prevRank.current;
    prevRank.current = row.rank;
    if (!arrived.current || row.rank >= before) return;
    let cancelled = false;
    void (async () => {
      await controls.start({ y: -8, scale: 1.025, transition: KICK });
      if (!cancelled) void controls.start({ y: 0, scale: 1, transition: RECOIL });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.rank]);

  useEffect(() => {
    const before = prevScore.current;
    prevScore.current = row.score;
    if (arrived.current && row.score > before) firePop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.score]);

  return (
    <motion.div
      ref={ref}
      layout="position"
      transition={SETTLE}
      exit={{ opacity: 0, x: 64, transition: { duration: 0.3, ease: [0.2, 0, 0, 1] } }}
    >
      <motion.div initial={{ opacity: 0, x: -26, scale: 0.94 }} animate={controls}>
        <div className="relative">
          <Row row={row} color={color} maxPoints={maxPoints} popping={popping} />
          {sweeping && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 overflow-hidden"
            >
              <span
                className="sweep block h-full w-full"
                style={{
                  background: `linear-gradient(90deg, transparent, ${teamWash(color, 0.75)}, transparent)`,
                }}
              />
            </span>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
});

function Row({
  row,
  color,
  maxPoints,
  popping,
}: {
  row: LeaderboardRow;
  color: string;
  maxPoints: number;
  popping: boolean;
}) {
  const ratio = maxPoints > 0 ? Math.min(1, row.score / maxPoints) : 0;

  // 44px tall: twenty of these plus the header and the ticker is exactly a
  // 1080p column, so the twentieth row lands whole rather than half-cut.
  return (
    <div className="grid grid-cols-[22px_auto_minmax(0,1fr)_40px] items-center gap-2.5 px-3 py-2">
      <span className="tnum text-right font-display text-[17px] font-bold leading-tight text-paper-dim">
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
          <span className="shrink-0 text-[14px] font-bold leading-tight">{row.nickname}</span>
          <span className="min-w-0 truncate font-mono text-[10px] leading-tight text-paper-faint">
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
      <span
        className={
          "tnum origin-right text-right font-display text-[22px] font-bold leading-tight " +
          (popping ? "score-pop" : "")
        }
      >
        {row.score}
      </span>
    </div>
  );
}
