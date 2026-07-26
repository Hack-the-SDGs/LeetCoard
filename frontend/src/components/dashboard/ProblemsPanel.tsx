import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, ApiError } from "../../lib/api";
import { getProblemDetail, searchProblems } from "../../lib/leetcode";
import DifficultyMark from "../ui/DifficultyMark";
import Switch from "../ui/Switch";
import { Cross, DragHandle, Plus } from "../ui/icons";
import type { AdminSnapshot, BonusTier, Difficulty, ProblemPayload } from "../../lib/types";

interface Props {
  snapshot: AdminSnapshot;
  token: string;
}

interface Draft {
  title_slug: string;
  title: string | null;
  frontend_id: string | null;
  difficulty: Difficulty;
  points: number;
  beat_bonus_tiers: BonusTier[];
  key: string;
  expanded: boolean;
}

interface DifficultyDefaults {
  points: number;
  tiers: BonusTier[];
}

const DIFFICULTY_DEFAULTS: Record<Difficulty, DifficultyDefaults> = {
  easy: {
    points: 5,
    tiers: [
      { min_beat_pct: 70, bonus_pts: 3 },
      { min_beat_pct: 30, bonus_pts: 2 },
      { min_beat_pct: 0, bonus_pts: 1 },
    ],
  },
  medium: {
    points: 10,
    tiers: [
      { min_beat_pct: 70, bonus_pts: 6 },
      { min_beat_pct: 30, bonus_pts: 4 },
      { min_beat_pct: 0, bonus_pts: 2 },
    ],
  },
  hard: {
    points: 20,
    tiers: [
      { min_beat_pct: 70, bonus_pts: 12 },
      { min_beat_pct: 30, bonus_pts: 8 },
      { min_beat_pct: 0, bonus_pts: 4 },
    ],
  },
};

function defaultsFor(difficulty: Difficulty): DifficultyDefaults {
  const d = DIFFICULTY_DEFAULTS[difficulty];
  return { points: d.points, tiers: d.tiers.map((t) => ({ ...t })) };
}

function toDraft(p: ProblemPayload, index: number): Draft {
  return {
    title_slug: p.title_slug,
    title: p.title ?? null,
    frontend_id: p.frontend_id ?? null,
    difficulty: p.difficulty,
    points: p.points,
    beat_bonus_tiers: p.beat_bonus_tiers ?? [],
    key: `${p.title_slug}-${index}`,
    expanded: false,
  };
}

function newRow(): Draft {
  const defaults = defaultsFor("easy");
  return {
    title_slug: "",
    title: null,
    frontend_id: null,
    difficulty: "easy",
    points: defaults.points,
    beat_bonus_tiers: defaults.tiers,
    key: `new-${Math.random().toString(36).slice(2, 8)}`,
    expanded: false,
  };
}

