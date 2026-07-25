import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useContestStream } from "../hooks/useContestStream";
import Login from "../components/dashboard/Login";
import PracticePanel from "../components/dashboard/PracticePanel";
import ProblemsPanel from "../components/dashboard/ProblemsPanel";
import ParticipantsPanel from "../components/dashboard/ParticipantsPanel";
import SolveStatusPanel from "../components/dashboard/SolveStatusPanel";
import EventsPanel from "../components/dashboard/EventsPanel";
import type { AdminSnapshot } from "../lib/types";

const TOKEN_KEY = "gdg-leetcode.admin-token";

export default function Dashboard() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api<{ ok: true }>("/api/admin/auth/check", { token })
      .then(() => setAuthError(null))
      .catch((e: ApiError) => {
        if (e.status === 401) {
          setToken(null);
          localStorage.removeItem(TOKEN_KEY);
          setAuthError("Token 不正確，再試一次。");
        }
      });
  }, [token]);

  if (!token) {
    return (
      <Login
        error={authError}
        onSubmit={(t) => {
          localStorage.setItem(TOKEN_KEY, t);
          setToken(t);
          setAuthError(null);
        }}
      />
    );
  }

  return (
    <DashboardInner
      token={token}
      onLogout={() => {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
      }}
    />
  );
}

function DashboardInner({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { snapshot, conn } = useContestStream({ audience: "admin", token });
  const adminSnap = snapshot as AdminSnapshot | null;

  // The stream stops retrying on 401 and waits for a new credential. Without
  // this the console would sit on "正在載入" forever with a stale token.
  useEffect(() => {
    if (conn.unauthorized) onLogout();
  }, [conn.unauthorized, onLogout]);

  if (!adminSnap) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <div className="text-center">
          <p className="font-mono text-[12px] text-paper-faint">正在載入控制台</p>
          <p className="mt-2 text-[12px] text-paper-faint">
            {conn.error ? "連不上後端，重試中" : "等待第一份快照"}
          </p>
          <button
            onClick={onLogout}
            className="mt-5 rounded-sm border border-ink-600 px-3 py-1 text-[12px] hover:border-paper"
          >
            換一個 token
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col gap-3 overflow-hidden p-3">
      <header className="flex shrink-0 items-center justify-between border border-ink-700 bg-ink-900 px-4 py-2.5">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-[18px] font-bold leading-none tracking-label">
            LEETCOARD
          </span>
          <span className="font-mono text-[9px] tracking-label text-paper-faint">控制台</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-2 font-mono text-[10px] tracking-label">
            <span
              className="h-2 w-2"
              style={{
                background: conn.connected ? "#F2EFE9" : "transparent",
                boxShadow: `inset 0 0 0 1px ${conn.connected ? "#F2EFE9" : "#5C646A"}`,
              }}
            />
            {conn.connected ? "LIVE" : "離線"}
          </span>
          <button
            onClick={onLogout}
            className="rounded-sm border border-ink-600 px-3 py-1 text-[12px] hover:border-paper"
          >
            登出
          </button>
        </div>
      </header>

      {/* Below xl the console stacks and the page itself scrolls; from xl up
          every panel is a fixed pane that scrolls its own contents. */}
      <div className="grid min-h-0 flex-1 auto-rows-[minmax(320px,auto)] gap-3 overflow-y-auto xl:auto-rows-auto xl:grid-cols-[320px_minmax(0,1fr)_minmax(0,1fr)] xl:grid-rows-[minmax(0,1fr)_minmax(0,1fr)] xl:overflow-hidden">
        <div className="min-h-0 xl:row-span-2">
          <PracticePanel snapshot={adminSnap} token={token} />
        </div>
        <div className="min-h-0">
          <ProblemsPanel snapshot={adminSnap} token={token} />
        </div>
        <div className="min-h-0">
          <ParticipantsPanel snapshot={adminSnap} token={token} />
        </div>
        <div className="min-h-0">
          <SolveStatusPanel snapshot={adminSnap} />
        </div>
        <div className="min-h-0">
          <EventsPanel snapshot={adminSnap} />
        </div>
      </div>
    </div>
  );
}
