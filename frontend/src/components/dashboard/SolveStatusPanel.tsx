import { useState } from "react";
import DifficultyMark from "../ui/DifficultyMark";
import { teamColor, teamColors } from "../../lib/color";
import { profileUrl } from "../../lib/leetcode";
import type { AdminSnapshot, ParticipantAdminPayload, ProblemPayload } from "../../lib/types";

interface Props {
  snapshot: AdminSnapshot;
}

/**
 * Who is stuck, per problem.
 *
 * The public board deliberately never names anyone who hasn't solved a problem.
 * That information still has to exist somewhere, because it is exactly what a
 * TA needs to decide who to walk over to — so it lives here, behind the admin
 * token, weakest first.
 */
export default function SolveStatusPanel({ snapshot }: Props) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const colors = teamColors(snapshot.groups);
  const roster = Object.values(snapshot.participants_admin);

  const toggle = (slug: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });

  const ordered = [...snapshot.problems].sort((a, b) => {
    if (a.is_open !== b.is_open) return a.is_open ? -1 : 1;
    return a.order - b.order;
  });

  return (
    <section className="flex h-full min-h-0 flex-col border border-ink-700 bg-ink-900">
      <div className="rule-b flex items-baseline justify-between px-4 py-2">
        <h2 className="font-mono text-[10px] tracking-label text-paper-dim">解題狀況</h2>
        <span className="tnum font-mono text-[10px] text-paper-faint">{roster.length} 人</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {ordered.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-paper-faint">還沒有題目。</p>
        ) : (
          ordered.map((problem) => (
            <ProblemRow
              key={problem.title_slug}
              problem={problem}
              roster={roster}
              colors={colors}
              expanded={open.has(problem.title_slug)}
              onToggle={() => toggle(problem.title_slug)}
            />
          ))
        )}
      </div>
    </section>
  );
}

function ProblemRow({
  problem,
  roster,
  colors,
  expanded,
  onToggle,
}: {
  problem: ProblemPayload;
  roster: ParticipantAdminPayload[];
  colors: Map<number, string>;
  expanded: boolean;
  onToggle: () => void;
}) {
  const unsolved = roster
    .filter((p) => !p.solved_problems.includes(problem.title_slug))
    // Weakest first: that is the order a TA would work down the room in.
    .sort((a, b) => a.score - b.score || a.nickname.localeCompare(b.nickname));
  const solvedCount = roster.length - unsolved.length;
  const ratio = roster.length > 0 ? solvedCount / roster.length : 0;

  return (
    <div className="border-b border-ink-800">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-ink-850"
      >
        <span className="tnum w-[40px] shrink-0 text-right font-mono text-[11px] text-paper-faint">
          #{problem.frontend_id ?? "—"}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-bold">
          {problem.title ?? problem.title_slug}
        </span>
        <DifficultyMark difficulty={problem.difficulty} />
        {problem.is_open && (
          <span className="shrink-0 font-mono text-[9px] tracking-label text-paper">開放中</span>
        )}
        <span className="h-[3px] w-14 shrink-0 bg-ink-700">
          <span
            className="block h-full origin-left bg-paper transition-transform duration-300 ease-instrument"
            style={{ transform: `scaleX(${ratio})` }}
          />
        </span>
        <span className="tnum w-[52px] shrink-0 text-right font-mono text-[11px]">
          {solvedCount}/{roster.length}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3">
          {unsolved.length === 0 ? (
            <p className="text-[12px] text-paper-dim">全部人都解出來了。</p>
          ) : (
            <>
              <p className="mb-1.5 font-mono text-[9px] tracking-label text-paper-faint">
                未解出 {unsolved.length} 人 · 分數低的排前面
              </p>
              <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                {unsolved.map((person) => (
                  <a
                    key={person.username}
                    href={profileUrl(person.username)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`${person.username} · ${person.score} pt`}
                    className="flex items-baseline gap-1.5 hover:opacity-80"
                  >
                    <span
                      className="h-2 w-2 shrink-0 translate-y-[1px] rounded-full"
                      style={{ background: teamColor(person.group_id, colors) }}
                    />
                    <span className="text-[12px] font-bold">{person.nickname}</span>
                    <span className="tnum font-mono text-[10px] text-paper-faint">
                      {person.score}
                    </span>
                  </a>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
