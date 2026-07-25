import { AnimatePresence, motion } from "framer-motion";
import { teamColor, type TeamColors } from "../../lib/color";
import { fmtClock } from "../../lib/format";
import type { SubmissionEventPayload } from "../../lib/types";

interface Props {
  events: SubmissionEventPayload[];
  colors: TeamColors;
}

const VISIBLE = 7;
const SETTLE = { type: "tween", ease: [0.2, 0, 0, 1], duration: 0.32 } as const;

/**
 * Newest submissions, newest at the left.
 *
 * Accepted runs that changed nothing are left out. With no attempt limit a
 * strong student can re-submit a dozen times polishing a runtime, and every one
 * of those would otherwise push a real verdict off the strip. Failures always
 * show — that a problem is biting the room is worth seeing.
 */
export default function Ticker({ events, colors }: Props) {
  const visible = events
    .filter((e) => (e.is_accepted ? e.is_scoring : true))
    .slice(-VISIBLE)
    .reverse();

  return (
    <footer className="rule-t flex items-stretch gap-0 bg-ink-900">
      <div className="flex shrink-0 items-center px-4">
        <span className="font-mono text-[10px] tracking-label text-paper-dim">動態</span>
      </div>
      {visible.length === 0 ? (
        <p className="flex items-center px-2 py-3 text-[12px] text-paper-faint">
          還沒有提交紀錄。
        </p>
      ) : (
        <div className="flex min-w-0 flex-1 items-stretch overflow-hidden">
          <AnimatePresence initial={false}>
            {visible.map((event) => (
              <motion.div
                key={event.id}
                layout
                transition={SETTLE}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex min-w-0 flex-1 items-center gap-2.5 border-l border-ink-700 px-3 py-2"
              >
                <Verdict event={event} color={teamColor(event.group_id, colors)} />
                <div className="min-w-0 flex-1">
                  {/* The real name never gives up width; the handle is the one
                      that shortens when the strip gets tight. */}
                  <div className="flex min-w-0 items-baseline gap-1.5">
                    <span className="shrink-0 whitespace-nowrap text-[13px] font-bold leading-tight">
                      {event.nickname}
                    </span>
                    <span className="min-w-0 truncate font-mono text-[10px] leading-tight text-paper-faint">
                      {event.username}
                    </span>
                  </div>
                  <div className="truncate font-mono text-[10px] leading-tight text-paper-faint">
                    {event.title ?? event.title_slug}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end">
                  {event.is_scoring && (
                    <span className="tnum font-display text-[17px] font-bold leading-none">
                      +{event.points_delta}
                    </span>
                  )}
                  <span className="tnum font-mono text-[9px] leading-tight text-paper-faint">
                    {fmtClock(new Date(event.submitted_at))}
                  </span>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </footer>
  );
}

function Verdict({ event, color }: { event: SubmissionEventPayload; color: string }) {
  // Accepted runs wear the team colour — that is the moment the team scored.
  // Everything else is a hairline outline, present but not shouting.
  const style = event.is_accepted
    ? { background: color, color: "#0E1113" }
    : { boxShadow: "inset 0 0 0 1px #363E44", color: "#9AA1A6" };
  return (
    <span
      className="flex h-8 w-9 shrink-0 items-center justify-center font-mono text-[11px] font-bold"
      style={style}
    >
      {event.short_label}
    </span>
  );
}
