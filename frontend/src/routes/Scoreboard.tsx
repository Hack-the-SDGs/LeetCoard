import { useState } from "react";
import { useContestStream } from "../hooks/useContestStream";
import TeamBar from "../components/scoreboard/TeamBar";
import Standings from "../components/scoreboard/Standings";
import ProblemStack from "../components/scoreboard/ProblemStack";
import Ticker from "../components/scoreboard/Ticker";
import ViewGate from "../components/scoreboard/ViewGate";
import { teamColors } from "../lib/color";
import { maxAvailablePoints } from "../lib/score";

const VIEW_KEY = "leetcoard.view-password";

export default function Scoreboard() {
  const [viewPassword, setViewPassword] = useState<string | null>(() =>
    localStorage.getItem(VIEW_KEY),
  );
  const { snapshot, conn } = useContestStream({ audience: "public", viewPassword });

  if (conn.unauthorized) {
    return (
      <ViewGate
        error={viewPassword ? "密碼不正確，或老師已經換了密碼。" : null}
        onSubmit={(password) => {
          localStorage.setItem(VIEW_KEY, password);
          setViewPassword(password);
        }}
      />
    );
  }

  if (!snapshot) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <div className="text-center">
          <div className="font-display text-[28px] font-bold tracking-label">正在連線</div>
          <div className="mt-2 font-mono text-[11px] text-paper-faint">等待後端資料串流</div>
        </div>
      </div>
    );
  }

  const colors = teamColors(snapshot.groups);
  const maxPoints = maxAvailablePoints(snapshot.problems);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      <TeamBar standings={snapshot.group_leaderboard} connected={conn.connected} />
      <main className="grid min-h-0 flex-1 grid-cols-[268px_minmax(0,1fr)]">
        <Standings rows={snapshot.leaderboard} colors={colors} maxPoints={maxPoints} />
        <ProblemStack problems={snapshot.problems} colors={colors} />
      </main>
      <Ticker events={snapshot.events} colors={colors} />
    </div>
  );
}
