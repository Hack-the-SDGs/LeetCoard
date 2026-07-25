import { useEffect, useReducer, useRef } from "react";
import { API_BASE, streamUrl } from "../lib/api";
import type {
  AdminSnapshot,
  GroupPayload,
  GroupStanding,
  LeaderboardRow,
  ParticipantAdminPayload,
  ProblemPayload,
  PublicSnapshot,
  SubmissionEventPayload,
} from "../lib/types";

interface ConnState {
  connected: boolean;
  /** Set when the server refused our credentials, so the UI can ask again. */
  unauthorized: boolean;
  error: string | null;
  reconnects: number;
  serverNow: string | null;
}

type Snapshot = PublicSnapshot | AdminSnapshot;

type Action =
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "leaderboard"; leaderboard: LeaderboardRow[]; groupLeaderboard: GroupStanding[] }
  | { type: "submission_event"; event: SubmissionEventPayload }
  | { type: "problems"; problems: ProblemPayload[] }
  | { type: "groups"; groups: GroupPayload[] }
  | { type: "participants_admin"; participants: Record<string, ParticipantAdminPayload> }
  | { type: "reset"; snapshot: Snapshot }
  | { type: "conn"; conn: Partial<ConnState> };

interface State {
  snapshot: Snapshot | null;
  conn: ConnState;
}

const initial: State = {
  snapshot: null,
  conn: { connected: false, unauthorized: false, error: null, reconnects: 0, serverNow: null },
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "snapshot":
      return {
        ...state,
        snapshot: action.snapshot,
        conn: { ...state.conn, serverNow: action.snapshot.server_time, unauthorized: false },
      };
    case "leaderboard":
      if (!state.snapshot) return state;
      return {
        ...state,
        snapshot: {
          ...state.snapshot,
          leaderboard: action.leaderboard,
          group_leaderboard: action.groupLeaderboard ?? state.snapshot.group_leaderboard,
        },
      };
    case "submission_event": {
      if (!state.snapshot) return state;
      const events = [...state.snapshot.events, action.event].slice(-200);
      return { ...state, snapshot: { ...state.snapshot, events } };
    }
    case "problems": {
      if (!state.snapshot) return state;
      return { ...state, snapshot: { ...state.snapshot, problems: action.problems } };
    }
    case "groups": {
      if (!state.snapshot) return state;
      return { ...state, snapshot: { ...state.snapshot, groups: action.groups } };
    }
    case "participants_admin": {
      if (!state.snapshot) return state;
      return {
        ...state,
        snapshot: { ...state.snapshot, participants_admin: action.participants } as Snapshot,
      };
    }
    case "reset":
      return { ...state, snapshot: action.snapshot };
    case "conn":
      return { ...state, conn: { ...state.conn, ...action.conn } };
  }
}

export interface UseStreamOpts {
  audience: "public" | "admin";
  token?: string | null;
  viewPassword?: string | null;
}

export function useContestStream(opts: UseStreamOpts) {
  const [state, dispatch] = useReducer(reducer, initial);
  const reconnectRef = useRef<number | null>(null);
  const reconnectCountRef = useRef(0);

  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;

    const isAdmin = opts.audience === "admin";
    const snapshotPath = isAdmin ? "/api/admin/snapshot" : "/api/snapshot";
    const streamPath = isAdmin ? "/api/admin/stream" : "/api/stream";

    const scheduleRetry = () => {
      if (cancelled) return;
      if (reconnectRef.current) window.clearTimeout(reconnectRef.current);
      reconnectRef.current = window.setTimeout(() => {
        reconnectCountRef.current += 1;
        dispatch({ type: "conn", conn: { reconnects: reconnectCountRef.current } });
        void connect();
      }, 1500 + Math.random() * 1500);
    };

    const openStream = () => {
      const params: Record<string, string> = {};
      if (isAdmin && opts.token) params.token = opts.token;
      // EventSource cannot set headers, so the view password rides the query
      // string the same way the admin token already does.
      if (!isAdmin && opts.viewPassword) params.view = opts.viewPassword;

      es = new EventSource(streamUrl(streamPath, params));
      es.onopen = () => dispatch({ type: "conn", conn: { connected: true, error: null } });
      es.onerror = () => {
        dispatch({ type: "conn", conn: { connected: false, error: "stream error" } });
        es?.close();
        scheduleRetry();
      };

      es.addEventListener("snapshot", (e) =>
        dispatch({ type: "snapshot", snapshot: JSON.parse((e as MessageEvent).data) }),
      );
      es.addEventListener("leaderboard_update", (e) => {
        const d = JSON.parse((e as MessageEvent).data);
        dispatch({
          type: "leaderboard",
          leaderboard: d.leaderboard,
          groupLeaderboard: d.group_leaderboard,
        });
      });
      es.addEventListener("submission_event", (e) =>
        dispatch({ type: "submission_event", event: JSON.parse((e as MessageEvent).data) }),
      );
      es.addEventListener("problems_updated", (e) => {
        const d = JSON.parse((e as MessageEvent).data);
        dispatch({ type: "problems", problems: d.problems });
      });
      es.addEventListener("groups_updated", (e) => {
        const d = JSON.parse((e as MessageEvent).data);
        dispatch({ type: "groups", groups: d.groups });
      });
      es.addEventListener("participants_updated", (e) => {
        const d = JSON.parse((e as MessageEvent).data);
        if (d.participants_admin) {
          dispatch({ type: "participants_admin", participants: d.participants_admin });
        }
      });
      es.addEventListener("contest_reset", (e) => {
        const d = JSON.parse((e as MessageEvent).data);
        dispatch({ type: "reset", snapshot: d.snapshot });
      });
      // Sent when the view password changes; the retry below re-checks it.
      es.addEventListener("closed", () => {
        es?.close();
        dispatch({ type: "conn", conn: { connected: false } });
        scheduleRetry();
      });
      es.addEventListener("ping", () => undefined);
    };

    /**
     * Check credentials over REST before opening the stream. EventSource
     * reports every failure as a bare `error`, so a 401 would otherwise be
     * indistinguishable from a flaky network and retry forever.
     */
    const connect = async () => {
      const headers: Record<string, string> = {};
      if (isAdmin && opts.token) headers.Authorization = `Bearer ${opts.token}`;
      if (!isAdmin && opts.viewPassword) headers["X-View-Password"] = opts.viewPassword;

      let resp: Response;
      try {
        resp = await fetch(`${API_BASE}${snapshotPath}`, { headers });
      } catch {
        dispatch({ type: "conn", conn: { connected: false, error: "network" } });
        scheduleRetry();
        return;
      }
      if (cancelled) return;
      if (resp.status === 401) {
        dispatch({ type: "conn", conn: { connected: false, unauthorized: true } });
        return; // wait for a new credential rather than hammering the server
      }
      if (resp.ok) {
        const snap = await resp.json().catch(() => null);
        if (snap && !cancelled) dispatch({ type: "snapshot", snapshot: snap });
      }
      if (!cancelled) openStream();
    };

    void connect();

    return () => {
      cancelled = true;
      if (reconnectRef.current) window.clearTimeout(reconnectRef.current);
      es?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.audience, opts.token, opts.viewPassword]);

  return { snapshot: state.snapshot, conn: state.conn };
}
