import { useContestStream } from "../hooks/useContestStream";
import TeamBar from "../components/scoreboard/TeamBar";
import Standings from "../components/scoreboard/Standings";
import ProblemStack from "../components/scoreboard/ProblemStack";
import Ticker from "../components/scoreboard/Ticker";
import { teamColors } from "../lib/color";
import { maxAvailablePoints } from "../lib/score";

export default function Scoreboard() {
  const { snapshot, conn } = useContestStream({ audience: "public" });

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
  const openCount = snapshot.problems.filter((p) => p.is_open).length;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      <TeamBar
        standings={snapshot.group_leaderboard}
        connected={conn.connected}
        openCount={openCount}
      />
      <main className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)]">
        <Standings rows={snapshot.leaderboard} colors={colors} maxPoints={maxPoints} />
        <ProblemStack problems={snapshot.problems} colors={colors} />
      </main>
      <Ticker events={snapshot.events} colors={colors} />
    </div>
  );
}
