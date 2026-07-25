import { useState } from "react";
import { api, ApiError } from "../../lib/api";
import Avatar from "../ui/Avatar";
import { Cross } from "../ui/icons";
import { teamColor, teamColors } from "../../lib/color";
import type { AdminSnapshot } from "../../lib/types";

interface Props {
  snapshot: AdminSnapshot;
  token: string;
}

interface BulkResult {
  created: number;
  updated: number;
  errors: string[];
}

const PLACEHOLDER = `xinshoutw,陳小明,1
alice,王小華,1
bob,李大十,2`;

function errText(e: unknown): string {
  return e instanceof ApiError ? `${e.status}: ${e.message}` : String(e);
}

export default function ParticipantsPanel({ snapshot, token }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const colors = teamColors(snapshot.groups);
  const people = Object.values(snapshot.participants_admin).sort((a, b) => a.rank - b.rank);
  const unassigned = people.filter((p) => p.group_id == null).length;

  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setMsg(null);
    setErrors([]);
    try {
      const res = await api<BulkResult>("/api/admin/participants/bulk", {
        method: "PUT",
        token,
        body: JSON.stringify({ text }),
      });
      setMsg(`新增 ${res.created} 人，更新 ${res.updated} 人`);
      setErrors(res.errors);
      if (res.errors.length === 0) setText("");
    } catch (e) {
      setMsg(errText(e));
    }
    setBusy(false);
  };

  const changeGroup = async (username: string, groupId: number | null) => {
    setMsg(null);
    try {
      await api(`/api/admin/participants/${encodeURIComponent(username)}/group`, {
        method: "PUT",
        token,
        body: JSON.stringify({ group_id: groupId }),
      });
    } catch (e) {
      setMsg(errText(e));
    }
  };

  const remove = async (username: string) => {
    if (!window.confirm(`把 ${username} 從名單移除？他的分數會一併消失。`)) return;
    setMsg(null);
    try {
      await api(`/api/admin/participants/${encodeURIComponent(username)}`, {
        method: "DELETE",
        token,
      });
    } catch (e) {
      setMsg(errText(e));
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col border border-ink-700 bg-ink-900">
      <div className="rule-b flex items-baseline justify-between px-4 py-2">
        <h2 className="font-mono text-[10px] tracking-label text-paper-dim">學員</h2>
        <span className="tnum font-mono text-[10px] text-paper-faint">
          {people.length} 人{unassigned > 0 ? ` · ${unassigned} 未分組` : ""}
        </span>
      </div>

      <div className="rule-b p-3">
        <label htmlFor="roster" className="font-mono text-[9px] tracking-label text-paper-faint">
          貼上名單：USERNAME,姓名,組別
        </label>
        <textarea
          id="roster"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          spellCheck={false}
          placeholder={PLACEHOLDER}
          className="mt-1.5 w-full resize-y rounded-sm border border-ink-700 bg-ink-950 px-2 py-1.5 font-mono text-[12px] outline-none focus:border-paper"
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            onClick={submit}
            disabled={busy || !text.trim()}
            className="rounded-sm bg-paper px-4 py-1.5 font-display text-[14px] font-bold text-ink-950 hover:brightness-95 disabled:opacity-40"
          >
            {busy ? "匯入中" : "匯入"}
          </button>
          <span className="text-[11px] text-paper-faint">組別欄可留空，留空不會動到原本的組別</span>
        </div>
        {msg && <p className="mt-2 text-[12px] text-paper-dim">{msg}</p>}
        {errors.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {errors.map((e) => (
              <li key={e} className="font-mono text-[11px] text-paper-dim">
                {e}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {people.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-paper-faint">
            名單是空的。貼上一份就可以開始。
          </p>
        ) : (
          people.map((person) => (
            <div
              key={person.username}
              className="grid grid-cols-[22px_auto_minmax(0,1fr)_78px_46px_16px] items-center gap-2 border-b border-ink-800 px-3 py-1.5"
            >
              <span className="tnum text-right font-mono text-[11px] text-paper-faint">
                {person.rank}
              </span>
              <Avatar
                nickname={person.nickname}
                avatarUrl={person.avatar_url}
                color={teamColor(person.group_id, colors)}
                size={20}
              />
              <div className="min-w-0">
                <div className="truncate text-[13px] font-bold leading-tight">
                  {person.nickname}
                </div>
                <div className="truncate font-mono text-[10px] leading-tight text-paper-faint">
                  {person.username}
                </div>
              </div>
              <select
                value={person.group_id ?? ""}
                aria-label={`${person.nickname} 的組別`}
                onChange={(e) =>
                  changeGroup(person.username, e.target.value === "" ? null : Number(e.target.value))
                }
                className="w-full rounded-sm border border-ink-700 bg-ink-950 px-1 py-1 text-[12px] outline-none focus:border-paper"
              >
                <option value="">未分組</option>
                {snapshot.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <span className="tnum text-right font-display text-[15px] font-bold">
                {person.score}
              </span>
              <button
                onClick={() => remove(person.username)}
                title={`移除 ${person.nickname}`}
                className="text-paper-faint hover:text-paper"
              >
                <Cross />
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