export default function ProblemsPanel({ snapshot, token }: Props) {
  const [draft, setDraft] = useState<Draft[]>(() => snapshot.problems.map(toDraft));
  const [busy, setBusy] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);

  // Re-seed only when the problem *set* changes. Flipping a switch broadcasts
  // problems_updated too, and that must not wipe a half-typed row.
  const slugKey = snapshot.problems.map((p) => p.title_slug).join("|");
  useEffect(() => {
    setDraft(snapshot.problems.map(toDraft));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugKey]);

  const openBySlug = new Map(snapshot.problems.map((p) => [p.title_slug, p.is_open]));

  const update = (i: number, patch: Partial<Draft>) =>
    setDraft((d) => d.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  const moveRow = (from: number, to: number) => {
    if (from === to) return;
    setDraft((d) => {
      const copy = [...d];
      const [moved] = copy.splice(from, 1);
      copy.splice(to, 0, moved);
      return copy;
    });
  };

  const onPick = async (i: number, slug: string, title: string, frontendId: string | null) => {
    update(i, { title_slug: slug, title, frontend_id: frontendId });
    try {
      const detail = await getProblemDetail(slug);
      if (!detail) return;
      const defaults = defaultsFor(detail.difficulty);
      update(i, {
        difficulty: detail.difficulty,
        points: defaults.points,
        beat_bonus_tiers: defaults.tiers,
        title: detail.title,
        frontend_id: detail.frontend_id ?? frontendId ?? null,
      });
    } catch {
      // Keep whatever defaults the row already has.
    }
  };

  const toggleOpen = async (slug: string, open: boolean) => {
    setToggling(slug);
    setMsg(null);
    try {
      await api(`/api/admin/problems/${encodeURIComponent(slug)}/open`, {
        method: "PUT",
        token,
        body: JSON.stringify({ open }),
      });
    } catch (e) {
      setMsg(e instanceof ApiError ? `${e.status}: ${e.message}` : String(e));
    }
    setToggling(null);
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const cleaned = draft
        .map((p, i) => ({
          title_slug: p.title_slug.trim(),
          difficulty: p.difficulty,
          points: Number(p.points) || 0,
          order: i,
          title: p.title,
          frontend_id: p.frontend_id,
          beat_bonus_tiers: p.beat_bonus_tiers.map((t) => ({
            min_beat_pct: Number(t.min_beat_pct),
            bonus_pts: Number(t.bonus_pts),
          })),
        }))
        .filter((p) => p.title_slug);
      await api("/api/admin/problems", {
        method: "PUT",
        token,
        body: JSON.stringify({ problems: cleaned }),
      });
      setMsg(`已儲存 ${cleaned.length} 題，分數已重新計算`);
    } catch (e) {
      setMsg(e instanceof ApiError ? `${e.status}: ${e.message}` : String(e));
    }
    setBusy(false);
  };

  const maxTotal = draft.reduce((sum, p) => {
    const bestBonus = p.beat_bonus_tiers.reduce((m, t) => Math.max(m, Number(t.bonus_pts) || 0), 0);
    return sum + (Number(p.points) || 0) + bestBonus;
  }, 0);

  return (
    <section className="flex h-full min-h-0 flex-col border border-ink-700 bg-ink-900">
      <div className="rule-b flex items-baseline justify-between px-4 py-2">
        <h2 className="font-mono text-[10px] tracking-label text-paper-dim">題目</h2>
        <span className="tnum font-mono text-[10px] text-paper-faint">最高 {maxTotal} PT</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {draft.map((row, i) => {
          const saved = openBySlug.has(row.title_slug);
          const isOpen = openBySlug.get(row.title_slug) ?? false;
          const dropTarget = dropIdx === i && dragIdx !== null && dragIdx !== i;
          return (
            <div
              key={row.key}
              onDragOver={(e) => {
                if (dragIdx === null) return;
                e.preventDefault();
                if (dropIdx !== i) setDropIdx(i);
              }}
              onDragLeave={() => dropIdx === i && setDropIdx(null)}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIdx !== null) moveRow(dragIdx, i);
                setDragIdx(null);
                setDropIdx(null);
              }}
              className={"py-1 " + (dropTarget ? "outline outline-1 outline-paper" : "")}
            >
              <div className="grid grid-cols-[14px_minmax(0,1fr)_66px_52px_50px_36px_16px] items-center gap-2">
                <span
                  draggable
                  onDragStart={(e) => {
                    setDragIdx(i);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", String(i));
                  }}
                  onDragEnd={() => {
                    setDragIdx(null);
                    setDropIdx(null);
                  }}
                  title="拖曳以調整順序"
                  className="cursor-grab text-paper-faint hover:text-paper active:cursor-grabbing"
                >
                  <DragHandle />
                </span>

                <SlugSearch
                  value={row.title_slug}
                  onChange={(v) => update(i, { title_slug: v })}
                  onPick={(slug, title, fid) => onPick(i, slug, title, fid)}
                />

                <span className="flex justify-center">
                  <DifficultyMark difficulty={row.difficulty} />
                </span>

                <input
                  type="number"
                  min={0}
                  value={row.points}
                  aria-label="分數"
                  onChange={(e) => update(i, { points: Number(e.target.value) })}
                  className="tnum w-full rounded-sm border border-ink-700 bg-ink-950 px-1.5 py-1 text-[12px] outline-none focus:border-paper"
                />

                <button
                  onClick={() => update(i, { expanded: !row.expanded })}
                  title="加分區間"
                  className={
                    "rounded-sm border px-1 py-1 font-mono text-[9px] " +
                    (row.beat_bonus_tiers.length > 0
                      ? "border-paper text-paper"
                      : "border-ink-700 text-paper-faint")
                  }
                >
                  {row.beat_bonus_tiers.length} 段
                </button>

                <span className="flex justify-center">
                  {saved ? (
                    <Switch
                      checked={isOpen}
                      busy={toggling === row.title_slug}
                      onChange={(next) => toggleOpen(row.title_slug, next)}
                      label={`開放 ${row.title ?? row.title_slug}`}
                    />
                  ) : (
                    <span className="font-mono text-[9px] text-paper-faint" title="先儲存才能開放">
                      未存
                    </span>
                  )}
                </span>

                <button
                  onClick={() => {
                    // Removing a saved problem zeroes it for the whole class
                    // the moment 儲存 is pressed. It can be put back, but not
                    // by accident and not without someone noticing.
                    const label = row.title ?? row.title_slug;
                    if (saved && !window.confirm(`從清單移除「${label}」？儲存後全班在這題的分數會歸零。`)) {
                      return;
                    }
                    setDraft((d) => d.filter((_, idx) => idx !== i));
                  }}
                  title="刪除這題"
                  className="text-paper-faint hover:text-paper"
                >
                  <Cross />
                </button>
              </div>

              {row.expanded && (
                <div className="ml-6 mt-1.5 space-y-1 border-l border-ink-700 pl-3">
                  {row.beat_bonus_tiers.length === 0 && (
                    <p className="font-mono text-[10px] text-paper-faint">尚未設定加分區間</p>
                  )}
                  {row.beat_bonus_tiers.map((tier, ti) => (
                    <div key={ti} className="flex items-center gap-1.5 font-mono text-[11px]">
                      <span className="text-paper-faint">beats ≥</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={tier.min_beat_pct}
                        aria-label="百分位門檻"
                        onChange={(e) =>
                          update(i, {
                            beat_bonus_tiers: row.beat_bonus_tiers.map((t, idx) =>
                              idx === ti ? { ...t, min_beat_pct: Number(e.target.value) } : t,
                            ),
                          })
                        }
                        className="tnum w-14 rounded-sm border border-ink-700 bg-ink-950 px-1 py-0.5 outline-none focus:border-paper"
                      />
                      <span className="text-paper-faint">% 加</span>
                      <input
                        type="number"
                        min={0}
                        value={tier.bonus_pts}
                        aria-label="加分"
                        onChange={(e) =>
                          update(i, {
                            beat_bonus_tiers: row.beat_bonus_tiers.map((t, idx) =>
                              idx === ti ? { ...t, bonus_pts: Number(e.target.value) } : t,
                            ),
                          })
                        }
                        className="tnum w-12 rounded-sm border border-ink-700 bg-ink-950 px-1 py-0.5 outline-none focus:border-paper"
                      />
                      <span className="text-paper-faint">pt</span>
                      <button
                        onClick={() =>
                          update(i, {
                            beat_bonus_tiers: row.beat_bonus_tiers.filter((_, idx) => idx !== ti),
                          })
                        }
                        title="移除這個區間"
                        className="ml-1 text-paper-faint hover:text-paper"
                      >
                        <Cross size={10} />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() =>
                      update(i, {
                        beat_bonus_tiers: [
                          ...row.beat_bonus_tiers,
                          { min_beat_pct: 50, bonus_pts: 1 },
                        ],
                      })
                    }
                    className="flex items-center gap-1 font-mono text-[10px] text-paper-dim hover:text-paper"
                  >
                    <Plus size={10} /> 加分區間
                  </button>
                </div>
              )}
            </div>
          );
        })}

        <button
          onClick={() => setDraft((d) => [...d, newRow()])}
          className="mt-2 flex items-center gap-1 rounded-sm border border-ink-700 px-2 py-1 font-mono text-[11px] text-paper-dim hover:border-paper hover:text-paper"
        >
          <Plus /> 新增題目
        </button>
      </div>

      <div className="rule-t flex items-center gap-3 px-4 py-2.5">
        <button
          onClick={save}
          disabled={busy}
          className="rounded-sm bg-paper px-4 py-1.5 font-display text-[14px] font-bold text-ink-950 hover:brightness-95 disabled:opacity-40"
        >
          {busy ? "儲存中" : "儲存"}
        </button>
        {msg && <span className="truncate text-[11px] text-paper-dim">{msg}</span>}
      </div>
    </section>
  );
}

