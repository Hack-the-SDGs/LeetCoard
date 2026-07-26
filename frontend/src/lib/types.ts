// Mirrors backend payloads. Keep in sync with `app/domain/state.py::snapshot_dict`.

export type Difficulty = "easy" | "medium" | "hard";

export interface BonusTier {
  min_beat_pct: number; // 0–100, inclusive lower bound
  bonus_pts: number;
}

export interface GroupPayload {
  id: number;
  name: string;
  color: string; // css hex — the single source of identity colour
}

export interface SolverPayload {
  username: string;
  nickname: string;
  group_id: number | null;
  avatar_url: string | null;
  beat_pct: number | null; // runtime percentile; null when no session cookie
  solved_at: string | null;
}

export interface ProblemPayload {
  title_slug: string;
  difficulty: Difficulty;
  points: number;
  order: number;
  title?: string | null;
  frontend_id?: string | null;
  color?: string | null;
  beat_bonus_tiers?: BonusTier[];
  is_open: boolean;
  solvers: SolverPayload[];
}

export interface LeaderboardRow {
  rank: number;
  username: string;
  nickname: string;
  group_id: number | null;
  avatar_url: string | null;
  score: number;
  solved_problems: string[];
  reached_current_score_at: string | null;
  // Practice-set AC counts.
  easy_solved: number;
  medium_solved: number;
  hard_solved: number;
  // LeetCode global stats (populated by the profile fetcher).
  lc_ranking: number | null;
  lc_easy_total: number;
  lc_medium_total: number;
  lc_hard_total: number;
}

export interface TopMember {
  username: string;
  nickname: string;
  avatar_url: string | null;
  score: number;
}

export interface GroupStanding {
  rank: number;
  group_id: number;
  name: string;
  color: string;
  score: number;
  member_count: number;
  reached_current_score_at: string | null;
  /** Up to three members who contributed most; empty until someone scores. */
  top_members: TopMember[];
}

export interface SubmissionEventPayload {
  id: string;
  submission_id: string | null;
  username: string;
  nickname: string;
  group_id: number | null;
  title_slug: string;
  title?: string | null;
  status: string;
  short_label: string;
  submitted_at: string;
  detected_at: string;
  points_delta: number; // total awarded (base + bonus)
  bonus_delta: number; // bonus portion (from beat-% tiers)
  beat_pct?: number | null;
  is_accepted: boolean;
  is_scoring: boolean;
  note?: string | null;
}

export interface ParticipantAdminPayload {
  username: string;
  nickname: string;
  group_id: number | null;
  avatar_url: string | null;
  score: number;
  rank: number;
  solved_problems: string[];
}

export interface PublicSnapshot {
  server_time: string;
  groups: GroupPayload[];
  problems: ProblemPayload[];
  leaderboard: LeaderboardRow[];
  group_leaderboard: GroupStanding[];
  events: SubmissionEventPayload[];
}

export interface AdminSnapshot extends PublicSnapshot {
  participants_admin: Record<string, ParticipantAdminPayload>;
}

export interface PollingStatus {
  polling: boolean;
  open_problems: number;
  tracked_users: number;
  active_users: number;
}

export interface ViewPasswordState {
  password: string;
  required: boolean;
  overridden: boolean;
}
