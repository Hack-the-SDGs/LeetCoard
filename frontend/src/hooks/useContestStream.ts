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

/**
 * The server heartbeats every 15s. Three missed beats means the socket is dead
 * even though `EventSource` still believes it is open — the usual outcome of a
 * laptop sleeping or a network changing while the tab sat in the background.
 * Without this the board just stops updating, silently, until someone reloads.
 */
const STALE_AFTER_MS = 45_000;
const WATCHDOG_EVERY_MS = 10_000;

export function useContestStream(opts: UseStreamOpts) {
  const [state, dispatch] = useReducer(reducer, initial);
  const reconnectRef = useRef<number | null>(null);
  const reconnectCountRef = useRef(0);

  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;
    let lastBeat = Date.now();

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

    const openStream = (ticket?: string) => {
      const params: Record<string, string> = {};
      // A ticket, never the token itself: anything in a URL is written to the
      // server's access log and kept in browser history, and this one is spent
      // on first use and dead within 30s.
      if (isAdmin && ticket) params.ticket = ticket;
      // EventSource cannot set headers, so the view password still rides the
      // query string — the server redacts it out of its access log.
      if (!isAdmin && opts.viewPassword) params.view = opts.viewPassword;

      es = new EventSource(streamUrl(streamPath, params));
      lastBeat = Date.now();

      // Every event is a named one, so `onmessage` never fires — the liveness
      // stamp has to go on each listener. This wrapper is the only way it does
      // not get forgotten when a new event type is added.
      const on = (name: string, handle: (data: MessageEvent) => void) =>
        es?.addEventListener(name, (e) => {
          lastBeat = Date.now();
          handle(e as MessageEvent);
        });

      es.onopen = () => {
        lastBeat = Date.now();
        dispatch({ type: "conn", conn: { connected: true, error: null } });
      };
      es.onerror = () => {
        dispatch({ type: "conn", conn: { connected: false, error: "stream error" } });
        es?.close();
        scheduleRetry();
      };

      on("snapshot", (e) => dispatch({ type: "snapshot", snapshot: JSON.parse(e.data) }));
      on("leaderboard_update", (e) => {
        const d = JSON.parse(e.data);
        dispatch({
          type: "leaderboard",
          leaderboard: d.leaderboard,
          groupLeaderboard: d.group_leaderboard,
        });
      });
      on("submission_event", (e) =>
        dispatch({ type: "submission_event", event: JSON.parse(e.data) }),
      );
      on("problems_updated", (e) => {
        const d = JSON.parse(e.data);
        dispatch({ type: "problems", problems: d.problems });
      });
      on("groups_updated", (e) => {
        const d = JSON.parse(e.data);
        dispatch({ type: "groups", groups: d.groups });
      });
      on("participants_updated", (e) => {
        const d = JSON.parse(e.data);
        if (d.participants_admin) {
          dispatch({ type: "participants_admin", participants: d.participants_admin });
        }
      });
      on("contest_reset", (e) => {
        const d = JSON.parse(e.data);
        dispatch({ type: "reset", snapshot: d.snapshot });
      });
      // Sent when the view password changes; the retry below re-checks it.
      on("closed", () => {
        es?.close();
        dispatch({ type: "conn", conn: { connected: false } });
        scheduleRetry();
      });
      on("ping", () => undefined);
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
      if (cancelled) return;

      if (!isAdmin) {
        openStream();
        return;
      }

      // Minted per connection, including every reconnect below — a ticket is
      // single-use, so a retry must never replay the last one.
      let ticket: string;
      try {
        const issued = await fetch(`${API_BASE}/api/admin/sse-ticket`, {
          method: "POST",
          headers: { Authorization: `Bearer ${opts.token ?? ""}` },
        });
        if (!issued.ok) throw new Error(String(issued.status));
        ticket = (await issued.json()).ticket;
      } catch {
        dispatch({ type: "conn", conn: { connected: false, error: "stream ticket" } });
        scheduleRetry();
        return;
      }
      if (!cancelled) openStream(ticket);
    };

    /** Drop a socket that has gone quiet and start a fresh one. */
    const revive = () => {
      if (cancelled || Date.now() - lastBeat < STALE_AFTER_MS) return;
      dispatch({ type: "conn", conn: { connected: false, error: "stream stalled" } });
      es?.close();
      es = null;
      lastBeat = Date.now(); // don't stack reconnects while the new one opens
      // Through scheduleRetry, not connect(): an `onerror` retry may already be
      // pending, and two connects would leave the first EventSource orphaned —
      // a live browser connection and a server-side subscriber nobody closes.
      scheduleRetry();
    };

    const watchdog = window.setInterval(revive, WATCHDOG_EVERY_MS);
    // The interval is throttled to a crawl while hidden, so returning to the
    // tab checks immediately instead of waiting for the next tick.
    const onVisible = () => {
      if (!document.hidden) revive();
    };
    document.addEventListener("visibilitychange", onVisible);

    void connect();

    return () => {
      cancelled = true;
      window.clearInterval(watchdog);
      document.removeEventListener("visibilitychange", onVisible);
      if (reconnectRef.current) window.clearTimeout(reconnectRef.current);
      es?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.audience, opts.token, opts.viewPassword]);

  return { snapshot: state.snapshot, conn: state.conn };
}
