// In dev, Vite proxies `/api` to localhost:8080.
// In production the frontend talks to VITE_API_BASE directly.
export const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

export interface AuthOpts {
  /** Admin token — opens the dashboard and every write endpoint. */
  token?: string | null;
  /** View password — opens the public board when one is set. */
  viewPassword?: string | null;
}

function authHeaders({ token, viewPassword }: AuthOpts): HeadersInit {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (viewPassword) headers["X-View-Password"] = viewPassword;
  return headers;
}

export async function api<T>(path: string, init: RequestInit & AuthOpts = {}): Promise<T> {
  const { token, viewPassword, ...rest } = init;
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const headers = { ...authHeaders({ token, viewPassword }), ...(rest.headers ?? {}) };
  const resp = await fetch(url, { ...rest, headers });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new ApiError(resp.status, detail || resp.statusText);
  }
  if (resp.status === 204) return undefined as T;
  return (await resp.json()) as T;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function streamUrl(path: string, params: Record<string, string> = {}): string {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}
