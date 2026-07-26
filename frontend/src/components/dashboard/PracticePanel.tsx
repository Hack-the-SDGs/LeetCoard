import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api";
import type {
  AdminSnapshot,
  GroupPayload,
  PollingStatus,
  ViewPasswordState,
} from "../../lib/types";

interface Props {
  snapshot: AdminSnapshot;
  token: string;
}

const POLL_STATUS_MS = 5000;

function errText(e: unknown): string {
  return e instanceof ApiError ? `${e.status}: ${e.message}` : String(e);
}

export default function PracticePanel({ snapshot, token }: Props) {
  const [teams, setTeams] = useState<GroupPayload[]>(snapshot.groups);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [status, setStatus] = useState<PollingStatus | null>(null);
  const [view, setView] = useState<ViewPasswordState | null>(null);
  const [viewDraft, setViewDraft] = useState("");

  const loadView = useCallback(async () => {
    try {
      const state = await api<ViewPasswordState>("/api/admin/view-password", { token });
      setView(state);
      setViewDraft(state.password);
    } catch {
      // Leave the section blank rather than blocking the whole panel.
    }
  }, [token]);

  useEffect(() => {
    void loadView();
  }, [loadView]);

  // Team edits are a form: only re-seed when the server actually sends a
  // different set, so typing a name isn't wiped by an unrelated broadcast.
  const teamKey = snapshot.groups.map((g) => `${g.id}:${g.name}:${g.color}`).join("|");
  useEffect(() => {
    setTeams(snapshot.groups);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamKey]);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      api<PollingStatus & { ok: boolean }>("/api/admin/polling/status", { token })
        .then((s) => !cancelled && setStatus(s))
        .catch(() => undefined);
    };
    tick();
    const id = window.setInterval(tick, POLL_STATUS_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [token]);

  const patchTeam = (id: number, patch: Partial<GroupPayload>) =>
    setTeams((current) => current.map((g) => (g.id === id ? { ...g, ...patch } : g)));

  const run = async (name: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(name);
    setMsg(null);
    try {
      await fn();
      setMsg(done);
    } catch (e) {
      setMsg(errText(e));
    }
    setBusy(null);
  };

  const saveTeams = () =>
    run(
      "teams",
      () =>
        api("/api/admin/groups", {
          method: "PUT",
          token,
          body: JSON.stringify({ groups: teams }),
        }),
      "組別已更新",
    );

  const setAll = (open: boolean) =>
    run(
      open ? "open-all" : "close-all",
      () =>
        api("/api/admin/problems/open-all", {
          method: "PUT",
          token,
          body: JSON.stringify({ open }),
        }),
      open ? "已開放全部題目" : "已關閉全部題目",
    );

  const reset = () => {
    const ok = window.confirm(
      "重置會清除所有分數、提交紀錄與題目開關狀態。題目、名單與組別設定會保留。要繼續嗎？",
    );
    if (!ok) return;
    void run(
      "reset",
      () =>
        api("/api/admin/contest/reset", {
          method: "POST",
          token,
          body: JSON.stringify({ keep_config: true, confirm: "RESET" }),
        }),
      "已重置，所有題目回到關閉狀態",
    );
  };

  return (
    <section className="flex h-full min-h-0 flex-col border border-ink-700 bg-ink-900">
      <h2 className="rule-b px-4 py-2 font-mono text-[10px] tracking-label text-paper-dim">
        練習控制
      </h2>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <p className="font-mono text-[9px] tracking-label text-paper-faint">組別</p>
        <div className="mt-2 space-y-1.5">
          {teams.map((team) => (
            <div key={team.id} className="grid grid-cols-[16px_1fr_28px_74px] items-center gap-2">
              <span className="tnum text-center font-mono text-[11px] text-paper-faint">
                {team.id}
              </span>
              <input
                value={team.name}
                onChange={(e) => patchTeam(team.id, { name: e.target.value })}
                aria-label={`第 ${team.id} 組名稱`}
                className="w-full rounded-sm border border-ink-700 bg-ink-950 px-2 py-1 text-[13px] outline-none focus:border-paper"
              />
              <input
                type="color"
                value={team.color}
                onChange={(e) => patchTeam(team.id, { color: e.target.value })}
                aria-label={`第 ${team.id} 組顏色`}
                className="h-[26px] w-full cursor-pointer border border-ink-700 bg-ink-950 p-[2px]"
              />
              <input
                value={team.color}
                onChange={(e) => patchTeam(team.id, { color: e.target.value })}
                aria-label={`第 ${team.id} 組色碼`}
                spellCheck={false}
                className="w-full rounded-sm border border-ink-700 bg-ink-950 px-1.5 py-1 font-mono text-[11px] uppercase outline-none focus:border-paper"
              />
            </div>
          ))}
        </div>
        <button
          onClick={saveTeams}
          disabled={busy === "teams"}
          className="mt-3 rounded-sm bg-paper px-4 py-1.5 font-display text-[14px] font-bold text-ink-950 hover:brightness-95 disabled:opacity-40"
        >
          {busy === "teams" ? "儲存中" : "儲存組別"}
        </button>

        <hr className="my-5 border-ink-700" />

        <p className="font-mono text-[9px] tracking-label text-paper-faint">題目開關</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            onClick={() => setAll(true)}
            disabled={busy === "open-all"}
            className="rounded-sm border border-ink-600 py-1.5 text-[13px] font-bold hover:border-paper disabled:opacity-40"
          >
            全部開放
          </button>
          <button
            onClick={() => setAll(false)}
            disabled={busy === "close-all"}
            className="rounded-sm border border-ink-600 py-1.5 text-[13px] font-bold hover:border-paper disabled:opacity-40"
          >
            全部關閉
          </button>
        </div>

        <button
          onClick={reset}
          disabled={busy === "reset"}
          className="mt-2 w-full rounded-sm border border-paper-faint py-1.5 text-[13px] font-bold text-paper-dim hover:border-paper hover:text-paper disabled:opacity-40"
        >
          重置分數（保留題目與名單）
        </button>

        {msg && <p className="mt-3 text-[12px] text-paper-dim">{msg}</p>}

        <hr className="my-5 border-ink-700" />

        <p className="font-mono text-[9px] tracking-label text-paper-faint">觀看密碼</p>
        <input
          value={viewDraft}
          onChange={(e) => setViewDraft(e.target.value)}
          spellCheck={false}
          aria-label="觀看密碼"
          placeholder="留空 = 任何人都能看"
          className="mt-2 w-full rounded-sm border border-ink-700 bg-ink-950 px-2 py-1 font-mono text-[13px] outline-none focus:border-paper"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={() =>
              run(
                "view",
                async () => {
                  await api("/api/admin/view-password", {
                    method: "PUT",
                    token,
                    body: JSON.stringify({ password: viewDraft }),
                  });
                  await loadView();
                },
                viewDraft.trim() ? "密碼已更新，計分板已登出所有人" : "計分板已改為公開",
              )
            }
            disabled={busy === "view"}
            className="rounded-sm bg-paper px-3 py-1 font-display text-[13px] font-bold text-ink-950 hover:brightness-95 disabled:opacity-40"
          >
            套用
          </button>
          <button
            onClick={() =>
              run(
                "view-clear",
                async () => {
                  await api("/api/admin/view-password", { method: "DELETE", token });
                  await loadView();
                },
                "已還原成 .env 的設定",
              )
            }
            disabled={busy === "view-clear" || !view?.overridden}
            className="rounded-sm border border-ink-600 px-3 py-1 text-[13px] hover:border-paper disabled:opacity-30"
          >
            還原 .env
          </button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-paper-faint">
          {view
            ? `${view.overridden ? "本次執行覆寫中" : "使用 .env 設定"}· ${
                view.required ? "計分板需要密碼" : "計分板目前公開"
              }`
            : "讀取中"}
          。覆寫只存在記憶體，伺服器重啟後回到 .env。改密碼會中斷所有已連線的計分板。
        </p>

        <hr className="my-5 border-ink-700" />

        <p className="font-mono text-[9px] tracking-label text-paper-faint">輪詢</p>
        <dl className="mt-2 space-y-1 font-mono text-[11px]">
          <Stat label="狀態" value={status ? (status.polling ? "運作中" : "待機") : "—"} />
          <Stat label="開放題數" value={status ? String(status.open_problems) : "—"} />
          <Stat label="追蹤人數" value={status ? String(status.tracked_users) : "—"} />
          <Stat label="活躍人數" value={status ? String(status.active_users) : "—"} />
        </dl>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-paper-faint">{label}</dt>
      <dd className="tnum">{value}</dd>
    </div>
  );
}
