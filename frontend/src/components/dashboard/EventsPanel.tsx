import { teamColor, teamColors } from "../../lib/color";
import { fmtClock } from "../../lib/format";
import type { AdminSnapshot } from "../../lib/types";

/**
 * Everything the poller ingested, newest first.
 *
 * Unlike the public ticker this hides nothing — a re-AC that changed no score
 * and an AC that landed after the problem closed are both worth seeing when
 * someone asks "why didn't I get points".
 */
export default function EventsPanel({ snapshot }: { snapshot: AdminSnapshot }) {
  const colors = teamColors(snapshot.groups);
  const events = [...snapshot.events].reverse();

  return (
    <section className="flex h-full min-h-0 flex-col border border-ink-700 bg-ink-900">
      <div className="rule-b flex items-baseline justify-between px-4 py-2">
        <h2 className="font-mono text-[10px] tracking-label text-paper-dim">提交紀錄</h2>
        <span className="tnum font-mono text-[10px] text-paper-faint">{events.length} 筆</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {events.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-paper-faint">
            還沒有提交。開放一題就會開始輪詢。
          </p>
        ) : (
          events.map((event) => {
            const color = teamColor(event.group_id, colors);
            return (
              <div
                key={event.id}
                className="grid grid-cols-[52px_34px_minmax(0,1fr)_44px_40px] items-center gap-2 border-b border-ink-800 px-3 py-1.5"
              >
                <span className="tnum font-mono text-[10px] text-paper-faint">
                  {fmtClock(new Date(event.submitted_at))}
                </span>
                <span
                  className="flex h-[18px] items-center justify-center font-mono text-[10px] font-bold"
                  style={
                    event.is_accepted
                      ? { background: color, color: "#0E1113" }
                      : { boxShadow: "inset 0 0 0 1px #363E44", color: "#9AA1A6" }
                  }
                >
                  {event.short_label}
                </span>
                <span className="min-w-0 truncate text-[12px]">
                  <b className="font-bold">{event.nickname}</b>
                  <span className="text-paper-faint"> · </span>
                  <span className="text-paper-dim">{event.title ?? event.title_slug}</span>
                  {event.note && (
                    <span className="font-mono text-[10px] text-paper-faint"> · {event.note}</span>
                  )}
                </span>
                <span className="tnum text-right font-mono text-[10px] text-paper-dim">
                  {event.beat_pct != null ? `${Math.round(event.beat_pct)}%` : ""}
                </span>
                <span className="tnum text-right font-display text-[14px] font-bold">
                  {event.is_scoring ? `+${event.points_delta}` : ""}
                </span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