interface SearchHit {
  title: string;
  title_slug: string;
  frontend_id: string | null;
}

/** What the row stores. Typing a slug by hand is still allowed, so spaces
 *  collapse to hyphens — but only on the way out, never in the input itself.
 *
 *  Lowercased because slugs are: "Two Sum" typed by hand became `Two-Sum`,
 *  which the upstream 404s and the engine never matches, so the problem sat on
 *  the board scoring nothing for the whole class with no error anywhere. */
function toSlug(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "-");
}

function SlugSearch({
  value,
  onChange,
  onPick,
}: {
  value: string;
  onChange: (v: string) => void;
  onPick: (slug: string, title: string, frontendId: string | null) => void;
}) {
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  // What is actually being typed, spaces and all. The row stores a slug, so
  // feeding the row's value straight back into the input ate every space the
  // moment it was pressed — and hyphenated queries match nothing upstream.
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const track = () => {
      const rect = inputRef.current?.getBoundingClientRect();
      if (rect) setPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 220) });
    };
    track();
    window.addEventListener("scroll", track, true);
    window.addEventListener("resize", track);
    return () => {
      window.removeEventListener("scroll", track, true);
      window.removeEventListener("resize", track);
    };
  }, [open]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (inputRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Adopt a slug set from outside — a dropdown pick, a fresh snapshot — without
  // overwriting a half-typed query on every keystroke.
  useEffect(() => {
    setDraft((current) => (toSlug(current) === value ? current : value));
  }, [value]);

  const runSearch = (raw: string) => {
    // Upstream matches titles, so it wants "two sum". "two-sum" returns nothing.
    const q = raw.trim();
    if (q.length < 2) {
      setHits([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setOpen(true);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      try {
        setHits(await searchProblems(q));
      } catch {
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 200);
  };

  const dropdown =
    open && pos
      ? createPortal(
          <div
            ref={dropdownRef}
            style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 60 }}
            className="max-h-64 overflow-y-auto border border-ink-600 bg-ink-800"
          >
            {loading && <p className="px-3 py-2 font-mono text-[10px] text-paper-faint">搜尋中</p>}
            {!loading && hits.length === 0 && (
              <p className="px-3 py-2 font-mono text-[10px] text-paper-faint">沒有符合的題目</p>
            )}
            {hits.map((hit) => (
              <button
                key={hit.title_slug}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setDraft(hit.title_slug);
                  onPick(hit.title_slug, hit.title, hit.frontend_id);
                  setOpen(false);
                }}
                className="block w-full px-3 py-1.5 text-left hover:bg-ink-700"
              >
                <span className="block truncate text-[13px]">{hit.title}</span>
                <span className="block truncate font-mono text-[10px] text-paper-faint">
                  {hit.title_slug}
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="relative min-w-0">
      <input
        ref={inputRef}
        value={draft}
        aria-label="題目"
        placeholder="搜尋題目關鍵字"
        onChange={(e) => {
          setDraft(e.target.value);
          onChange(toSlug(e.target.value));
          runSearch(e.target.value);
        }}
        onFocus={() => draft.trim().length >= 2 && setOpen(true)}
        className="w-full rounded-sm border border-ink-700 bg-ink-950 px-2 py-1 font-mono text-[12px] outline-none focus:border-paper"
      />
      {dropdown}
    </div>
  );
}
